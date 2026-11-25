/**
 * SSR HTML & __NEXT_DATA__ parser and quota unit/pack/freeze calculator for CNB.
 * Follows the exact conversion and sequential pack/freeze allocation rules verified
 * against CNB's billing/charge SSR pages.
 */

import type { QuotaMetricKey, QuotaPackage, QuotaUnit } from '@/contracts';
import { CnbParserError } from './httpClient';

const NEXT_DATA_RE = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

export interface CnbGroupSummary {
  name?: string;
  path?: string;
  remark?: string;
  access_role?: string;
  freeze?: boolean;
}

export interface CnbPackRaw {
  type?: number;
  res_type?: string;
  name?: string;
  size?: number;
  expire_at?: string | null;
}

export interface CnbChargeNode {
  formattedPacks?: Record<string, CnbPackRaw[] | undefined> | null;
  usage?: {
    status?: string;
    data?: Record<string, number | undefined> | null;
  } | null;
  freezeVolume?: Record<string, number | undefined> | null;
  viewingMonth?: string | null;
  viewingDate?: string | null;
}

interface NextDataEnvelope {
  props?: {
    pageProps?: {
      initialState?: {
        user?: {
          global?: {
            userGroups?: CnbGroupSummary[] | null;
          };
        };
        group?: {
          setting?: {
            charge?: CnbChargeNode | null;
          };
        };
      };
    };
  };
}

export interface ResourceMetricSpec {
  metric: QuotaMetricKey;
  label: string;
  resType: 'charge_type_credit' | 'charge_type_ci' | 'charge_type_dev';
  usageKey: 'credit_in_milli' | 'ci_in_sec' | 'dev_in_sec';
  scale: number;
  unit: QuotaUnit;
}

export const TARGET_METRIC_SPECS: readonly ResourceMetricSpec[] = [
  {
    metric: 'ai_credits',
    label: 'AI Credits',
    resType: 'charge_type_credit',
    usageKey: 'credit_in_milli',
    scale: 0.001,
    unit: 'Credits',
  },
  {
    metric: 'build_cpu',
    label: '云原生构建-CPU',
    resType: 'charge_type_ci',
    usageKey: 'ci_in_sec',
    scale: 1 / 3600,
    unit: '核时',
  },
  {
    metric: 'dev_cpu',
    label: '云原生开发-CPU',
    resType: 'charge_type_dev',
    usageKey: 'dev_in_sec',
    scale: 1 / 3600,
    unit: '核时',
  },
];

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function getPackDisplayName(pack: CnbPackRaw): string {
  const trimmed = (pack.name ?? '').trim();
  if (trimmed) {
    return trimmed;
  }
  return pack.type === 0 ? '免费配额' : '付费配额';
}

/**
 * Extracts and parses the Next.js __NEXT_DATA__ JSON payload from an SSR HTML page.
 */
export function parseNextDataFromHtml(html: string): NextDataEnvelope {
  const match = NEXT_DATA_RE.exec(html);
  const rawJson = match?.[1];
  if (!rawJson) {
    throw new CnbParserError(
      'PARSE',
      '页面中未找到 __NEXT_DATA__ 数据节点（可能被风控拦截、登录态失效或页面结构变更）',
    );
  }

  try {
    return JSON.parse(rawJson) as NextDataEnvelope;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CnbParserError('PARSE', `解析 __NEXT_DATA__ JSON 失败：${detail}`);
  }
}

/**
 * Extracts public organization summaries from /u/{username}/groups SSR HTML.
 */
export function extractUserGroupsFromHtml(html: string): CnbGroupSummary[] {
  const nextData = parseNextDataFromHtml(html);
  const groups = nextData.props?.pageProps?.initialState?.user?.global?.userGroups;
  if (!Array.isArray(groups)) {
    throw new CnbParserError('PARSE', '未在页面中找到 userGroups 组织列表节点');
  }
  return groups;
}

/**
 * Extracts the billing charge node from /{org}/-/settings/charge SSR HTML.
 */
