/**
 * Reusable metric summary card for the Overview screen.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { MetricAggregateSummary } from '@/contracts';
import { formatQuotaNumber, getMetricSymbol, useIos18Palette } from '../theme/tokens';
import { QuotaProgressBar } from './QuotaProgressBar';

interface MetricSummaryCardProps {
  summary: MetricAggregateSummary;
  onPress?: () => void;
  hintLabel?: string;
}

export function MetricSummaryCard({ summary, onPress, hintLabel }: MetricSummaryCardProps) {
  const palette = useIos18Palette();

  const cardBody = (
    <>
      <View style={styles.headerRow}>
        <View style={styles.titleLeft}>
          <View
            style={[
              styles.iconPill,
              { backgroundColor: `${palette.brandOrange}18` },
            ]}
          >
            <SymbolView
              name={getMetricSymbol(summary.metric)}
              size={16}
              tintColor={palette.brandOrange}
            />
          </View>
          <View style={styles.titleTextWrap}>
            <View style={styles.titleWithChevron}>
              <Text style={[styles.title, { color: palette.textPrimary }]}>
                {summary.label}
              </Text>
              {onPress ? (
                <SymbolView
                  name="chevron.right"
                  size={12}
                  weight="semibold"
                  tintColor={palette.textTertiary}
                />
              ) : null}
            </View>
            <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
              {hintLabel ? `共 ${summary.packageCount} 个额度包 · ${hintLabel}` : `共 ${summary.packageCount} 个额度包`}
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
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: palette.bgCard, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        {cardBody}
      </Pressable>
    );
  }

  return <View style={[styles.card, { backgroundColor: palette.bgCard }]}>{cardBody}</View>;
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
  titleTextWrap: {
    flex: 1,
  },
  titleWithChevron: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
