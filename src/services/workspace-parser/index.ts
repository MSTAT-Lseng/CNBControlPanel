/**
 * Cloud Native Dev Parser Service.
 * Read-only adapter for querying CNB workspace history, build summaries,
 * sanitized configuration structures, and stage raw log outputs.
 */

import type {
  ErrorCode,
  LogReporter,
  ServiceResult,
  WorkspaceBuildConfigSummary,
  WorkspaceBuildLogDetail,
  WorkspaceBuildLogInput,
  WorkspaceListInput,
  WorkspaceListSnapshot,
  WorkspaceParserPort,
  WorkspaceStageLog,
  WorkspaceStageLogInput,
} from '@/contracts';
import {
  CNB_BASE_URL,
  WorkspaceParserError,
  cnbWorkspaceGetJson,
  delayMs,
  encodePathSegments,
  normalizeWorkspaceCookie,
} from './httpClient';
import {
  extractConfigSummary,
  extractCookieOwnerUsername,
  mapBuildLogPayload,
  mapStageLogPayload,
  mapWorkspaceListPayload,
} from './workspaceApi';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const FOLLOWUP_REQUEST_DELAY_MS = 200;

function validationFailure<T>(message: string): ServiceResult<T> {
  return {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message,
    },
    timestamp: Date.now(),
  };
}

function mapFailureCode(err: unknown): ErrorCode {
  if (err instanceof WorkspaceParserError) {
    if (err.kind === 'VALIDATION') {
      return 'VALIDATION_ERROR';
    }
    if (err.kind === 'NOT_FOUND') {
      return 'NOT_FOUND';
    }
  }
  return 'WORKSPACE_PARSER_ERROR';
}

function buildWorkspacesReferer(username: string): string {
  return `${CNB_BASE_URL}/u/${encodeURIComponent(username)}/workspaces`;
}

async function verifyCookieOwner(
  cleanCookie: string,
  requestedUsername: string,
  logger: LogReporter,
): Promise<string> {
  logger.verbose('workspaceParser.getMe', 'Verifying CNB cookie via GET /user');
  const mePayload = await cnbWorkspaceGetJson<unknown>(`${CNB_BASE_URL}/user`, cleanCookie, {
    referer: buildWorkspacesReferer(requestedUsername),
  });
  const ownerUsername = extractCookieOwnerUsername(mePayload);

  if (
    ownerUsername &&
    requestedUsername.toLowerCase() !== ownerUsername.toLowerCase()
  ) {
    logger.warn(
      'workspaceParser.getMe',
      `Configured username "${requestedUsername}" differs from cookie owner "${ownerUsername}"; CNB /workspace/list returns cookie owner data`,
    );
  }

  return ownerUsername;
}

/**
 * Creates a WorkspaceParserPort instance bound to an injected LogReporter.
 */
