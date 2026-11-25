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
} from '@/contracts';

export const STALE_THRESHOLD_MS = 60 * 60 * 1000;
export const MIN_REFRESH_INTERVAL_MINUTES = 1;
export const MAX_REFRESH_INTERVAL_MINUTES = 1440;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoRefreshOnLaunch: true,
  autoRefreshEnabled: false,
  autoRefreshIntervalMinutes: 15,
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
