/**
 * Payload parsers and CNB Cloud Native Dev API adapters.
 * Converts raw JSON payloads from cnb.cool into pure contract models
 * with defensive defaults and strict secret omission.
 */

import type {
  BuildResultStatus,
  WorkspaceAiUsage,
  WorkspaceBuildConfigSummary,
  WorkspaceBuildLogDetail,
  WorkspaceLifecycleStatus,
  WorkspaceListSnapshot,
  WorkspaceStageLog,
  WorkspaceStageSummary,
  WorkspaceSummary,
} from '@/contracts';
import { CNB_BASE_URL, WorkspaceParserError, encodePathSegments } from './httpClient';
import { normalizeStageName, sanitizeLogLine } from './sanitizer';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readNonNegativeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readNonNegativeInt(value: unknown, fallback = 0): number {
  return Math.floor(readNonNegativeNumber(value, fallback));
}

function readBuildStatus(value: unknown, fallback: BuildResultStatus = 'pending'): BuildResultStatus {
  const text = readString(value);
  return text || fallback;
}

function extractCpusFromLabels(labels: unknown): number | undefined {
  if (!Array.isArray(labels)) {
    return undefined;
  }
  for (const label of labels) {
    if (!isRecord(label) || readString(label.key).toLowerCase() !== 'cpus') {
      continue;
    }
    const rawValues = label.value;
    if (Array.isArray(rawValues) && rawValues.length > 0) {
      const parsed = readOptionalFiniteNumber(rawValues[0]);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function extractCookieOwnerUsername(rawUser: unknown): string {
  if (!isRecord(rawUser)) {
    return '';
  }
  return readString(rawUser.username);
}

export function mapWorkspaceListPayload(
  rawPayload: unknown,
  requestedUsername: string,
  ownerUsername: string,
  requestedPage: number,
  requestedPageSize: number,
): WorkspaceListSnapshot {
  if (!isRecord(rawPayload)) {
    throw new WorkspaceParserError('PARSE', '工作空间列表响应格式异常');
  }

  const rawItems = Array.isArray(rawPayload.list) ? rawPayload.list : [];
  const items: WorkspaceSummary[] = [];

  for (const entry of rawItems) {
    if (!isRecord(entry)) {
      continue;
    }
    const sn = readString(entry.sn);
    const slug = readString(entry.slug);
    if (!sn) {
      continue;
    }

    const pipelineId = readString(entry.pipeline_id) || `${sn}-001`;
    const rawLifecycle = readString(entry.status).toLowerCase();
    const status: WorkspaceLifecycleStatus = rawLifecycle === 'running' ? 'running' : 'closed';
    const repoUrl =
      readString(entry.repo_url) || (slug ? `${CNB_BASE_URL}/${encodePathSegments(slug)}` : '');

    items.push({
      sn,
      pipelineId,
      slug,
      branch: readString(entry.branch),
      userName: readString(entry.user_name),
      status,
      createTime: readString(entry.create_time),
      durationMs: readNonNegativeNumber(entry.duration, 0),
      fileCount: readNonNegativeInt(entry.file_count, 0),
      repoUrl,
      ssh: Boolean(entry.ssh),
    });
  }

  const total = readNonNegativeInt(rawPayload.total, items.length);
  const pageInfo = isRecord(rawPayload.pageInfo) ? rawPayload.pageInfo : null;
  const page = Math.max(1, readNonNegativeInt(pageInfo?.page, requestedPage));
  const pageSize = Math.max(1, readNonNegativeInt(pageInfo?.pageSize, requestedPageSize));
  const hasMore =
    typeof rawPayload.hasMore === 'boolean'
      ? rawPayload.hasMore
      : (page - 1) * pageSize + items.length < total;

  const ownerMismatch = Boolean(
    ownerUsername && requestedUsername.toLowerCase() !== ownerUsername.toLowerCase(),
  );

  return {
    requestedUsername,
    ownerUsername,
    ownerMismatch,
    total,
    page,
    pageSize,
    hasMore,
    fetchedAt: Date.now(),
    items,
  };
}

function buildOrderedStages(pipeline: Record<string, unknown> | null): WorkspaceStageSummary[] {
  if (!pipeline) {
    return [];
  }

  const mapStageNode = (
    node: Record<string, unknown>,
    fallbackId: string,
  ): WorkspaceStageSummary => {
    const id = readString(node.id) || fallbackId;
    return {
      id,
      name: normalizeStageName(id, readString(node.name)),
      status: readBuildStatus(node.status, 'pending'),
      durationMs: readNonNegativeNumber(node.duration, 0),
    };
  };

  const presetMap = new Map<string, WorkspaceStageSummary>();
  for (const key of ['prepare', 'beforeEnd', 'debugDetection', 'end'] as const) {
    const node = pipeline[key];
    if (isRecord(node)) {
      const summary = mapStageNode(node, key);
      presetMap.set(key, summary);
    }
  }

  const customStages: WorkspaceStageSummary[] = [];
  if (Array.isArray(pipeline.stages)) {
    for (let i = 0; i < pipeline.stages.length; i++) {
      const stageNode = pipeline.stages[i];
      if (!isRecord(stageNode)) {
        continue;
      }
      customStages.push(mapStageNode(stageNode, `stage-${i}`));
    }
  }

  // Canonical log-page display order: Prepare -> custom stages -> BeforeEnd -> DebugDetection -> End.
  const ordered: WorkspaceStageSummary[] = [];
  const prepareStage = presetMap.get('prepare');
  if (prepareStage) {
    ordered.push(prepareStage);
  }
  ordered.push(...customStages);

  for (const trailingKey of ['beforeEnd', 'debugDetection', 'end'] as const) {
    const trailingStage = presetMap.get(trailingKey);
    if (trailingStage) {
      ordered.push(trailingStage);
    }
  }

  return ordered;
}

/**
 * Extracts structural pipeline configuration metadata (image, stage names, and env keys)
 * while strictly discarding all plaintext env values.
 */
export function extractConfigSummary(rawConfig: unknown): WorkspaceBuildConfigSummary | undefined {
  if (!isRecord(rawConfig)) {
    return undefined;
  }

  const rawMatch = rawConfig.match;
  if (typeof rawMatch !== 'string' || !rawMatch.trim()) {
    return undefined;
  }

  let parsedMatch: unknown;
  try {
    parsedMatch = JSON.parse(rawMatch);
  } catch {
    return undefined;
  }

  let image: string | undefined;
  const stageSet = new Set<string>();
  const envKeySet = new Set<string>();

  const visitNode = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visitNode(item);
      }
      return;
    }
    if (!isRecord(node)) {
      return;
    }

    if (!image) {
      if (typeof node.image === 'string' && node.image.trim()) {
        image = node.image.trim();
      } else if (isRecord(node.docker) && typeof node.docker.image === 'string' && node.docker.image.trim()) {
        image = node.docker.image.trim();
      }
    }

    if (Array.isArray(node.stages)) {
      for (const stageItem of node.stages) {
        if (typeof stageItem === 'string' && stageItem.trim()) {
          stageSet.add(stageItem.trim());
        } else if (isRecord(stageItem)) {
          const stageName = readString(stageItem.name) || readString(stageItem.id);
          if (stageName) {
            stageSet.add(stageName);
          }
        }
      }
    }

    // Collect ONLY env key names; never read or store env values.
    if (isRecord(node.env)) {
      for (const key of Object.keys(node.env)) {
        const cleanKey = key.trim();
        if (cleanKey) {
          envKeySet.add(cleanKey);
        }
      }
    } else if (Array.isArray(node.env)) {
      for (const item of node.env) {
        if (typeof item === 'string') {
          const eqIdx = item.indexOf('=');
          const cleanKey = (eqIdx >= 0 ? item.slice(0, eqIdx) : item).trim();
          if (cleanKey) {
            envKeySet.add(cleanKey);
          }
        } else if (isRecord(item)) {
          for (const key of Object.keys(item)) {
            const cleanKey = key.trim();
            if (cleanKey) {
              envKeySet.add(cleanKey);
            }
          }
        }
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'env') {
        continue;
      }
      visitNode(child);
    }
  };

  visitNode(parsedMatch);

  const stages = Array.from(stageSet);
  const envKeys = Array.from(envKeySet).sort((a, b) => a.localeCompare(b));

  if (!image && stages.length === 0 && envKeys.length === 0) {
    return undefined;
  }

  return {
    image,
    stages,
    envKeys,
  };
}

