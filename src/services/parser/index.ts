/**
 * Usage Parser Service.
 * Queries real organization quota data from CNB (cnb.cool) using read-only GET requests,
 * converts raw milli-credits and CPU-seconds into Credits / core-hours, allocates sequential
 * quota packs and pre-frozen amounts, and returns a structured UsageSnapshot.
 */

import type {
  LogReporter,
  MetricQuotaGroup,
  ParserInput,
  ParserPort,
  QuotaPackage,
  ServiceResult,
  UsageSnapshot,
} from '@/contracts';
import {
  CNB_BASE_URL,
  CnbParserError,
  cnbHttpGet,
  delayMs,
  sanitizeCookieHeader,
} from './httpClient';
import {
  type CnbChargeNode,
  type CnbGroupSummary,
  type ResourceMetricSpec,
  TARGET_METRIC_SPECS,
  computePackagesForMetric,
  extractChargeNodeFromHtml,
  extractUserGroupsFromHtml,
} from './cnbHtmlParser';

const ORG_REQUEST_DELAY_MS = 450;
const MAX_GROUP_PAGES = 100;
const GROUP_PAGE_SIZE = 100;

interface CnbUserResponse {
  username?: string;
  nickname?: string;
}

interface ResolvedOrgCharge {
  effectivePath: string;
  displayLabel: string;
  charge: CnbChargeNode;
}

