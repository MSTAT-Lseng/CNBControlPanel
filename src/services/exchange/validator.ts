/**
 * Validation and sanitization helpers inside the Update Exchange Service.
 */

import type {
  AppSettings,
  CreateAccountInput,
  MetricQuotaGroup,
  QuotaPackage,
  UpdateAccountInput,
  UsageSnapshot,
  WorkspaceBuildLogQueryInput,
  WorkspaceLifecycleStatus,
  WorkspaceListSnapshot,
  WorkspaceStageLogQueryInput,
  WorkspaceSyncInput,
} from '@/contracts';

export const STALE_THRESHOLD_MS = 60 * 60 * 1000;
export const MIN_REFRESH_INTERVAL_MINUTES = 1;
export const MAX_REFRESH_INTERVAL_MINUTES = 1440;
export const MIN_LOG_RETENTION_HOURS = 1;
export const MAX_LOG_RETENTION_HOURS = 720;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoRefreshOnLaunch: true,
  autoRefreshEnabled: false,
  autoRefreshIntervalMinutes: 15,
  autoLogCleanupEnabled: false,
  logRetentionHours: 24,
};

export interface ValidationOutcome<T> {
  valid: boolean;
  value?: T;
  message?: string;
}

/**
 * Masks sensitive cookie values while preserving prefix and suffix characters for verification.
 */
