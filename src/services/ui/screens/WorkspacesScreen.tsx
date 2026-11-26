/**
 * Standalone Cloud Native Dev Workspaces screen rendered inside a native iOS 18 Stack header.
 * Entered by tapping the Cloud Native Dev CPU card on Overview.
 * Displays up to 5 recent containers per user with a View More action for paginated history.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WorkspaceListSnapshot, WorkspaceSummary } from '@/contracts';
import { exchangeService } from '@/services/exchange';
import { EmptyStateCard } from '../components/StatusBanners';
import { WorkspaceRow } from '../components/WorkspaceRow';
import {
  fetchCachedWorkspacesViaExchange,
  syncWorkspacesViaExchange,
  useExchangeState,
} from '../hooks/useExchange';
import {
  formatSyncTimestamp,
  getAvatarColor,
  getAvatarInitial,
  useIos18Palette,
} from '../theme/tokens';

const PREVIEW_LIMIT = 5;

interface UserWorkspaceState {
  snapshot: WorkspaceListSnapshot | null;
  loading: boolean;
  error: string | null;
}

export function WorkspacesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();
  const { accounts } = useExchangeState();

  const [stateByUser, setStateByUser] = useState<Record<string, UserWorkspaceState>>({});
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const mountedRef = useRef(true);
  const autoSyncedUsersRef = useRef(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const syncSingleUserPreview = useCallback(async (username: string) => {
    setStateByUser((prev) => ({
      ...prev,
      [username]: {
        snapshot: prev[username]?.snapshot ?? null,
        loading: true,
        error: null,
      },
    }));

    const res = await syncWorkspacesViaExchange({
      username,
      page: 1,
      pageSize: PREVIEW_LIMIT,
    });

    if (!mountedRef.current) {
      return;
    }

    if (res.ok) {
      setStateByUser((prev) => ({
        ...prev,
        [username]: {
          snapshot: res.data,
          loading: false,
          error: null,
        },
      }));
    } else {
      setStateByUser((prev) => ({
        ...prev,
        [username]: {
          snapshot: prev[username]?.snapshot ?? null,
          loading: false,
          error: res.error.message,
        },
      }));
    }
  }, []);

  const handleRefreshAll = useCallback(async () => {
    if (isRefreshingAll || accounts.length === 0) {
      return;
    }

    setIsRefreshingAll(true);
    exchangeService.reportUiLog(
      'I',
      'ui.workspaces.refreshAll',
      `Refreshing recent containers for ${accounts.length} account(s)`,
    );

    try {
      for (const account of accounts) {
        if (!mountedRef.current) {
          break;
        }
        await syncSingleUserPreview(account.username);
      }
    } finally {
      if (mountedRef.current) {
        setIsRefreshingAll(false);
      }
    }
  }, [accounts, isRefreshingAll, syncSingleUserPreview]);

  // Load cached previews immediately, then fetch page 1 for any uncached account once.
  useEffect(() => {
    if (accounts.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const missingAccounts: string[] = [];

      for (const account of accounts) {
        const cachedRes = await fetchCachedWorkspacesViaExchange(account.username);
        if (cancelled) {
          return;
        }
        const cachedSnapshot = cachedRes.ok ? cachedRes.data : null;
        if (cachedSnapshot) {
          setStateByUser((prev) => ({
            ...prev,
            [account.username]: {
              snapshot: cachedSnapshot,
              loading: false,
              error: null,
            },
          }));
        } else if (!autoSyncedUsersRef.current.has(account.username)) {
          autoSyncedUsersRef.current.add(account.username);
          missingAccounts.push(account.username);
        }
      }

      for (const username of missingAccounts) {
        if (cancelled) {
          return;
        }
        await syncSingleUserPreview(username);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accounts, syncSingleUserPreview]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '云原生开发',
      headerStyle: { backgroundColor: palette.bgCard },
      headerTintColor: palette.themeAccent,
      headerTitleStyle: { color: palette.textPrimary },
      headerRight: () =>
        accounts.length > 0 ? (
          <Pressable
            onPress={() => void handleRefreshAll()}
            disabled={isRefreshingAll}
            hitSlop={8}
            accessibilityLabel="刷新容器列表"
          >
            {isRefreshingAll ? (
              <ActivityIndicator size="small" color={palette.themeAccent} />
            ) : (
              <SymbolView
                name="arrow.triangle.2.circlepath"
                size={18}
                tintColor={palette.themeAccent}
              />
            )}
          </Pressable>
        ) : null,
    });
  }, [accounts.length, handleRefreshAll, isRefreshingAll, navigation, palette]);

  const handleOpenContainerLogs = (username: string, item: WorkspaceSummary) => {
    exchangeService.reportUiLog(
      'I',
      'ui.workspaces.openLogs',
      `Opened build logs for "${item.sn}" (${username})`,
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

  const handleOpenMoreHistory = (username: string) => {
    exchangeService.reportUiLog(
      'I',
      'ui.workspaces.openMore',
      `Opened full container history for "${username}"`,
    );
    router.push({
      pathname: '/workspace-history',
      params: { username },
    });
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.bgCanvas }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 24 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {accounts.length === 0 ? (
        <EmptyStateCard
          symbol="terminal"
          title="暂无 CNB 账户"
          description="请先前往“账户”页面添加 CNB 账户，即可查看各用户的云原生开发容器历史与构建日志。"
          actionLabel="前往账户管理"
          onAction={() => router.navigate('/(tabs)/accounts')}
        />
      ) : (
        accounts.map((account) => {
          const userState = stateByUser[account.username];
          const snapshot = userState?.snapshot ?? null;
          const previewItems = snapshot ? snapshot.items.slice(0, PREVIEW_LIMIT) : [];

          return (
            <View
              key={account.username}
              style={[styles.userCard, { backgroundColor: palette.bgCard }]}
            >
              <View style={styles.userHeader}>
                <View style={styles.userIdentity}>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: getAvatarColor(account.username) },
                    ]}
                  >
                    <Text style={styles.avatarText}>
                      {getAvatarInitial(account.username)}
                    </Text>
                  </View>
                  <View style={styles.userTextCol}>
                    <Text
                      numberOfLines={1}
                      style={[styles.usernameText, { color: palette.textPrimary }]}
                    >
                      {account.username}
                    </Text>
                    <Text style={[styles.userSubText, { color: palette.textSecondary }]}>
                      {snapshot
                        ? `共 ${snapshot.total} 个容器 · ${formatSyncTimestamp(snapshot.fetchedAt)}`
                        : account.remark || '云原生开发容器记录'}
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => void syncSingleUserPreview(account.username)}
                  disabled={userState?.loading}
                  hitSlop={8}
                  style={[styles.refreshChip, { backgroundColor: palette.bgSecondaryFill }]}
                >
                  {userState?.loading ? (
                    <ActivityIndicator size="small" color={palette.themeAccent} />
                  ) : (
                    <SymbolView
                      name="arrow.clockwise"
                      size={14}
                      tintColor={palette.themeAccent}
                    />
                  )}
                </Pressable>
              </View>

              {snapshot?.ownerMismatch ? (
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
                    Cookie 实际归属账号为 {snapshot.ownerUsername}，当前列表反映该账号数据。
                  </Text>
                </View>
              ) : null}

              {userState?.error ? (
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
                    {userState.error}
                  </Text>
                </View>
              ) : null}

              {userState?.loading && previewItems.length === 0 ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={palette.themeAccent} />
                  <Text style={[styles.loadingText, { color: palette.textSecondary }]}>
                    正在获取最近容器历史...
                  </Text>
                </View>
              ) : previewItems.length === 0 ? (
                <View style={styles.emptyUserBody}>
                  <Text style={[styles.emptyUserText, { color: palette.textSecondary }]}>
                    {snapshot ? '暂无云原生开发容器记录' : '点击右上角刷新按钮加载容器历史'}
                  </Text>
                </View>
              ) : (
                <View>
                  {previewItems.map((item, idx) => (
                    <WorkspaceRow
                      key={item.sn}
                      item={item}
                      showTopDivider={idx > 0}
                      onPress={(target) => handleOpenContainerLogs(account.username, target)}
                    />
                  ))}
                </View>
              )}

              <Pressable
                onPress={() => handleOpenMoreHistory(account.username)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.viewMoreRow,
                  { borderTopColor: palette.separator },
                  pressed && { backgroundColor: `${palette.bgSecondaryFill}66` },
                ]}
              >
                <Text style={[styles.viewMoreText, { color: palette.themeAccent }]}>
                  {snapshot && snapshot.total > PREVIEW_LIMIT
                    ? `查看更多（全部 ${snapshot.total} 条）`
                    : '查看更多'}
                </Text>
                <SymbolView
                  name="chevron.right"
                  size={13}
                  weight="semibold"
                  tintColor={palette.themeAccent}
                />
              </Pressable>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  userCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  userIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  userTextCol: {
    flex: 1,
    gap: 2,
  },
  usernameText: {
    fontSize: 16,
    fontWeight: '600',
  },
  userSubText: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  refreshChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mismatchBanner: {
    marginHorizontal: 14,
    marginBottom: 8,
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
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 13,
  },
  emptyUserBody: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyUserText: {
    fontSize: 13,
  },
  viewMoreRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewMoreText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
