/**
 * Quota progress bar implementing exact threshold coloring and appended locked quota display.
 * Thresholds based on (used + locked) / total:
 *   < 60%: Blue | 60%-80%: Orange | >= 80%: Red
 */

import React, { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import type { QuotaUnit } from '@/contracts';
import {
  formatQuotaNumber,
  getQuotaThresholdColor,
  useIos18Palette,
} from '../theme/tokens';

const BAR_HEIGHT = 10;
const LEGEND_DOT_SIZE = 9;
const STRIPE_STEP = 6;
const STRIPE_COLOR = 'rgba(255, 255, 255, 0.38)';

function getLockedSegmentDarkColor(percentage: number): string {
  if (percentage >= 80) {
    return '#A81B14';
  }
  if (percentage >= 60) {
    return '#AD5B00';
  }
  return '#004C9E';
}

interface DiagonalStripeOverlayProps {
  width: number;
  height: number;
}

function DiagonalStripeOverlay({ width, height }: DiagonalStripeOverlayProps) {
  const safeWidth = Math.ceil(width);
  if (safeWidth <= 0 || height <= 0) {
    return null;
  }

  const lines: number[] = [];
  for (let x = -height; x <= safeWidth + STRIPE_STEP; x += STRIPE_STEP) {
    lines.push(x);
  }

  return (
    <Svg
      width={safeWidth}
      height={height}
      viewBox={`0 0 ${safeWidth} ${height}`}
      style={styles.stripeSvg}
      pointerEvents="none"
    >
      {lines.map((x) => (
        <Line
          key={x}
          x1={x}
          y1={height + 2}
          x2={x + height + 4}
          y2={-2}
          stroke={STRIPE_COLOR}
          strokeWidth={2.2}
        />
      ))}
    </Svg>
  );
}

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
  const [lockedWidthPx, setLockedWidthPx] = useState(0);

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
  const lockedDarkBg = getLockedSegmentDarkColor(percentage);
  const usedWidthPct = `${(usedRatio * 100).toFixed(2)}%` as `${number}%`;
  const lockedWidthPct = `${(lockedRatio * 100).toFixed(2)}%` as `${number}%`;

  const handleLockedLayout = (event: LayoutChangeEvent) => {
    const measuredWidth = Math.ceil(event.nativeEvent.layout.width);
    if (measuredWidth !== lockedWidthPx) {
      setLockedWidthPx(measuredWidth);
    }
  };

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
            onLayout={handleLockedLayout}
            style={[
              styles.lockedSegment,
              {
                width: lockedWidthPct,
                backgroundColor: lockedDarkBg,
                borderLeftWidth: usedRatio > 0 ? 1.5 : 0,
                borderLeftColor: palette.bgCard,
              },
            ]}
          >
            <DiagonalStripeOverlay width={lockedWidthPx} height={BAR_HEIGHT} />
          </View>
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
                      backgroundColor: lockedDarkBg,
                    },
                  ]}
                >
                  <DiagonalStripeOverlay width={LEGEND_DOT_SIZE} height={LEGEND_DOT_SIZE} />
                </View>
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
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  usedSegment: {
    height: '100%',
  },
  lockedSegment: {
    height: '100%',
    overflow: 'hidden',
  },
  stripeSvg: {
    position: 'absolute',
    left: 0,
    top: 0,
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
    width: LEGEND_DOT_SIZE,
    height: LEGEND_DOT_SIZE,
    borderRadius: 2.5,
    overflow: 'hidden',
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