export function mapBuildLogPayload(
  rawPayload: unknown,
  fallbackSlug: string,
  fallbackSn: string,
  configSummary?: WorkspaceBuildConfigSummary,
): WorkspaceBuildLogDetail {
  if (!isRecord(rawPayload)) {
    throw new WorkspaceParserError('PARSE', '构建日志响应格式异常');
  }

  if (rawPayload.code === 204) {
    const message = readString(rawPayload.message) || '未找到该容器的构建日志信息（可能已过期）';
    throw new WorkspaceParserError('NOT_FOUND', message, 204);
  }

  const sn = readString(rawPayload.sn) || fallbackSn;
  const slug = readString(rawPayload.slug) || fallbackSlug;

  let primaryPipeline: Record<string, unknown> | null = null;
  if (isRecord(rawPayload.pipelines)) {
    const preferredKey = `${sn}-001`;
    const preferred = rawPayload.pipelines[preferredKey];
    if (isRecord(preferred)) {
      primaryPipeline = preferred;
    } else {
      for (const candidate of Object.values(rawPayload.pipelines)) {
        if (isRecord(candidate)) {
          primaryPipeline = candidate;
          break;
        }
      }
    }
  }

  const pipelineId =
    (primaryPipeline ? readString(primaryPipeline.id) : '') || `${sn}-001`;
  const meta = primaryPipeline && isRecord(primaryPipeline.meta) ? primaryPipeline.meta : null;

  const image = (meta ? readString(meta.image) : '') || undefined;
  const cpus =
    (meta ? readOptionalFiniteNumber(meta.cpus) : undefined) ??
    (primaryPipeline ? extractCpusFromLabels(primaryPipeline.labels) : undefined);
  const isGpu = meta && typeof meta.isGpu === 'boolean' ? meta.isGpu : undefined;
  const metricCoreHours = meta ? readOptionalFiniteNumber(meta.metricCoreHours) : undefined;
  const ip = (primaryPipeline ? readString(primaryPipeline.ip) : '') || undefined;
  const port = primaryPipeline ? readOptionalFiniteNumber(primaryPipeline.port) : undefined;

  let aiUsage: WorkspaceAiUsage | undefined;
  if (primaryPipeline && isRecord(primaryPipeline.aiUsage)) {
    const totalTokens = readNonNegativeNumber(primaryPipeline.aiUsage.total_tokens, -1);
    const totalMilliCredit = readNonNegativeNumber(
      primaryPipeline.aiUsage.total_milli_credit,
      -1,
    );
    if (totalTokens >= 0 || totalMilliCredit >= 0) {
      aiUsage = {
        totalTokens: Math.max(0, totalTokens),
        totalMilliCredit: Math.max(0, totalMilliCredit),
      };
    }
  }

  const encodedSlug = encodePathSegments(slug);
  const buildLogUrl =
    readString(rawPayload.buildLogUrl) ||
    `${CNB_BASE_URL}/${encodedSlug}/-/build/logs/${encodeURIComponent(sn)}`;

  return {
    sn,
    slug,
    title: readString(rawPayload.title) || '云原生开发',
    event: readString(rawPayload.event),
    sha: readString(rawPayload.sha),
    buildStatus: readBuildStatus(
      rawPayload.status,
      primaryPipeline ? readBuildStatus(primaryPipeline.status, 'pending') : 'pending',
    ),
    startTimestamp: readNonNegativeNumber(rawPayload.startTimestamp, 0),
    endTimestamp: readNonNegativeNumber(rawPayload.endTimestamp, 0),
    durationMs: readNonNegativeNumber(rawPayload.duration, 0),
    canRebuild: Boolean(rawPayload.canRebuild),
    logRetentionDays: readNonNegativeInt(rawPayload.logRetentionDays, 7),
    buildLogUrl,
    pipelineId,
    image,
    cpus,
    isGpu,
    metricCoreHours,
    ip,
    port,
    aiUsage,
    stages: buildOrderedStages(primaryPipeline),
    configSummary,
    fetchedAt: Date.now(),
  };
}

