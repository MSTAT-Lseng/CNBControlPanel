/**
 * Usage tab screen.
 * Each user renders as an independent horizontal page controlled by a top horizontal
 * user pill switcher, followed by a 3-metric segmented control and package breakdown cards.
 */

import React, { useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MetricQuotaGroup, QuotaMetricKey, QuotaPackage, UserUsageEntry } from '@/contracts';
import { exchangeService } from '@/services/exchange';
import { AppStoreTabHeader } from '../components/AppStoreTabHeader';
import { QuotaProgressBar } from '../components/QuotaProgressBar';
import { type SegmentOption, SegmentedControl } from '../components/SegmentedControl';
import { EmptyStateCard } from '../components/StatusBanners';
import { useExchangeState } from '../hooks/useExchange';
import {
  formatQuotaNumber,
  formatSyncTimestamp,
  getAvatarColor,
  getAvatarInitial,
  useIos18Palette,
} from '../theme/tokens';

const METRIC_OPTIONS: readonly SegmentOption<QuotaMetricKey>[] = [
  { key: 'ai_credits', label: 'AI Credits' },
  { key: 'build_cpu', label: '云原生构建-CPU' },
  { key: 'dev_cpu', label: '云原生开发-CPU' },
];

function selectMetricGroup(
  entry: UserUsageEntry,
  metric: QuotaMetricKey,
): MetricQuotaGroup | null {
  if (!entry.snapshot) {
    return null;
  }
  switch (metric) {
    case 'ai_credits':
      return entry.snapshot.aiCredits;
    case 'build_cpu':
      return entry.snapshot.buildCpu;
    case 'dev_cpu':
      return entry.snapshot.devCpu;
  }
}

interface PackageCardProps {
  pkg: QuotaPackage;
}

