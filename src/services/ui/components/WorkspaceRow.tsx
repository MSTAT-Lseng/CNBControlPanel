/**
 * Shared iOS 18 container summary row used across Workspaces and Workspace History screens.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Svg, { Circle, Path } from 'react-native-svg';
import type { WorkspaceSummary } from '@/contracts';
import { useIos18Palette } from '../theme/tokens';
import {
  formatDurationMs,
  formatShanghaiDateTime,
  getLifecycleStatusMeta,
} from '../theme/workspaceFormat';

interface WorkspaceRowProps {
  item: WorkspaceSummary;
  onPress: (item: WorkspaceSummary) => void;
  showTopDivider?: boolean;
}

function BranchIcon({ color }: { color: string }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 16 16" fill="none">
      <Circle cx={4.5} cy={3.5} r={1.8} stroke={color} strokeWidth={1.4} />
      <Circle cx={4.5} cy={12.5} r={1.8} stroke={color} strokeWidth={1.4} />
      <Circle cx={11.5} cy={4.5} r={1.8} stroke={color} strokeWidth={1.4} />
      <Path
        d="M4.5 5.3V10.7M11.5 6.3C11.5 8.8 9 9.5 4.5 9.5"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function WorkspaceRow({
  item,
  onPress,
  showTopDivider = false,
}: WorkspaceRowProps) {
  const palette = useIos18Palette();
  const lifecycle = getLifecycleStatusMeta(item.status, palette);

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        showTopDivider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: palette.separator,
        },
        pressed && { backgroundColor: `${palette.bgSecondaryFill}66` },
      ]}
    >
      <View style={styles.mainCol}>
        <View style={styles.topLine}>
          <View style={[styles.statusBadge, { backgroundColor: lifecycle.bgColor }]}>
            <Text style={[styles.statusBadgeText, { color: lifecycle.color }]}>
              {lifecycle.label}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={[styles.slugText, { color: palette.textPrimary }]}
          >
            {item.slug || '未知仓库'}
          </Text>
          {item.branch ? (
            <View style={styles.branchInline}>
              <BranchIcon color={palette.textSecondary} />
              <Text
                numberOfLines={1}
                style={[styles.branchText, { color: palette.textSecondary }]}
              >
                {item.branch}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.midLine}>
          <Text numberOfLines={1} style={[styles.snText, { color: palette.textTertiary }]}>
            {item.sn}
          </Text>
        </View>

        <View style={styles.metaLine}>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            {formatShanghaiDateTime(item.createTime)}
          </Text>
          <Text style={[styles.metaDot, { color: palette.textTertiary }]}>·</Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            {formatDurationMs(item.durationMs)}
          </Text>
          <Text style={[styles.metaDot, { color: palette.textTertiary }]}>·</Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            {item.fileCount} 文件
          </Text>
        </View>
      </View>

      <SymbolView
        name="chevron.right"
        size={13}
        weight="semibold"
        tintColor={palette.textTertiary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  mainCol: {
    flex: 1,
    gap: 4,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  slugText: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  branchInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: 110,
    flexShrink: 0,
  },
  branchText: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  midLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  snText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    flexShrink: 0,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 1,
  },
  metaText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  metaDot: {
    fontSize: 12,
  },
});