function encodeOrgPath(orgPath: string): string {
  return orgPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function fetchCurrentCookieUser(
  cookie: string,
  logger: LogReporter,
): Promise<CnbUserResponse> {
  const url = `${CNB_BASE_URL}/user`;
  logger.verbose('parser.getMe', 'Verifying CNB cookie via GET /user');

  const res = await cnbHttpGet(url, cookie, { accept: 'application/json' });
  if (res.status === 401) {
    throw new CnbParserError('AUTH', 'Cookie 无效或已过期（HTTP 401）', 401);
  }
  if (res.status !== 200) {
    throw new CnbParserError(
      'UPSTREAM',
      `校验登录状态失败（HTTP ${res.status}）`,
      res.status,
    );
  }

  try {
    return JSON.parse(res.body) as CnbUserResponse;
  } catch {
    throw new CnbParserError(
      'PARSE',
      '用户信息接口返回非 JSON 内容，可能被安全校验拦截或 Cookie 已失效',
    );
  }
}

async function fetchSelfOrganizations(
  cookie: string,
  logger: LogReporter,
): Promise<CnbGroupSummary[]> {
  const groups: CnbGroupSummary[] = [];

  for (let page = 1; page <= MAX_GROUP_PAGES; page++) {
    const url = `${CNB_BASE_URL}/user/groups?page=${page}&page_size=${GROUP_PAGE_SIZE}`;
    logger.verbose('parser.getGroups', `Fetching self organizations page ${page}`);

    const res = await cnbHttpGet(url, cookie, { accept: 'application/json' });
    if (res.status === 401) {
      throw new CnbParserError('AUTH', 'Cookie 无效或已过期（HTTP 401）', 401);
    }
    if (res.status !== 200) {
      throw new CnbParserError(
        'UPSTREAM',
        `获取所属组织列表失败（HTTP ${res.status}）`,
        res.status,
      );
    }

    let pageItems: unknown;
    try {
      pageItems = JSON.parse(res.body);
    } catch {
      throw new CnbParserError(
        'PARSE',
        '组织列表接口返回非 JSON 数据（请检查登录态或网络环境）',
      );
    }

    if (!Array.isArray(pageItems)) {
      throw new CnbParserError('PARSE', '组织列表响应结构异常');
    }

    groups.push(...(pageItems as CnbGroupSummary[]));

    const totalHeader = res.headers.get('x-cnb-total');
    const serverPageSizeHeader = res.headers.get('x-cnb-page-size');
    const serverPageSize = serverPageSizeHeader
      ? Number.parseInt(serverPageSizeHeader, 10) || GROUP_PAGE_SIZE
      : GROUP_PAGE_SIZE;

    if (totalHeader !== null) {
      const totalCount = Number.parseInt(totalHeader, 10);
      if ((Number.isFinite(totalCount) && groups.length >= totalCount) || pageItems.length === 0) {
        break;
      }
    } else if (pageItems.length < serverPageSize) {
      break;
    }
  }

  return groups;
}

async function fetchPublicUserOrganizations(
  cookie: string,
  username: string,
  logger: LogReporter,
): Promise<CnbGroupSummary[]> {
  const url = `${CNB_BASE_URL}/u/${encodeURIComponent(username)}/groups`;
  logger.verbose('parser.getProfileGroups', `Fetching public organization page for "${username}"`);

  const res = await cnbHttpGet(url, cookie, {
    accept: 'text/html,application/xhtml+xml',
  });
  if (res.status === 401) {
    throw new CnbParserError('AUTH', 'Cookie 无效或已过期（HTTP 401）', 401);
  }
  if (res.status === 404) {
    throw new CnbParserError('NOT_FOUND', `未找到用户 "${username}" 的公开组织页面`, 404);
  }
  if (res.status !== 200) {
    throw new CnbParserError(
      'UPSTREAM',
      `获取用户组织页面失败（HTTP ${res.status}）`,
      res.status,
    );
  }

  return extractUserGroupsFromHtml(res.body);
}

async function fetchOrganizationCharge(
  cookie: string,
  orgPath: string,
): Promise<{ charge: CnbChargeNode | null; errorMessage: string | null }> {
  const url = `${CNB_BASE_URL}/${encodeOrgPath(orgPath)}/-/settings/charge`;
  const res = await cnbHttpGet(url, cookie, {
    accept: 'text/html,application/xhtml+xml',
  });

  if (res.status === 401) {
    throw new CnbParserError('AUTH', 'Cookie 无效或已过期（HTTP 401）', 401);
  }
  if (res.status === 404) {
    return { charge: null, errorMessage: `组织 "${orgPath}" 不存在或无访问权限（HTTP 404）` };
  }
  if (res.status !== 200) {
    return { charge: null, errorMessage: `组织 "${orgPath}" 用量页请求失败（HTTP ${res.status}）` };
  }

  const charge = extractChargeNodeFromHtml(res.body);
  const usageStatus = charge.usage?.status;
  const usageData = charge.usage?.data;
  if (usageStatus !== 'success' || !usageData) {
    const reason = res.body.includes('您似乎迷失')
      ? '子组织无独立账单页'
      : '无用量读取权限或 usage.status != success';
    return { charge: null, errorMessage: `${orgPath}: ${reason}` };
  }

  return { charge, errorMessage: null };
}

function buildMetricGroupFromOrgs(
  resolvedOrgs: ResolvedOrgCharge[],
  spec: ResourceMetricSpec,
): MetricQuotaGroup {
  const showOrgPrefix = resolvedOrgs.length > 1;
  const allPackages: QuotaPackage[] = [];
  let aggregateUsed = 0;
  let aggregateFrozen = 0;

  for (const org of resolvedOrgs) {
    const prefix = showOrgPrefix ? org.displayLabel : undefined;
    const computed = computePackagesForMetric(
      org.charge,
      spec,
      org.effectivePath,
      prefix,
    );
    allPackages.push(...computed.packages);
    aggregateUsed += computed.usedTotal;
    aggregateFrozen += computed.frozenTotal;
  }

  // Ensure every metric group has at least one package to satisfy UsageSnapshot invariants.
  if (allPackages.length === 0) {
    const fallbackPkg: QuotaPackage = {
      id: `${spec.resType}:default`,
      name: '免费配额',
      total: 0,
      used: Math.round(aggregateUsed * 100) / 100,
      unit: spec.unit,
    };
    const roundedFrozen = Math.round(aggregateFrozen * 100) / 100;
    if (roundedFrozen > 0) {
      fallbackPkg.locked = roundedFrozen;
    }
    allPackages.push(fallbackPkg);
  }

  return {
    metric: spec.metric,
    label: spec.label,
    unit: spec.unit,
    packages: allPackages,
  };
}

/**
 * Creates a ParserPort instance bound to an injected LogReporter.
 */
export function createParserService(logger: LogReporter): ParserPort {
  return {
    async parseUsage(input: ParserInput): Promise<ServiceResult<UsageSnapshot>> {
      const username = input.username.trim();
      const cleanCookie = sanitizeCookieHeader(input.cookie);

      if (!username || !cleanCookie) {
        logger.warn(
          'parser.parseUsage',
          'Rejected usage parse due to missing credentials',
          `hasUsername=${Boolean(username)} hasCookie=${Boolean(cleanCookie)}`,
        );
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Username and cookie are required to parse usage',
          },
          timestamp: Date.now(),
        };
      }

      logger.verbose(
        'parser.parseUsage',
        `Starting live CNB quota fetch for "${username}"`,
        `cookieLength=${cleanCookie.length}`,
      );

      try {
        const me = await fetchCurrentCookieUser(cleanCookie, logger);
        const cookieUsername = (me.username ?? '').trim();
        const identityMismatch = Boolean(
          cookieUsername && username.toLowerCase() !== cookieUsername.toLowerCase(),
        );

        if (identityMismatch) {
          logger.warn(
            'parser.parseUsage',
            `Target username "${username}" differs from cookie user "${cookieUsername}", falling back to public groups`,
          );
        }

        const groups = identityMismatch
          ? await fetchPublicUserOrganizations(cleanCookie, username, logger)
          : await fetchSelfOrganizations(cleanCookie, logger);

        if (groups.length === 0) {
          logger.warn('parser.parseUsage', `No organizations found for "${username}"`);
          return {
            ok: false,
            error: {
              code: 'PARSER_ERROR',
              message: `账户 "${username}" 名下未查询到任何所属组织`,
            },
            timestamp: Date.now(),
          };
        }

        const resolvedOrgs: ResolvedOrgCharge[] = [];
        const seenRootOrgs = new Set<string>();
        const orgErrors: string[] = [];

        let hasMadeChargeRequest = false;

        for (const group of groups) {
          const orgPath = (group?.path || group?.name || '').trim();
          if (!orgPath || seenRootOrgs.has(orgPath)) {
            continue;
          }

          if (hasMadeChargeRequest) {
            await delayMs(ORG_REQUEST_DELAY_MS);
          }
          hasMadeChargeRequest = true;

          let effectivePath = orgPath;
          let { charge, errorMessage } = await fetchOrganizationCharge(cleanCookie, orgPath);

          // Sub-organizations share billing with their root organization on CNB.
          if (!charge && orgPath.includes('/')) {
            const rootPath = orgPath.split('/')[0]?.trim() ?? '';
            if (rootPath) {
              if (seenRootOrgs.has(rootPath)) {
                logger.verbose(
                  'parser.parseUsage',
                  `Skipping sub-org "${orgPath}" because root org "${rootPath}" is already included`,
                );
                continue;
              }
              await delayMs(ORG_REQUEST_DELAY_MS);
              const rootRes = await fetchOrganizationCharge(cleanCookie, rootPath);
              if (rootRes.charge) {
                charge = rootRes.charge;
                errorMessage = null;
                effectivePath = rootPath;
                logger.info(
                  'parser.parseUsage',
                  `Resolved sub-org "${orgPath}" via root org "${rootPath}"`,
                );
              } else {
                errorMessage = rootRes.errorMessage ?? errorMessage;
              }
            }
          }

          if (!charge) {
            if (errorMessage) {
              orgErrors.push(errorMessage);
              logger.warn('parser.parseUsage', `Failed org charge lookup: ${errorMessage}`);
            }
            continue;
          }

          if (seenRootOrgs.has(effectivePath)) {
            continue;
          }
          seenRootOrgs.add(effectivePath);

          const displayLabel =
            effectivePath === orgPath
              ? (group?.remark || group?.name || orgPath).trim()
              : effectivePath;

          resolvedOrgs.push({
            effectivePath,
            displayLabel,
            charge,
          });
        }

        if (resolvedOrgs.length === 0) {
          const detail = orgErrors[0] ?? '没有可读的组织账单权限';
          logger.error(
            'parser.parseUsage',
            `All ${groups.length} organization charge queries failed for "${username}"`,
            orgErrors.join('; '),
          );
          return {
            ok: false,
            error: {
              code: 'PARSER_ERROR',
              message: `无法获取 "${username}" 所属组织的用量数据：${detail}`,
              cause: orgErrors.join('; '),
            },
            timestamp: Date.now(),
          };
        }

        const aiSpec = TARGET_METRIC_SPECS[0];
        const buildSpec = TARGET_METRIC_SPECS[1];
        const devSpec = TARGET_METRIC_SPECS[2];
        if (!aiSpec || !buildSpec || !devSpec) {
          throw new CnbParserError('PARSE', 'Internal resource metric configuration missing');
        }

        const aiCredits = buildMetricGroupFromOrgs(resolvedOrgs, aiSpec);
        const buildCpu = buildMetricGroupFromOrgs(resolvedOrgs, buildSpec);
        const devCpu = buildMetricGroupFromOrgs(resolvedOrgs, devSpec);

        const snapshot: UsageSnapshot = {
          username,
          fetchedAt: Date.now(),
          aiCredits,
          buildCpu,
          devCpu,
        };

        const totalPackages =
          aiCredits.packages.length + buildCpu.packages.length + devCpu.packages.length;

        logger.info(
          'parser.parseUsage',
          `Fetched live CNB usage for "${username}" across ${resolvedOrgs.length} org(s), ${totalPackages} package(s)`,
          orgErrors.length > 0 ? `skippedOrgs=${orgErrors.length}` : undefined,
        );

        return {
          ok: true,
          data: snapshot,
          timestamp: Date.now(),
        };
      } catch (err) {
        const message =
          err instanceof CnbParserError
            ? err.message
            : `获取 "${username}" CNB 用量数据时发生异常`;
        const cause = err instanceof Error ? err.message : String(err);

        logger.error('parser.parseUsage', `Live parse failed for "${username}": ${message}`, cause);

        return {
          ok: false,
          error: {
            code: 'PARSER_ERROR',
            message,
            cause,
          },
          timestamp: Date.now(),
        };
      }
    },
  };
}