export function extractChargeNodeFromHtml(html: string): CnbChargeNode {
  const nextData = parseNextDataFromHtml(html);
  const charge = nextData.props?.pageProps?.initialState?.group?.setting?.charge;
  if (!charge || typeof charge !== 'object') {
    throw new CnbParserError('PARSE', '未在页面中找到 group.setting.charge 节点');
  }
  return charge;
}

export interface ComputedOrgPackages {
  packages: QuotaPackage[];
  usedTotal: number;
  frozenTotal: number;
}

/**
 * Converts a single organization's raw charge node for a target metric into QuotaPackage items,
 * applying unit scaling, sequential pack consumption, and pre-freeze capacity allocation.
 */
export function computePackagesForMetric(
  charge: CnbChargeNode,
  spec: ResourceMetricSpec,
  orgKey: string,
  orgNamePrefix?: string,
): ComputedOrgPackages {
  const rawPacks = charge.formattedPacks?.[spec.resType] ?? [];
  const usageData = charge.usage?.data ?? {};

  const rawUsedVal = Number(usageData[spec.usageKey] ?? 0);
  const safeRawUsed = Number.isFinite(rawUsedVal) && rawUsedVal > 0 ? rawUsedVal : 0;

  // Prefer charge.freezeVolume[resType], falling back to usage.data['freeze_' + usageKey].
  const rawFreezeFromMap = charge.freezeVolume?.[spec.resType];
  const rawFreezeFromUsage = usageData[`freeze_${spec.usageKey}`];
  const rawFrozenCandidate =
    rawFreezeFromMap !== undefined && rawFreezeFromMap !== null
      ? Number(rawFreezeFromMap)
      : Number(rawFreezeFromUsage ?? 0);
  const safeRawFrozen =
    Number.isFinite(rawFrozenCandidate) && rawFrozenCandidate > 0 ? rawFrozenCandidate : 0;

  const usedDisplay = safeRawUsed * spec.scale;
  const frozenDisplay = safeRawFrozen * spec.scale;

  let remainingUsed = usedDisplay;
  const allocated = rawPacks.map((pack, idx) => {
    const rawSize = Number(pack.size ?? 0);
    const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 0;
    const consumed = size > 0 && remainingUsed > 0 ? Math.min(remainingUsed, size) : 0;
    remainingUsed = Math.max(0, remainingUsed - consumed);
    return {
      pack,
      idx,
      size,
      consumed,
      frozen: 0,
    };
  });

  // Allocate pre-frozen quota starting from the remaining capacity after consumed usage.
  let remainingFrozen = frozenDisplay;
  for (const item of allocated) {
    if (remainingFrozen <= 0 || item.size <= 0) {
      continue;
    }
    const capacity = Math.max(0, item.size - item.consumed);
    if (capacity <= 0) {
      continue;
    }
    const taken = Math.min(remainingFrozen, capacity);
    item.frozen = taken;
    remainingFrozen = Math.max(0, remainingFrozen - taken);
  }

  // If pre-freeze exceeds total capacity across all packs, attach overflow to the last pack
  // so locked totals remain visible rather than silently dropped.
  if (remainingFrozen > 0 && allocated.length > 0) {
    const lastPack = allocated[allocated.length - 1];
    if (lastPack) {
      lastPack.frozen += remainingFrozen;
    }
  }

  const packages: QuotaPackage[] = allocated.map((item) => {
    const baseName = getPackDisplayName(item.pack);
    const displayName = orgNamePrefix ? `${orgNamePrefix} · ${baseName}` : baseName;
    const roundedTotal = roundToDecimals(item.size, 2);
    const roundedUsed = roundToDecimals(item.consumed, 2);
    const roundedLocked = roundToDecimals(item.frozen, 2);

    const pkg: QuotaPackage = {
      id: `${orgKey}:${spec.resType}:${item.idx}`,
      name: displayName,
      total: roundedTotal,
      used: roundedUsed,
      unit: spec.unit,
    };

    if (roundedLocked > 0) {
      pkg.locked = roundedLocked;
    }

    return pkg;
  });

  return {
    packages,
    usedTotal: roundToDecimals(usedDisplay, 2),
    frozenTotal: roundToDecimals(frozenDisplay, 2),
  };
}
