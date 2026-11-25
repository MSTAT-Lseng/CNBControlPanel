/**
 * Reusable metric summary card for the Overview screen.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { MetricAggregateSummary, QuotaMetricKey } from '@/contracts';
import { formatQuotaNumber, useIos18Palette } from '../theme/tokens';
import { QuotaProgressBar } from './QuotaProgressBar';

function getMetricIcon(metric: QuotaMetricKey): SFSymbol {
  switch (metric) {
    case 'ai_credits':
      return 'sparkles';
    case 'build_cpu':
      return 'hammer.fill';
    case 'dev_cpu':
      return 'cpu.fill';
  }
}

interface MetricSummaryCardProps {
  summary: MetricAggregateSummary;
}

export function MetricSummaryCard({ summary }: MetricSummaryCardProps) {
  const palette = useIos18Palette();

  return (
    <View style={[styles.card, { backgroundColor: palette.bgCard }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleLeft}>
          <View
            style={[
              styles.iconPill,
              { backgroundColor: `${palette.brandOrange}18` },
            ]}
          >
            <SymbolView
              name={getMetricIcon(summary.metric)}
              size={16}
              tintColor={palette.brandOrange}
            />
          </View>
          <View>
            <Text style={[styles.title, { color: palette.textPrimary }]}>
              {summary.label}
            </Text>
            <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
              共 {summary.packageCount} 个额度包
            </Text>
          </View>
        </View>

        <View style={styles.heroRight}>
          <Text style={[styles.heroLabel, { color: palette.textSecondary }]}>
            剩余可用
          </Text>
          <Text style={[styles.heroValue, { color: palette.textPrimary }]}>
            {formatQuotaNumber(summary.remaining, summary.unit)}{' '}
            <Text style={[styles.heroUnit, { color: palette.textSecondary }]}>
              {summary.unit}
            </Text>
          </Text>
        </View>
      </View>

      <QuotaProgressBar
        total={summary.total}
        used={summary.used}
        locked={summary.locked}
        unit={summary.unit}
      />

      <View style={[styles.statsGrid, { borderTopColor: palette.separator }]}>
        <View style={styles.statCell}>
          <Text style={[styles.statLabel, { color: palette.textSecondary }]}>总额度</Text>
          <Text style={[styles.statValue, { color: palette.textPrimary }]}>
            {formatQuotaNumber(summary.total, summary.unit)}
          </Text>
        </View>
        <View style={styles.statCell}>
          <Text style={[styles.statLabel, { color: palette.textSecondary }]}>已用额度</Text>
          <Text style={[styles.statValue, { color: palette.textPrimary }]}>
            {formatQuotaNumber(summary.used, summary.unit)}
          </Text>
        </View>
        <View style={styles.statCell}>
          <Text style={[styles.statLabel, { color: palette.textSecondary }]}>锁定额度</Text>
          <Text style={[styles.statValue, { color: palette.textPrimary }]}>
            {formatQuotaNumber(summary.locked, summary.unit)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconPill: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  heroRight: {
    alignItems: 'flex-end',
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  heroValue: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  heroUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  statsGrid: {
    flexDirection: 'row',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statCell: {
    flex: 1,
    gap: 2,
  },
  statLabel: {
    fontSize: 11,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