export function createWorkspaceParserService(logger: LogReporter): WorkspaceParserPort {
  return {
    async parseWorkspaceList(
      input: WorkspaceListInput,
    ): Promise<ServiceResult<WorkspaceListSnapshot>> {
      const username = input.username.trim();
      const cleanCookie = normalizeWorkspaceCookie(input.cookie);

      if (!username || !cleanCookie) {
        logger.warn(
          'workspaceParser.parseWorkspaceList',
          'Rejected workspace list fetch due to missing credentials',
          `hasUsername=${Boolean(username)} hasCookie=${Boolean(cleanCookie)}`,
        );
        return validationFailure('Username and cookie are required to fetch workspaces');
      }

      const page =
        typeof input.page === 'number' && Number.isFinite(input.page) && input.page >= 1
          ? Math.floor(input.page)
          : 1;
      const rawPageSize =
        typeof input.pageSize === 'number' && Number.isFinite(input.pageSize)
          ? Math.floor(input.pageSize)
          : DEFAULT_PAGE_SIZE;
      const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, rawPageSize));
      const status = input.status ?? '';
      if (status !== '' && status !== 'running' && status !== 'closed') {
        logger.warn(
          'workspaceParser.parseWorkspaceList',
          `Rejected invalid workspace status filter: "${String(status)}"`,
        );
        return validationFailure('Workspace status filter must be running, closed, or empty');
      }

      const slug = (input.slug ?? '').trim();
      const branch = (input.branch ?? '').trim();

      logger.verbose(
        'workspaceParser.parseWorkspaceList',
        `Fetching workspace list for "${username}"`,
        `page=${page} pageSize=${pageSize} status=${status || 'all'} cookieLength=${cleanCookie.length}`,
      );

      try {
        const ownerUsername = await verifyCookieOwner(cleanCookie, username, logger);
        const query = [
          `slug=${encodeURIComponent(slug)}`,
          `branch=${encodeURIComponent(branch)}`,
          `page=${page}`,
          `page_size=${pageSize}`,
          `status=${encodeURIComponent(status)}`,
        ].join('&');
        const listUrl = `${CNB_BASE_URL}/workspace/list?${query}`;

        const listPayload = await cnbWorkspaceGetJson<unknown>(listUrl, cleanCookie, {
          referer: buildWorkspacesReferer(username),
        });

        const snapshot = mapWorkspaceListPayload(
          listPayload,
          username,
          ownerUsername,
          page,
          pageSize,
        );

        logger.info(
          'workspaceParser.parseWorkspaceList',
          `Fetched ${snapshot.items.length} workspace(s) (total=${snapshot.total}, page=${snapshot.page}) for "${username}"`,
          snapshot.ownerMismatch
            ? `owner=${snapshot.ownerUsername} hasMore=${snapshot.hasMore}`
            : `hasMore=${snapshot.hasMore}`,
        );

        return {
          ok: true,
          data: snapshot,
          timestamp: Date.now(),
        };
      } catch (err) {
        const message =
          err instanceof WorkspaceParserError
            ? err.message
            : `获取 "${username}" 云原生开发容器列表失败`;
        const cause = err instanceof Error ? err.message : String(err);

        logger.error(
          'workspaceParser.parseWorkspaceList',
          `Workspace list parse failed for "${username}": ${message}`,
          cause,
        );

        return {
          ok: false,
          error: {
            code: mapFailureCode(err),
            message,
            cause,
          },
          timestamp: Date.now(),
        };
      }
    },

    async parseWorkspaceBuildLog(
      input: WorkspaceBuildLogInput,
    ): Promise<ServiceResult<WorkspaceBuildLogDetail>> {
      const username = input.username.trim();
      const cleanCookie = normalizeWorkspaceCookie(input.cookie);
      const slug = input.slug.trim();
      const sn = input.sn.trim();

      if (!username || !cleanCookie || !slug || !sn) {
        logger.warn(
          'workspaceParser.parseWorkspaceBuildLog',
          'Rejected build log fetch due to missing parameters',
          `hasUsername=${Boolean(username)} hasCookie=${Boolean(cleanCookie)} hasSlug=${Boolean(slug)} hasSn=${Boolean(sn)}`,
        );
        return validationFailure('Username, cookie, slug, and sn are required to fetch build log');
      }

      const encodedSlug = encodePathSegments(slug);
      if (!encodedSlug) {
        return validationFailure('Invalid repository slug');
      }

      const encodedSn = encodeURIComponent(sn);
      const buildLogUrl = `${CNB_BASE_URL}/${encodedSlug}/-/build/logs/${encodedSn}`;
      const referer = buildWorkspacesReferer(username);

      logger.verbose(
        'workspaceParser.parseWorkspaceBuildLog',
        `Fetching build log for "${slug}" (${sn})`,
        `includeConfig=${Boolean(input.includeConfig)}`,
      );

      try {
        const rawSummary = await cnbWorkspaceGetJson<unknown>(buildLogUrl, cleanCookie, {
          referer,
        });

        let configSummary: WorkspaceBuildConfigSummary | undefined;
        if (input.includeConfig) {
          await delayMs(FOLLOWUP_REQUEST_DELAY_MS);
          const configUrl = `${CNB_BASE_URL}/${encodedSlug}/-/build/logs/${encodedSn}/config`;
          try {
            const rawConfig = await cnbWorkspaceGetJson<unknown>(configUrl, cleanCookie, {
              referer: buildLogUrl,
            });
            configSummary = extractConfigSummary(rawConfig);
          } catch (configErr) {
            if (configErr instanceof WorkspaceParserError && configErr.kind === 'AUTH') {
              throw configErr;
            }
            const configErrMsg =
              configErr instanceof Error ? configErr.message : String(configErr);
            logger.warn(
              'workspaceParser.parseWorkspaceBuildLog',
              `Optional config summary fetch skipped for "${sn}": ${configErrMsg}`,
            );
          }
        }

        const detail = mapBuildLogPayload(rawSummary, slug, sn, configSummary);

        logger.info(
          'workspaceParser.parseWorkspaceBuildLog',
          `Fetched build log "${detail.sn}" (${detail.buildStatus}, ${detail.stages.length} stage(s))`,
          configSummary ? `envKeys=${configSummary.envKeys.length}` : undefined,
        );

        return {
          ok: true,
          data: detail,
          timestamp: Date.now(),
        };
      } catch (err) {
        const message =
          err instanceof WorkspaceParserError
            ? err.message
            : `获取容器 "${sn}" 构建日志失败`;
        const cause = err instanceof Error ? err.message : String(err);

        logger.error(
          'workspaceParser.parseWorkspaceBuildLog',
          `Build log parse failed for "${sn}": ${message}`,
          cause,
        );

        return {
          ok: false,
          error: {
            code: mapFailureCode(err),
            message,
            cause,
          },
          timestamp: Date.now(),
        };
      }
    },

    async parseWorkspaceStageLog(
      input: WorkspaceStageLogInput,
    ): Promise<ServiceResult<WorkspaceStageLog>> {
      const username = input.username.trim();
      const cleanCookie = normalizeWorkspaceCookie(input.cookie);
      const slug = input.slug.trim();
      const sn = input.sn.trim();
      const pipelineId = input.pipelineId.trim();
      const stageId = input.stageId.trim();

      if (!username || !cleanCookie || !slug || !sn || !pipelineId || !stageId) {
        logger.warn(
          'workspaceParser.parseWorkspaceStageLog',
          'Rejected stage log fetch due to missing parameters',
          `hasSlug=${Boolean(slug)} hasSn=${Boolean(sn)} hasPipeline=${Boolean(pipelineId)} hasStage=${Boolean(stageId)}`,
        );
        return validationFailure(
          'Username, cookie, slug, sn, pipelineId, and stageId are required to fetch stage log',
        );
      }

      const encodedSlug = encodePathSegments(slug);
      if (!encodedSlug) {
        return validationFailure('Invalid repository slug');
      }

      const encodedSn = encodeURIComponent(sn);
      const encodedPipelineId = encodeURIComponent(pipelineId);
      const encodedStageId = encodeURIComponent(stageId);
      const statusSuffix = input.status?.trim()
        ? `&status=${encodeURIComponent(input.status.trim())}`
        : '';

      const stageUrl = `${CNB_BASE_URL}/${encodedSlug}/-/build/logs/${encodedPipelineId}/stage/${encodedStageId}?sn=${encodedSn}${statusSuffix}`;
      const buildLogReferer = `${CNB_BASE_URL}/${encodedSlug}/-/build/logs/${encodedSn}`;

      logger.verbose(
        'workspaceParser.parseWorkspaceStageLog',
        `Fetching stage "${stageId}" log for "${slug}" (${sn})`,
      );

      try {
        const rawStage = await cnbWorkspaceGetJson<unknown>(stageUrl, cleanCookie, {
          referer: buildLogReferer,
        });

        const stageLog = mapStageLogPayload(rawStage, stageId, input.status);

        logger.info(
          'workspaceParser.parseWorkspaceStageLog',
          `Fetched stage "${stageLog.id}" (${stageLog.lines.length} line(s)) for "${sn}"`,
        );

        return {
          ok: true,
          data: stageLog,
          timestamp: Date.now(),
        };
      } catch (err) {
        const message =
          err instanceof WorkspaceParserError
            ? err.message
            : `获取阶段 "${stageId}" 日志失败`;
        const cause = err instanceof Error ? err.message : String(err);

        logger.error(
          'workspaceParser.parseWorkspaceStageLog',
          `Stage log parse failed for "${sn}/${stageId}": ${message}`,
          cause,
        );

        return {
          ok: false,
          error: {
            code: mapFailureCode(err),
            message,
            cause,
          },
          timestamp: Date.now(),
        };
      }
    },
  };
}
