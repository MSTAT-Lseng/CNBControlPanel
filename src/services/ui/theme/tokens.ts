/**
 * iOS 18 semantic color tokens, formatting helpers, and progress bar threshold helpers.
 */

import { useColorScheme } from 'react-native';
import type { LogLevel, QuotaUnit } from '@/contracts';

export interface Ios18Palette {
  isDark: boolean;
  bgCanvas: string;
  bgCard: string;
  bgSecondaryFill: string;
  bgGroupedHeader: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  separator: string;
  themeAccent: string;
  accentBlue: string;
  accentOrange: string;
  accentRed: string;
  accentGreen: string;
  accentIndigo: string;
  brandOrange: string;
  warningBannerBg: string;
  warningBannerBorder: string;
  warningBannerText: string;
  dangerBannerBg: string;
  dangerBannerBorder: string;
  successBannerBg: string;
  successBannerBorder: string;
}

const LIGHT_PALETTE: Ios18Palette = {
  isDark: false,
  bgCanvas: '#F2F2F7',
  bgCard: '#FFFFFF',
  bgSecondaryFill: '#E5E5EA',
  bgGroupedHeader: '#FFFFFF',
  textPrimary: '#000000',
  textSecondary: '#6C6C70',
  textTertiary: '#8E8E93',
  separator: '#C6C6C8',
  themeAccent: '#F76945',
  accentBlue: '#007AFF',
  accentOrange: '#FF9500',
  accentRed: '#FF3B30',
  accentGreen: '#34C759',
  accentIndigo: '#5856D6',
  brandOrange: '#F76945',
  warningBannerBg: '#FFF5E5',
  warningBannerBorder: '#FF9500',
  warningBannerText: '#9A5700',
  dangerBannerBg: '#FFECEB',
  dangerBannerBorder: '#FF3B30',
  successBannerBg: '#EBF9EF',
  successBannerBorder: '#34C759',
};

const DARK_PALETTE: Ios18Palette = {
  isDark: true,
  bgCanvas: '#000000',
  bgCard: '#1C1C1E',
  bgSecondaryFill: '#2C2C2E',
  bgGroupedHeader: '#1C1C1E',
  textPrimary: '#FFFFFF',
  textSecondary: '#98989D',
  textTertiary: '#636366',
  separator: '#38383A',
  themeAccent: '#F76945',
  accentBlue: '#0A84FF',
  accentOrange: '#FF9F0A',
  accentRed: '#FF453A',
  accentGreen: '#30D158',
  accentIndigo: '#5E5CE6',
  brandOrange: '#F76945',
  warningBannerBg: '#2B2010',
  warningBannerBorder: '#FF9F0A',
  warningBannerText: '#FFD180',
  dangerBannerBg: '#2C1414',
  dangerBannerBorder: '#FF453A',
  successBannerBg: '#12291A',
  successBannerBorder: '#30D158',
};

const AVATAR_COLORS = [
  '#F76945',
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#5856D6',
  '#AF52DE',
  '#00C7BE',
  '#FF2D55',
];

export function useIos18Palette(): Ios18Palette {
  const scheme = useColorScheme();
  return scheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}

/**
 * Picks a deterministic iOS tint color for an account avatar from its username.
 */
export function getAvatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? '#007AFF';
}

/**
 * Extracts the first visible character from a username safely across Unicode code points.
 */
export function getAvatarInitial(username: string): string {
  const chars = Array.from(username.trim());
  const first = chars[0];
  return first ? first.toUpperCase() : '?';
}

/**
 * Returns the iOS 18 progress bar color matching usage thresholds:
 * <60% -> Blue, 60%-80% -> Orange, >=80% -> Red.
 */
export function getQuotaThresholdColor(percentage: number, palette: Ios18Palette): string {
  if (percentage >= 80) {
    return palette.accentRed;
  }
  if (percentage >= 60) {
    return palette.accentOrange;
  }
  return palette.accentBlue;
}

/**
 * Returns the semantic color associated with a V/I/W/E log level.
 */
export function getLogLevelColor(level: LogLevel, palette: Ios18Palette): string {
  switch (level) {
    case 'V':
      return palette.textTertiary;
    case 'I':
      return palette.accentBlue;
    case 'W':
      return palette.accentOrange;
    case 'E':
      return palette.accentRed;
  }
}

export function formatQuotaNumber(value: number, unit: QuotaUnit): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (unit === 'Credits') {
    return Math.round(safe).toLocaleString('en-US');
  }
  const rounded = Math.round(safe * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toLocaleString('en-US') : rounded.toFixed(1);
}

export function formatSyncTimestamp(timestamp: number | null): string {
  if (timestamp === null) {
    return '尚未同步';
  }
  const date = new Date(timestamp);
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  if (diffMs < 60_000) {
    return '刚刚更新';
  }
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins} 分钟前`;
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day} ${hh}:${mm}`;
}

export function formatClockDateTime(date: Date, includeMs = false): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const base = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  if (!includeMs) {
    return base;
  }
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${base}.${ms}`;
}
