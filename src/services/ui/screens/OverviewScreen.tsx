/**
 * Overview tab screen.
 * Displays empty-state onboarding when no accounts exist, a 1-hour staleness warning
 * when any account needs synchronization, and aggregated quota cards across all accounts.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exchangeService } from '@/services/exchange';
import { AppStoreTabHeader } from '../components/AppStoreTabHeader';
import { MetricSummaryCard } from '../components/MetricSummaryCard';
import { EmptyStateCard, StaleWarningBanner } from '../components/StatusBanners';
import { useExchangeState } from '../hooks/useExchange';
import { formatSyncTimestamp, useIos18Palette } from '../theme/tokens';

export function OverviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();
  const { overview, isSyncing } = useExchangeState();

  const navigateToAccounts = () => {
    exchangeService.reportUiLog('I', 'ui.overview.navigateAccounts', 'Navigated to Accounts tab from Overview');
    router.navigate('/(tabs)/accounts');
  };

  const navigateToWorkspaces = () => {
    exchangeService.reportUiLog('I', 'ui.overview.navigateWorkspaces', 'Opened Cloud Native Dev workspaces from Overview');
    router.push('/workspaces');
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.bgCanvas }]}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingBottom: insets.bottom + 84,
      }}
    >
      <AppStoreTabHeader
        title="概览"
        actions={
          overview.accountCount > 0
            ? [
                {
                  id: 'go-accounts',
                  symbol: 'person.2.fill',
                  accessibilityLabel: '前往账户页面',
                  onPress: navigateToAccounts,
                },
              ]
            : []
        }
      />

      <View style={styles.content}>
        {overview.accountCount === 0 ? (
          <EmptyStateCard
            symbol="person.crop.circle.badge.plus"
            title="暂无 CNB 账户"
            description="请先前往“账户”页面新建账户信息，即可汇总查看 AI Credits、云原生构建与开发 CPU 剩余用量。"
            actionLabel="前往“账户”新建"
            onAction={navigateToAccounts}
          />
        ) : (
          <>
            {overview.hasStaleAccounts ? (
              <StaleWarningBanner
                staleCount={overview.staleUsernames.length}
                onGoToAccounts={navigateToAccounts}
              />
            ) : null}

            <View style={[styles.metaStrip, { backgroundColor: palette.bgCard }]}>
              <Text style={[styles.metaText, { color: palette.textSecondary }]}>
                已配置 {overview.accountCount} 个账户
              </Text>
              <Text style={[styles.metaText, { color: palette.textSecondary }]}>
                {isSyncing
                  ? '正在同步用量...'
                  : `最近更新：${formatSyncTimestamp(overview.lastUpdatedAt)}`}
              </Text>
            </View>

            <View style={styles.cardsColumn}>
              {overview.metrics.map((metric) => (
                <MetricSummaryCard
                  key={metric.metric}
                  summary={metric}
                  onPress={metric.metric === 'dev_cpu' ? navigateToWorkspaces : undefined}
                  hintLabel={metric.metric === 'dev_cpu' ? '点击查看容器历史' : undefined}
                />
              ))}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    gap: 14,
  },
  metaStrip: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  cardsColumn: {
    gap: 14,
  },
});
