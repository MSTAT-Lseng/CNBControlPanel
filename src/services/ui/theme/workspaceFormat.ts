/**
 * Formatting and semantic badge helpers for Cloud Native Dev containers and build logs.
 */

import type { BuildResultStatus, WorkspaceLifecycleStatus } from '@/contracts';
import type { Ios18Palette } from './tokens';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface StatusBadgeMeta {
  label: string;
  color: string;
  bgColor: string;
}

/**
 * Formats a millisecond duration into concise Chinese units (days, hours, minutes, seconds).
 */
export function formatDurationMs(rawMs: number): string {
  const safeMs = Number.isFinite(rawMs) && rawMs >= 0 ? rawMs : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  if (totalSeconds === 0) {
    return safeMs > 0 ? '< 1 秒' : '0 秒';
  }

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  }
  return `${seconds} 秒`;
}

/**
 * Formats an ISO8601 timestamp or Unix ms epoch in Asia/Shanghai (UTC+8).
 */
export function formatShanghaiDateTime(
  input: string | number | null | undefined,
  includeSeconds = false,
): string {
  if (input === null || input === undefined || input === '') {
    return '—';
  }

  let epochMs: number;
  if (typeof input === 'number') {
    epochMs = input;
  } else {
    const parsed = Date.parse(input);
    if (!Number.isFinite(parsed)) {
      return input;
    }
    epochMs = parsed;
  }

  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return '—';
  }

  const shifted = new Date(epochMs + SHANGHAI_OFFSET_MS);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const min = String(shifted.getUTCMinutes()).padStart(2, '0');

  if (!includeSeconds) {
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  const ss = String(shifted.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Maps container lifecycle status (running / closed) to semantic iOS 18 badge tokens.
 */
export function getLifecycleStatusMeta(
  status: WorkspaceLifecycleStatus,
  palette: Ios18Palette,
): StatusBadgeMeta {
  if (status === 'running') {
    return {
      label: '运行中',
      color: palette.accentGreen,
      bgColor: `${palette.accentGreen}1F`,
    };
  }
  return {
    label: '已关闭',
    color: palette.textSecondary,
    bgColor: palette.bgSecondaryFill,
  };
}

/**
 * Maps pipeline/stage build status (success / failed / pending / skipped) to iOS 18 badge tokens.
 */
export function getBuildStatusMeta(
  status: BuildResultStatus,
  palette: Ios18Palette,
): StatusBadgeMeta {
  switch (status.toLowerCase()) {
    case 'success':
      return {
        label: '成功',
        color: palette.accentGreen,
        bgColor: `${palette.accentGreen}1F`,
      };
    case 'failed':
    case 'failure':
    case 'error':
      return {
        label: '失败',
        color: palette.accentRed,
        bgColor: `${palette.accentRed}1F`,
      };
    case 'pending':
    case 'running':
      return {
        label: '构建中',
        color: palette.accentOrange,
        bgColor: `${palette.accentOrange}1F`,
      };
    case 'skipped':
      return {
        label: '已跳过',
        color: palette.textSecondary,
        bgColor: palette.bgSecondaryFill,
      };
    default:
      return {
        label: status || '未知',
        color: palette.textSecondary,
        bgColor: palette.bgSecondaryFill,
      };
  }
}

export function formatAiCreditsFromMilli(milliCredit: number): string {
  const safe = Number.isFinite(milliCredit) ? Math.max(0, milliCredit) : 0;
  return (safe / 1000).toFixed(2);
}
