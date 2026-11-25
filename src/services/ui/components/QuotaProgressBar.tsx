/**
 * Quota progress bar implementing exact threshold coloring and appended locked quota display.
 * Thresholds based on (used + locked) / total:
 *   < 60%: Blue | 60%-80%: Orange | >= 80%: Red
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { QuotaUnit } from '@/contracts';
import {
  formatQuotaNumber,
  getQuotaThresholdColor,
  useIos18Palette,
} from '../theme/tokens';

interface QuotaProgressBarProps {
  total: number;
  used: number;
  locked?: number;
  unit: QuotaUnit;
  showLegend?: boolean;
}

export function QuotaProgressBar({
  total,
  used,
  locked = 0,
  unit,
  showLegend = true,
}: QuotaProgressBarProps) {
  const palette = useIos18Palette();

  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
  const safeLocked = Number.isFinite(locked) && locked > 0 ? locked : 0;
  const effectiveUsed = safeUsed + safeLocked;

  const percentage =
    safeTotal > 0 ? Math.min(100, (effectiveUsed / safeTotal) * 100) : 0;
  const usedRatio = safeTotal > 0 ? Math.min(1, safeUsed / safeTotal) : 0;
  const lockedRatio =
    safeTotal > 0 ? Math.min(Math.max(0, 1 - usedRatio), safeLocked / safeTotal) : 0;

  const barColor = getQuotaThresholdColor(percentage, palette);
  const usedWidthPct = `${(usedRatio * 100).toFixed(2)}%` as `${number}%`;
  const lockedWidthPct = `${(lockedRatio * 100).toFixed(2)}%` as `${number}%`;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.track, { backgroundColor: palette.bgSecondaryFill }]}>
        {usedRatio > 0 ? (
          <View
            style={[
              styles.usedSegment,
              {
                width: usedWidthPct,
                backgroundColor: barColor,
              },
            ]}
          />
        ) : null}

        {lockedRatio > 0 ? (
          <View
            style={[
              styles.lockedSegment,
              {
                width: lockedWidthPct,
                backgroundColor: `${barColor}48`,
                borderColor: barColor,
                borderLeftColor: usedRatio > 0 ? palette.bgCard : barColor,
              },
            ]}
          />
        ) : null}
      </View>

      {showLegend ? (
        <View style={styles.legendRow}>
          <View style={styles.legendItems}>
            <View style={styles.legendItem}>
              <View style={[styles.solidDot, { backgroundColor: barColor }]} />
              <Text style={[styles.legendText, { color: palette.textSecondary }]}>
                已用 {formatQuotaNumber(safeUsed, unit)} {unit}
              </Text>
            </View>

            {safeLocked > 0 ? (
              <View style={styles.legendItem}>
                <View
                  style={[
                    styles.lockedDot,
                    {
                      backgroundColor: `${barColor}48`,
                      borderColor: barColor,
                    },
                  ]}
                />
                <Text style={[styles.legendText, { color: palette.textSecondary }]}>
                  锁定 {formatQuotaNumber(safeLocked, unit)} {unit}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.percentText, { color: barColor }]}>
            {percentage.toFixed(1)}%
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  track: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  usedSegment: {
    height: '100%',
  },
  lockedSegment: {
    height: '100%',
    borderWidth: 1,
    borderLeftWidth: 1.5,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  legendItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  solidDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  lockedDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    borderWidth: 1,
  },
  legendText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  percentText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