export function maskCookie(cookie: string): string {
  const trimmed = cookie.trim();
  if (!trimmed) {
    return '未设置';
  }
  if (trimmed.length <= 4) {
    return `${trimmed.slice(0, 1)}••••`;
  }
  if (trimmed.length <= 12) {
    return `${trimmed.slice(0, 3)}••••${trimmed.slice(-3)}`;
  }
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

/**
 * Determines whether an account's usage data requires a refresh (> 1 hour or never synced).
 */
export function isAccountStale(lastSyncedAt: number | null, now = Date.now()): boolean {
  if (lastSyncedAt === null) {
    return true;
  }
  return now - lastSyncedAt > STALE_THRESHOLD_MS;
}

/**
 * Validates input payload for creating a new CNB account.
 */
export function validateCreateAccount(
  input: CreateAccountInput,
): ValidationOutcome<{ username: string; cookie: string; remark: string }> {
  const username = input.username.trim();
  const cookie = input.cookie.trim();
  const remark = (input.remark ?? '').trim();

  if (!username) {
    return { valid: false, message: '请输入用户名 (username)' };
  }
  if (username.length > 64) {
    return { valid: false, message: '用户名长度不能超过 64 个字符' };
  }
  if (!cookie) {
    return { valid: false, message: '请输入 Cookie' };
  }
  if (remark.length > 120) {
    return { valid: false, message: '备注长度不能超过 120 个字符' };
  }

  return { valid: true, value: { username, cookie, remark } };
}

/**
 * Validates input payload for updating an existing CNB account.
 */
export function validateUpdateAccount(
  input: UpdateAccountInput,
): ValidationOutcome<{ username: string; cookie: string; remark: string }> {
  const username = input.username.trim();
  const cookie = input.cookie.trim();
  const remark = (input.remark ?? '').trim();

  if (!username) {
    return { valid: false, message: '缺少用户名标识' };
  }
  if (!cookie) {
    return { valid: false, message: 'Cookie 不能为空' };
  }
  if (remark.length > 120) {
    return { valid: false, message: '备注长度不能超过 120 个字符' };
  }

  return { valid: true, value: { username, cookie, remark } };
}

/**
 * Normalizes partial app settings updates while clamping interval minutes.
 */
export function sanitizeSettings(
  current: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  const rawMinutes = patch.autoRefreshIntervalMinutes ?? current.autoRefreshIntervalMinutes;
  const roundedMinutes = Number.isFinite(rawMinutes) ? Math.round(rawMinutes) : current.autoRefreshIntervalMinutes;
  const clampedMinutes = Math.max(
    MIN_REFRESH_INTERVAL_MINUTES,
    Math.min(MAX_REFRESH_INTERVAL_MINUTES, roundedMinutes),
  );

  const rawHours = patch.logRetentionHours ?? current.logRetentionHours;
  const roundedHours = Number.isFinite(rawHours) ? Math.round(rawHours) : current.logRetentionHours;
  const clampedHours = Math.max(
    MIN_LOG_RETENTION_HOURS,
    Math.min(MAX_LOG_RETENTION_HOURS, roundedHours),
  );

  return {
    autoRefreshOnLaunch:
      typeof patch.autoRefreshOnLaunch === 'boolean'
        ? patch.autoRefreshOnLaunch
        : current.autoRefreshOnLaunch,
    autoRefreshEnabled:
      typeof patch.autoRefreshEnabled === 'boolean'
        ? patch.autoRefreshEnabled
        : current.autoRefreshEnabled,
    autoRefreshIntervalMinutes: clampedMinutes,
    autoLogCleanupEnabled:
      typeof patch.autoLogCleanupEnabled === 'boolean'
        ? patch.autoLogCleanupEnabled
        : current.autoLogCleanupEnabled,
    logRetentionHours: clampedHours,
  };
}

function isValidPackage(pkg: QuotaPackage): boolean {
  if (!pkg || !pkg.id || !pkg.name) {
    return false;
  }
  if (!Number.isFinite(pkg.total) || pkg.total < 0) {
    return false;
  }
  if (!Number.isFinite(pkg.used) || pkg.used < 0) {
    return false;
  }
  if (pkg.locked !== undefined && (!Number.isFinite(pkg.locked) || pkg.locked < 0)) {
    return false;
  }
  return pkg.unit === 'Credits' || pkg.unit === '核时';
}

function isValidMetricGroup(group: MetricQuotaGroup): boolean {
  if (!group || !Array.isArray(group.packages) || group.packages.length === 0) {
    return false;
  }
  return group.packages.every(isValidPackage);
}

/**
 * Validates structural invariants of a UsageSnapshot returned by the Parser Service.
 */
export function validateUsageSnapshot(snapshot: UsageSnapshot): ValidationOutcome<UsageSnapshot> {
  if (!snapshot || !snapshot.username.trim() || !Number.isFinite(snapshot.fetchedAt)) {
    return { valid: false, message: 'Parsed usage snapshot is missing metadata' };
  }
  if (
    !isValidMetricGroup(snapshot.aiCredits) ||
    !isValidMetricGroup(snapshot.buildCpu) ||
    !isValidMetricGroup(snapshot.devCpu)
  ) {
    return { valid: false, message: 'Parsed usage snapshot contains invalid quota packages' };
  }
  return { valid: true, value: snapshot };
}

/**
 * Validates and normalizes workspace list sync inputs.
 */
export function validateWorkspaceSyncInput(input: WorkspaceSyncInput): ValidationOutcome<{
  username: string;
  page: number;
  pageSize: number;
  status: WorkspaceLifecycleStatus | '';
  slug: string;
  branch: string;
}> {
  const username = input.username.trim();
  if (!username) {
    return { valid: false, message: '用户名不能为空' };
  }

  const page =
    typeof input.page === 'number' && Number.isFinite(input.page) && input.page >= 1
      ? Math.floor(input.page)
      : 1;
  const rawPageSize =
    typeof input.pageSize === 'number' && Number.isFinite(input.pageSize)
      ? Math.floor(input.pageSize)
      : 20;
  const pageSize = Math.max(1, Math.min(100, rawPageSize));
  const status = input.status ?? '';
  if (status !== '' && status !== 'running' && status !== 'closed') {
    return { valid: false, message: '容器状态筛选参数无效' };
  }

  return {
    valid: true,
    value: {
      username,
      page,
      pageSize,
      status,
      slug: (input.slug ?? '').trim(),
      branch: (input.branch ?? '').trim(),
    },
  };
}

/**
 * Validates structural invariants of a WorkspaceListSnapshot returned by Workspace Parser or cache.
 */
export function validateWorkspaceListSnapshot(
  snapshot: WorkspaceListSnapshot,
): ValidationOutcome<WorkspaceListSnapshot> {
  if (!snapshot || !snapshot.requestedUsername.trim() || !Number.isFinite(snapshot.fetchedAt)) {
    return { valid: false, message: 'Parsed workspace list snapshot is missing metadata' };
  }
  if (!Number.isFinite(snapshot.total) || snapshot.total < 0) {
    return { valid: false, message: 'Parsed workspace list snapshot contains invalid total count' };
  }
  if (
    !Number.isFinite(snapshot.page) ||
    snapshot.page < 1 ||
    !Number.isFinite(snapshot.pageSize) ||
    snapshot.pageSize < 1
  ) {
    return { valid: false, message: 'Parsed workspace list snapshot contains invalid pagination' };
  }
  if (!Array.isArray(snapshot.items)) {
    return { valid: false, message: 'Parsed workspace list snapshot items must be an array' };
  }
  return { valid: true, value: snapshot };
}

/**
 * Validates query parameters for fetching single-container build logs.
 */
export function validateWorkspaceBuildLogQuery(
  input: WorkspaceBuildLogQueryInput,
): ValidationOutcome<WorkspaceBuildLogQueryInput> {
  const username = input.username.trim();
  const slug = input.slug.trim();
  const sn = input.sn.trim();
  if (!username || !slug || !sn) {
    return { valid: false, message: '缺少容器标识参数（username / slug / sn）' };
  }
  return {
    valid: true,
    value: {
      username,
      slug,
      sn,
      includeConfig: Boolean(input.includeConfig),
    },
  };
}

/**
 * Validates query parameters for fetching stage-level terminal output.
 */
export function validateWorkspaceStageLogQuery(
  input: WorkspaceStageLogQueryInput,
): ValidationOutcome<WorkspaceStageLogQueryInput> {
  const username = input.username.trim();
  const slug = input.slug.trim();
  const sn = input.sn.trim();
  const pipelineId = input.pipelineId.trim();
  const stageId = input.stageId.trim();
  if (!username || !slug || !sn || !pipelineId || !stageId) {
    return { valid: false, message: '缺少阶段日志查询参数' };
  }
  return {
    valid: true,
    value: {
      username,
      slug,
      sn,
      pipelineId,
      stageId,
      status: input.status?.trim() || undefined,
    },
  };
}