function PackageCard({ pkg }: PackageCardProps) {
  const palette = useIos18Palette();
  const locked = pkg.locked ?? 0;
  const remaining = Math.max(0, pkg.total - pkg.used - locked);
  const hasLocked = pkg.locked !== undefined && pkg.locked > 0;

  return (
    <View style={[styles.packageCard, { backgroundColor: palette.bgCard }]}>
      <View style={styles.packageHeader}>
        <Text style={[styles.packageName, { color: palette.textPrimary }]}>{pkg.name}</Text>
        <View style={styles.remainingWrap}>
          <Text style={[styles.remainingLabel, { color: palette.textSecondary }]}>剩余</Text>
          <Text style={[styles.remainingValue, { color: palette.textPrimary }]}>
            {formatQuotaNumber(remaining, pkg.unit)}{' '}
            <Text style={[styles.unitSmall, { color: palette.textSecondary }]}>{pkg.unit}</Text>
          </Text>
        </View>
      </View>

      <QuotaProgressBar
        total={pkg.total}
        used={pkg.used}
        locked={locked}
        unit={pkg.unit}
      />

      <View style={[styles.pkgStatsRow, { borderTopColor: palette.separator }]}>
        <View style={styles.pkgStatCell}>
          <Text style={[styles.pkgStatLabel, { color: palette.textSecondary }]}>总额度</Text>
          <Text style={[styles.pkgStatVal, { color: palette.textPrimary }]}>
            {formatQuotaNumber(pkg.total, pkg.unit)} {pkg.unit}
          </Text>
        </View>
        <View style={styles.pkgStatCell}>
          <Text style={[styles.pkgStatLabel, { color: palette.textSecondary }]}>已用</Text>
          <Text style={[styles.pkgStatVal, { color: palette.textPrimary }]}>
            {formatQuotaNumber(pkg.used, pkg.unit)} {pkg.unit}
          </Text>
        </View>
        {hasLocked ? (
          <View style={styles.pkgStatCell}>
            <Text style={[styles.pkgStatLabel, { color: palette.textSecondary }]}>已锁定</Text>
            <Text style={[styles.pkgStatVal, { color: palette.textPrimary }]}>
              {formatQuotaNumber(locked, pkg.unit)} {pkg.unit}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function UsageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const palette = useIos18Palette();
  const { usageList } = useExchangeState();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedMetric, setSelectedMetric] = useState<QuotaMetricKey>('ai_credits');
  const pagerRef = useRef<FlatList<UserUsageEntry>>(null);

  const activeIndex = usageList.length > 0 ? Math.min(selectedIndex, usageList.length - 1) : 0;

  const handleSelectUser = (index: number) => {
    setSelectedIndex(index);
    pagerRef.current?.scrollToIndex({ index, animated: true });
    const targetUser = usageList[index]?.account.username ?? '';
    exchangeService.reportUiLog('V', 'ui.usage.switchUser', `Switched usage page to "${targetUser}"`);
  };

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (windowWidth <= 0) {
      return;
    }
    const offsetX = event.nativeEvent.contentOffset.x;
    const nextIndex = Math.max(0, Math.min(usageList.length - 1, Math.round(offsetX / windowWidth)));
    if (nextIndex !== activeIndex) {
      setSelectedIndex(nextIndex);
    }
  };

  const handleSelectMetric = (nextMetric: QuotaMetricKey) => {
    setSelectedMetric(nextMetric);
    exchangeService.reportUiLog('V', 'ui.usage.switchMetric', `Switched metric tab to "${nextMetric}"`);
  };

  const navigateToAccounts = () => {
    router.navigate('/(tabs)/accounts');
  };

  if (usageList.length === 0) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: palette.bgCanvas }]}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 84 }}
      >
        <AppStoreTabHeader title="用量" />
        <View style={styles.emptyWrap}>
          <EmptyStateCard
            symbol="gauge.with.dots.needle.33percent"
            title="暂无可展示的用量数据"
            description="请先在“账户”页面添加 CNB 账户并同步用量信息。"
            actionLabel="前往“账户”添加"
            onAction={navigateToAccounts}
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.bgCanvas }]}>
      <AppStoreTabHeader
        title="用量"
        actions={[
          {
            id: 'go-accounts',
            symbol: 'person.2',
            accessibilityLabel: '管理账户',
            onPress: navigateToAccounts,
          },
        ]}
      />

      <View style={styles.userSwitcherWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.userPillsContainer}
        >
          {usageList.map((entry, idx) => {
            const isSelected = idx === activeIndex;
            const avatarColor = getAvatarColor(entry.account.username);
            const initial = getAvatarInitial(entry.account.username);

            return (
              <Pressable
                key={entry.account.username}
                onPress={() => handleSelectUser(idx)}
                style={[
                  styles.userPill,
                  {
                    backgroundColor: isSelected ? palette.accentBlue : palette.bgCard,
                    borderColor: isSelected ? palette.accentBlue : palette.separator,
                  },
                ]}
              >
                <View
                  style={[
                    styles.pillAvatar,
                    { backgroundColor: isSelected ? '#FFFFFF33' : avatarColor },
                  ]}
                >
                  <Text style={styles.pillAvatarText}>{initial}</Text>
                </View>
                <Text
                  style={[
                    styles.userPillText,
                    { color: isSelected ? '#FFFFFF' : palette.textPrimary },
                  ]}
                  numberOfLines={1}
                >
                  {entry.account.username}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        ref={pagerRef}
        data={usageList}
        keyExtractor={(item) => item.account.username}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        getItemLayout={(_, index) => ({
          length: windowWidth,
          offset: windowWidth * index,
          index,
        })}
        renderItem={({ item }) => {
          const group = selectMetricGroup(item, selectedMetric);

          return (
            <ScrollView
              style={{ width: windowWidth, flex: 1 }}
              contentInsetAdjustmentBehavior="never"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.pageContent,
                { paddingBottom: insets.bottom + 84 },
              ]}
            >
              <SegmentedControl
                options={METRIC_OPTIONS}
                value={selectedMetric}
                onChange={handleSelectMetric}
              />

              {item.snapshot === null || group === null ? (
                <EmptyStateCard
                  symbol="arrow.triangle.2.circlepath"
                  title={`${item.account.username} 尚未同步用量`}
                  description="当前账户暂无本地缓存用量，请前往“账户”页面执行一次同步。"
                  actionLabel="前往同步"
                  onAction={navigateToAccounts}
                />
              ) : (
                <>
                  <View style={[styles.userMetaRow, { backgroundColor: palette.bgCard }]}>
                    <Text style={[styles.userMetaText, { color: palette.textSecondary }]}>
                      {group.label} · {group.packages.length} 个额度包（{group.unit}）
                    </Text>
                    <Text style={[styles.userMetaText, { color: palette.textSecondary }]}>
                      {formatSyncTimestamp(item.snapshot.fetchedAt)}
                    </Text>
                  </View>

                  <View style={styles.packagesList}>
                    {group.packages.map((pkg) => (
                      <PackageCard key={pkg.id} pkg={pkg} />
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyWrap: {
    paddingHorizontal: 16,
  },
  userSwitcherWrap: {
    paddingBottom: 10,
  },
  userPillsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  userPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillAvatarText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  userPillText: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 140,
  },
  pageContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  userMetaRow: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  userMetaText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  packagesList: {
    gap: 12,
  },
  packageCard: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  packageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  packageName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  remainingWrap: {
    alignItems: 'flex-end',
  },
  remainingLabel: {
    fontSize: 11,
  },
  remainingValue: {
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  unitSmall: {
    fontSize: 12,
    fontWeight: '500',
  },
  pkgStatsRow: {
    flexDirection: 'row',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  pkgStatCell: {
    flex: 1,
    gap: 2,
  },
  pkgStatLabel: {
    fontSize: 11,
  },
  pkgStatVal: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
