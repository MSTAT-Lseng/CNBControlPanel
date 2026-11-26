/**
 * Standalone paginated Workspace History screen ("View More").
 * Entered from a user section on WorkspacesScreen to filter by lifecycle status
 * and incrementally load older Cloud Native Dev container entries.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WorkspaceLifecycleStatus, WorkspaceSummary } from '@/contracts';
import { exchangeService } from '@/services/exchange';
import { type SegmentOption, SegmentedControl } from '../components/SegmentedControl';
import { EmptyStateCard } from '../components/StatusBanners';
import { WorkspaceRow } from '../components/WorkspaceRow';
import { syncWorkspacesViaExchange } from '../hooks/useExchange';
import { formatSyncTimestamp, useIos18Palette } from '../theme/tokens';

type LifecycleFilter = 'ALL' | WorkspaceLifecycleStatus;

const HISTORY_PAGE_SIZE = 20;

const FILTER_OPTIONS: readonly SegmentOption<LifecycleFilter>[] = [
  { key: 'ALL', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'closed', label: '已关闭' },
];

export function WorkspaceHistoryScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();
  const params = useLocalSearchParams<{ username?: string }>();

  const username = typeof params.username === 'string' ? params.username.trim() : '';

  const [filter, setFilter] = useState<LifecycleFilter>('ALL');
  const [items, setItems] = useState<WorkspaceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [ownerUsername, setOwnerUsername] = useState('');
  const [ownerMismatch, setOwnerMismatch] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(() => Boolean(username));
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(() =>
    username ? null : '缺少目标用户名参数',
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applySnapshot = useCallback(
    (snapshot: Awaited<ReturnType<typeof syncWorkspacesViaExchange>>, append: boolean) => {
      if (snapshot.ok) {
        const data = snapshot.data;
        setTotal(data.total);
        setPage(data.page);
        setHasMore(data.hasMore);
        setOwnerUsername(data.ownerUsername);
        setOwnerMismatch(data.ownerMismatch);
        setFetchedAt(data.fetchedAt);
        setItems((prev) => {
          if (!append) {
            return data.items;
          }
          const seen = new Set(prev.map((entry) => entry.sn));
          const merged = [...prev];
          for (const nextItem of data.items) {
            if (!seen.has(nextItem.sn)) {
              seen.add(nextItem.sn);
              merged.push(nextItem);
            }
          }
          return merged;
        });
      } else {
        setErrorText(snapshot.error.message);
      }
    },
    [],
  );

  const loadPage = useCallback(
    async (targetPage: number, targetFilter: LifecycleFilter, append: boolean) => {
      if (!username) {
        setErrorText('缺少目标用户名参数');
        return;
      }

      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setErrorText(null);

      const res = await syncWorkspacesViaExchange({
        username,
        page: targetPage,
        pageSize: HISTORY_PAGE_SIZE,
        status: targetFilter === 'ALL' ? '' : targetFilter,
      });

      if (!mountedRef.current) {
        return;
      }

      applySnapshot(res, append);
      setIsLoading(false);
      setIsLoadingMore(false);
    },
    [applySnapshot, username],
  );

  useEffect(() => {
    if (!username) {
      return;
    }

    let cancelled = false;
    void syncWorkspacesViaExchange({
      username,
      page: 1,
      pageSize: HISTORY_PAGE_SIZE,
      status: filter === 'ALL' ? '' : filter,
    }).then((res) => {
      if (cancelled) {
        return;
      }
      applySnapshot(res, false);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [applySnapshot, filter, username]);

  const handleFilterChange = (nextFilter: LifecycleFilter) => {
    if (nextFilter === filter) {
      return;
    }
    setErrorText(null);
    setIsLoading(Boolean(username));
    setFilter(nextFilter);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: username ? `${username} · 容器历史` : '容器历史',
      headerStyle: { backgroundColor: palette.bgCard },
      headerTintColor: palette.themeAccent,
      headerTitleStyle: { color: palette.textPrimary },
      headerRight: () => (
        <Pressable
          onPress={() => void loadPage(1, filter, false)}
          disabled={isLoading || isLoadingMore}
          hitSlop={8}
          accessibilityLabel="刷新历史容器列表"
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={palette.themeAccent} />
          ) : (
            <SymbolView
              name="arrow.triangle.2.circlepath"
              size={18}
              tintColor={palette.themeAccent}
            />
          )}
        </Pressable>
      ),
    });
  }, [filter, isLoading, isLoadingMore, loadPage, navigation, palette, username]);

  const handleOpenLogs = (item: WorkspaceSummary) => {
    exchangeService.reportUiLog(
      'I',
      'ui.workspaceHistory.openLogs',
      `Opened build logs for "${item.sn}" from history`,
    );
    router.push({
      pathname: '/workspace-logs',
      params: {
        username,
        slug: item.slug,
        sn: item.sn,
        pipelineId: item.pipelineId,
        branch: item.branch,
      },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.bgCanvas }]}>
      <View
        style={[
          styles.filterHeader,
          {
            backgroundColor: palette.bgCard,
            borderBottomColor: palette.separator,
          },
        ]}
      >
        <SegmentedControl
          options={FILTER_OPTIONS}
          value={filter}
          onChange={handleFilterChange}
        />

        <View style={styles.metaBar}>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            共 {total} 条 · 已加载 {items.length} 条
          </Text>
          <Text style={[styles.metaText, { color: palette.textSecondary }]}>
            {fetchedAt ? formatSyncTimestamp(fetchedAt) : '加载中'}
          </Text>
        </View>

        {ownerMismatch ? (
          <View
            style={[
              styles.mismatchBanner,
              {
                backgroundColor: palette.warningBannerBg,
                borderColor: palette.warningBannerBorder,
              },
            ]}
          >
            <SymbolView
              name="exclamationmark.triangle.fill"
              size={14}
              tintColor={palette.accentOrange}
            />
            <Text style={[styles.mismatchText, { color: palette.warningBannerText }]}>
              Cookie 归属账号为 {ownerUsername}，以下数据来自该账号。
            </Text>
          </View>
        ) : null}

        {errorText ? (
          <View
            style={[
              styles.errorBanner,
              {
                backgroundColor: palette.dangerBannerBg,
                borderColor: palette.dangerBannerBorder,
              },
            ]}
          >
            <Text style={[styles.errorText, { color: palette.accentRed }]}>
              {errorText}
            </Text>
          </View>
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.sn}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.cardItemWrap,
              { backgroundColor: palette.bgCard },
              index === 0 && styles.firstCardRadius,
              index === items.length - 1 && styles.lastCardRadius,
            ]}
          >
            <WorkspaceRow
              item={item}
              showTopDivider={index > 0}
              onPress={handleOpenLogs}
            />
          </View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centeredLoader}>
              <ActivityIndicator size="large" color={palette.themeAccent} />
              <Text style={[styles.loadingLabel, { color: palette.textSecondary }]}>
                正在加载容器历史...
              </Text>
            </View>
          ) : (
            <EmptyStateCard
              symbol="terminal"
              title="暂无匹配的容器记录"
              description="当前筛选条件下没有云原生开发容器历史，可尝试切换状态或点击右上角刷新。"
              actionLabel="重新加载"
              onAction={() => void loadPage(1, filter, false)}
            />
          )
        }
        ListFooterComponent={
          items.length > 0 ? (
            <View style={styles.footerWrap}>
              {hasMore ? (
                <Pressable
                  onPress={() => void loadPage(page + 1, filter, true)}
                  disabled={isLoadingMore}
                  style={({ pressed }) => [
                    styles.loadMoreButton,
                    {
                      backgroundColor: palette.bgCard,
                      borderColor: palette.separator,
                      opacity: pressed || isLoadingMore ? 0.7 : 1,
                    },
                  ]}
                >
                  {isLoadingMore ? (
                    <ActivityIndicator size="small" color={palette.themeAccent} />
                  ) : (
                    <Text style={[styles.loadMoreText, { color: palette.themeAccent }]}>
                      加载更多（剩余 {Math.max(0, total - items.length)} 条）
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Text style={[styles.endLabel, { color: palette.textTertiary }]}>
                  已加载全部 {items.length} 条记录
                </Text>
              )}
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  mismatchBanner: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mismatchText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  errorBanner: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
  },
  listContent: {
    padding: 16,
  },
  cardItemWrap: {
    overflow: 'hidden',
  },
  firstCardRadius: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  lastCardRadius: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  centeredLoader: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingLabel: {
    fontSize: 14,
  },
  footerWrap: {
    paddingTop: 14,
    alignItems: 'center',
  },
  loadMoreButton: {
    width: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreText: {
    fontSize: 15,
    fontWeight: '600',
  },
  endLabel: {
    fontSize: 12,
    paddingVertical: 8,
  },
});
