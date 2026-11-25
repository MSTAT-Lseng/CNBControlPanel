/**
 * Randomized mock usage data generator for the Usage Parser Service.
 * Generates realistic multi-package quota distributions across all three metrics
 * until real CNB official endpoint parsing is implemented.
 */

import type { MetricQuotaGroup, QuotaPackage, QuotaUnit, UsageSnapshot } from '@/contracts';

interface PackageTemplate {
  idPrefix: string;
  name: string;
  minTotal: number;
  maxTotal: number;
  step: number;
}

const AI_PACKAGE_TEMPLATES: PackageTemplate[] = [
  { idPrefix: 'ai_free', name: '免费配额', minTotal: 500, maxTotal: 2000, step: 100 },
  { idPrefix: 'ai_edu', name: '高校师生专属特权', minTotal: 3000, maxTotal: 10000, step: 500 },
  { idPrefix: 'ai_boost', name: '开发者激励额度包', minTotal: 1000, maxTotal: 5000, step: 250 },
];

const BUILD_PACKAGE_TEMPLATES: PackageTemplate[] = [
  { idPrefix: 'build_free', name: '免费配额', minTotal: 60, maxTotal: 200, step: 10 },
  { idPrefix: 'build_edu', name: '高校师生专属特权', minTotal: 300, maxTotal: 1200, step: 50 },
];

const DEV_PACKAGE_TEMPLATES: PackageTemplate[] = [
  { idPrefix: 'dev_free', name: '免费配额', minTotal: 40, maxTotal: 160, step: 10 },
  { idPrefix: 'dev_special', name: '云原生开发专项配额', minTotal: 200, maxTotal: 800, step: 50 },
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function roundToPrecision(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildPackageFromTemplate(
  template: PackageTemplate,
  unit: QuotaUnit,
  index: number,
): QuotaPackage {
  const steps = Math.max(1, Math.floor((template.maxTotal - template.minTotal) / template.step));
  const total = template.minTotal + randomInt(0, steps) * template.step;

  // Cycle utilization across low (<60%), medium (60%-80%), and high (>=80%) bands
  // so every progress bar color state can be verified cleanly.
  const bandRoll = (index + randomInt(0, 2)) % 3;
  const targetRatio =
    bandRoll === 0
      ? 0.15 + Math.random() * 0.4
      : bandRoll === 1
        ? 0.61 + Math.random() * 0.17
        : 0.81 + Math.random() * 0.16;

  const decimals = unit === 'Credits' ? 0 : 1;
  const includeLocked = Math.random() < 0.55;

  if (includeLocked) {
    const lockedShare = 0.08 + Math.random() * 0.18;
    const rawUsed = total * Math.max(0.05, targetRatio - lockedShare);
    const rawLocked = total * Math.min(lockedShare, Math.max(0.02, 0.98 - rawUsed / total));
    const used = Math.min(total, roundToPrecision(rawUsed, decimals));
    const maxAllowedLocked = Math.max(0, roundToPrecision(total - used, decimals));
    const locked = Math.min(maxAllowedLocked, Math.max(decimals === 0 ? 1 : 0.5, roundToPrecision(rawLocked, decimals)));
    return {
      id: `${template.idPrefix}_${index}`,
      name: template.name,
      total,
      used,
      locked: locked > 0 ? locked : undefined,
      unit,
    };
  }

  const used = Math.min(total, roundToPrecision(total * targetRatio, decimals));
  return {
    id: `${template.idPrefix}_${index}`,
    name: template.name,
    total,
    used,
    unit,
  };
}

function buildMetricGroup(
  metric: MetricQuotaGroup['metric'],
  label: string,
  unit: QuotaUnit,
  templates: PackageTemplate[],
): MetricQuotaGroup {
  const maxCount = templates.length;
  const count = randomInt(1, maxCount);
  const packages: QuotaPackage[] = [];

  for (let i = 0; i < count; i++) {
    const template = templates[i];
    if (template) {
      packages.push(buildPackageFromTemplate(template, unit, i));
    }
  }

  return {
    metric,
    label,
    unit,
    packages,
  };
}

/**
 * Generates a realistic mock UsageSnapshot for a CNB account.
 */
export function generateMockUsageSnapshot(username: string): UsageSnapshot {
  return {
    username,
    fetchedAt: Date.now(),
    aiCredits: buildMetricGroup('ai_credits', 'AI Credits', 'Credits', AI_PACKAGE_TEMPLATES),
    buildCpu: buildMetricGroup('build_cpu', '云原生构建-CPU', '核时', BUILD_PACKAGE_TEMPLATES),
    devCpu: buildMetricGroup('dev_cpu', '云原生开发-CPU', '核时', DEV_PACKAGE_TEMPLATES),
  };
}
