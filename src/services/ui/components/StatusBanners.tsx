/**
 * Shared iOS 18 empty-state card and 1-hour stale usage warning banner.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useIos18Palette } from '../theme/tokens';

interface EmptyStateCardProps {
  symbol: SFSymbol;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyStateCard({
  symbol,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateCardProps) {
  const palette = useIos18Palette();

  return (
    <View style={[styles.emptyCard, { backgroundColor: palette.bgCard }]}>
      <View
        style={[
          styles.emptyIconCircle,
          { backgroundColor: palette.bgSecondaryFill },
        ]}
      >
        <SymbolView name={symbol} size={30} tintColor={palette.themeAccent} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.emptyDesc, { color: palette.textSecondary }]}>
        {description}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: palette.themeAccent,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={styles.primaryButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface StaleWarningBannerProps {
  staleCount: number;
  onGoToAccounts: () => void;
}

export function StaleWarningBanner({
  staleCount,
  onGoToAccounts,
}: StaleWarningBannerProps) {
  const palette = useIos18Palette();

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: palette.warningBannerBg,
          borderColor: palette.warningBannerBorder,
        },
      ]}
    >
      <SymbolView
        name="exclamationmark.triangle.fill"
        size={20}
        tintColor={palette.accentOrange}
      />
      <View style={styles.bannerBody}>
        <Text style={[styles.bannerTitle, { color: palette.warningBannerText }]}>
          有 {staleCount} 个账户用量超过 1 小时未更新
        </Text>
        <Text style={[styles.bannerSub, { color: palette.warningBannerText }]}>
          请前往“账户”页面刷新最新用量数据。
        </Text>
      </View>
      <Pressable
        onPress={onGoToAccounts}
        style={({ pressed }) => [
          styles.bannerAction,
          {
            backgroundColor: palette.accentOrange,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={styles.bannerActionText}>去刷新</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyCard: {
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 10,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
  },
  primaryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  banner: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bannerBody: {
    flex: 1,
    gap: 2,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  bannerSub: {
    fontSize: 12,
    opacity: 0.9,
  },
  bannerAction: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  bannerActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