export function mapStageLogPayload(
  rawPayload: unknown,
  fallbackStageId: string,
  fallbackStatus?: string,
): WorkspaceStageLog {
  if (!isRecord(rawPayload)) {
    throw new WorkspaceParserError('PARSE', '阶段日志响应格式异常');
  }

  if (rawPayload.code === 204) {
    const message = readString(rawPayload.message) || '未找到该阶段的构建日志信息';
    throw new WorkspaceParserError('NOT_FOUND', message, 204);
  }

  const id = readString(rawPayload.id) || fallbackStageId;
  const name = normalizeStageName(id, readString(rawPayload.name));
  const rawLines = Array.isArray(rawPayload.content) ? rawPayload.content : [];
  const lines = rawLines.map((line) => sanitizeLogLine(typeof line === 'string' ? line : String(line ?? '')));
  const rawError = typeof rawPayload.error === 'string' ? rawPayload.error : '';

  return {
    id,
    name,
    status: readBuildStatus(rawPayload.status, fallbackStatus || 'pending'),
    durationMs: readNonNegativeNumber(rawPayload.duration, 0),
    startTime: readNonNegativeNumber(rawPayload.startTime, 0),
    endTime: readNonNegativeNumber(rawPayload.endTime, 0),
    error: sanitizeLogLine(rawError),
    lines,
  };
}
