/**
 * Accounts tab screen.
 * Lists stored CNB accounts (initial avatar, username, remark, masked cookie),
 * and provides create, edit (cookie/remark only), delete, and one-tap sync-all actions.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AccountView, BatchSyncSummary } from '@/contracts';
import { exchangeService } from '@/services/exchange';
import { AppStoreTabHeader } from '../components/AppStoreTabHeader';
import { EmptyStateCard } from '../components/StatusBanners';
import { useExchangeState } from '../hooks/useExchange';
import {
  formatSyncTimestamp,
  getAvatarColor,
  getAvatarInitial,
  useIos18Palette,
} from '../theme/tokens';

function formatBatchErrorDetails(summary: BatchSyncSummary): string {
  if (summary.errors.length === 1) {
    const single = summary.errors[0];
    return single ? `账户：${single.username}\n原因：${single.message}` : '未知错误';
  }
  return summary.errors
    .map((item, idx) => `${idx + 1}. ${item.username}\n原因：${item.message}`)
    .join('\n\n');
}

export function AccountsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();
  const { accounts, isSyncing, syncingUsernames, lastSyncSummary } = useExchangeState();
  const [feedbackBanner, setFeedbackBanner] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const errorByUsername = useMemo(() => {
    const map = new Map<string, string>();
    if (lastSyncSummary) {
      for (const item of lastSyncSummary.errors) {
        map.set(item.username, item.message);
      }
    }
    return map;
  }, [lastSyncSummary]);

  const showFailureSummaryAlert = (summary: BatchSyncSummary) => {
    if (summary.errors.length === 0) {
      return;
    }
    const title =
      summary.succeeded > 0
        ? `部分账户更新失败（${summary.failed}/${summary.total}）`
        : summary.errors.length === 1
          ? `账户“${summary.errors[0]?.username ?? ''}”更新失败`
          : `全部 ${summary.failed} 个账户更新失败`;

    Alert.alert(title, formatBatchErrorDetails(summary), [{ text: '知道了', style: 'default' }]);
  };

  const showAccountFailureAlert = (username: string, reason: string) => {
    Alert.alert(`账户“${username}”更新失败`, reason, [{ text: '知道了', style: 'default' }]);
  };

  const handleCreateAccount = () => {
    exchangeService.reportUiLog('I', 'ui.accounts.openCreate', 'Opening account creation screen');
    router.push('/account-editor');
  };

  const handleEditAccount = (account: AccountView) => {
    exchangeService.reportUiLog('I', 'ui.accounts.openEdit', `Opening editor for "${account.username}"`);
    router.push({
      pathname: '/account-editor',
      params: { username: account.username },
    });
  };

  const handleDeleteAccount = (account: AccountView) => {
    Alert.alert(
      '删除账户',
      `确定删除账户“${account.username}”吗？关联的缓存用量数据也将一并移除。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const res = await exchangeService.deleteAccount(account.username);
              if (res.ok) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setFeedbackBanner({
                  kind: 'success',
                  message: `已删除账户“${account.username}”`,
                });
              } else {
                Alert.alert('删除失败', res.error.message);
              }
            })();
          },
        },
      ],
    );
  };

  const handleSyncAll = () => {
    if (accounts.length === 0) {
      Alert.alert('提示', '请先添加至少一个账户后再同步用量。');
      return;
    }

    exchangeService.reportUiLog('I', 'ui.accounts.syncAll', `Triggered one-tap sync for ${accounts.length} account(s)`);
    void (async () => {
      const res = await exchangeService.syncAllAccountsUsage('manual');
      if (res.ok) {
        void Haptics.notificationAsync(
          res.data.failed === 0
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Error,
        );
        setFeedbackBanner(
          res.data.failed === 0
            ? {
                kind: 'success',
                message: `已同步全部 ${res.data.succeeded} 个账户的用量信息`,
              }
            : {
                kind: 'error',
                message: `同步完成：成功 ${res.data.succeeded} 个，失败 ${res.data.failed} 个（点击查看原因）`,
              },
        );
        if (res.data.failed > 0) {
          showFailureSummaryAlert(res.data);
        }
      } else {
        setFeedbackBanner({
          kind: 'error',
          message: `同步失败：${res.error.message}`,
        });
        Alert.alert('同步失败', res.error.message);
      }
    })();
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
        title="账户"
        actions={[
          {
            id: 'sync-all',
            symbol: 'arrow.triangle.2.circlepath',
            accessibilityLabel: '一键同步所有账户用量',
            onPress: handleSyncAll,
            loading: isSyncing,
            disabled: accounts.length === 0,
          },
          {
            id: 'add-account',
            symbol: 'plus',
            accessibilityLabel: '新建账户',
            onPress: handleCreateAccount,
          },
        ]}
      />

      <View style={styles.content}>
        {feedbackBanner ? (
          <Pressable
            disabled={feedbackBanner.kind !== 'error' || !lastSyncSummary || lastSyncSummary.failed === 0}
            onPress={() => {
              if (lastSyncSummary && lastSyncSummary.failed > 0) {
                showFailureSummaryAlert(lastSyncSummary);
              }
            }}
            style={[
              styles.feedbackPill,
              {
                backgroundColor:
                  feedbackBanner.kind === 'error'
                    ? palette.dangerBannerBg
                    : palette.successBannerBg,
                borderColor:
                  feedbackBanner.kind === 'error'
                    ? palette.dangerBannerBorder
                    : palette.successBannerBorder,
              },
            ]}
          >
            <SymbolView
              name={
                feedbackBanner.kind === 'error'
                  ? 'exclamationmark.circle.fill'
                  : 'checkmark.circle.fill'
              }
              size={16}
              tintColor={
                feedbackBanner.kind === 'error' ? palette.accentRed : palette.accentGreen
              }
            />
            <Text style={[styles.feedbackText, { color: palette.textPrimary }]} numberOfLines={2}>
              {feedbackBanner.message}
            </Text>
          </Pressable>
        ) : null}

        {accounts.length === 0 ? (
          <EmptyStateCard
            symbol="person.badge.plus"
            title="还没有存储任何账户"
            description="点击右上角“+”按钮添加 CNB 账户的 username、cookie 与可选备注。"
            actionLabel="新建账户"
            onAction={handleCreateAccount}
          />
        ) : (
          <View style={[styles.listGroup, { backgroundColor: palette.bgCard }]}>
            {accounts.map((account, index) => {
              const avatarColor = getAvatarColor(account.username);
              const initial = getAvatarInitial(account.username);
              const isLast = index === accounts.length - 1;
              const isAccountSyncing = syncingUsernames.includes(account.username);
              const syncError = errorByUsername.get(account.username);
              const didSucceedInBatch =
                Boolean(lastSyncSummary) &&
                !syncError &&
                account.lastSyncedAt !== null &&
                !account.isStale &&
                account.createdAt <= (lastSyncSummary?.completedAt ?? 0);

              return (
                <Pressable
                  key={account.username}
                  onPress={() => handleEditAccount(account)}
                  style={({ pressed }) => [
                    styles.accountRow,
                    !isLast && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: palette.separator,
                    },
                    pressed && { backgroundColor: `${palette.bgSecondaryFill}66` },
                  ]}
                >
                  <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
                    <Text style={styles.avatarText}>{initial}</Text>
                  </View>

                  <View style={styles.accountInfo}>
                    <View style={styles.nameLine}>
                      <Text
                        style={[styles.username, { color: palette.textPrimary }]}
                        numberOfLines={1}
                      >
                        {account.username}
                      </Text>

                      {isAccountSyncing ? (
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: `${palette.themeAccent}20` },
                          ]}
                        >
                          <Text style={[styles.statusBadgeText, { color: palette.themeAccent }]}>
                            更新中
                          </Text>
                        </View>
                      ) : syncError ? (
                        <Pressable
                          onPress={() => showAccountFailureAlert(account.username, syncError)}
                          hitSlop={6}
                          style={[
                            styles.statusBadge,
                            { backgroundColor: `${palette.accentRed}20` },
                          ]}
                        >
                          <Text style={[styles.statusBadgeText, { color: palette.accentRed }]}>
                            更新失败
                          </Text>
                        </Pressable>
                      ) : didSucceedInBatch ? (
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: `${palette.accentGreen}22` },
                          ]}
                        >
                          <Text style={[styles.statusBadgeText, { color: palette.accentGreen }]}>
                            更新成功
                          </Text>
                        </View>
                      ) : account.isStale ? (
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: `${palette.accentOrange}20` },
                          ]}
                        >
                          <Text style={[styles.statusBadgeText, { color: palette.accentOrange }]}>
                            待更新
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {account.remark ? (
                      <Text
                        style={[styles.remark, { color: palette.textSecondary }]}
                        numberOfLines={1}
                      >
                        备注：{account.remark}
                      </Text>
                    ) : null}

                    <Text
                      style={[styles.cookieText, { color: palette.textTertiary }]}
                      numberOfLines={1}
                    >
                      Cookie：{account.maskedCookie}
                    </Text>

                    <Text style={[styles.syncTime, { color: palette.textSecondary }]}>
                      用量更新：{formatSyncTimestamp(account.lastSyncedAt)}
                    </Text>

                    {syncError && !isAccountSyncing ? (
                      <Pressable
                        onPress={() => showAccountFailureAlert(account.username, syncError)}
                        hitSlop={4}
                        style={styles.inlineErrorRow}
                      >
                        <Text
                          style={[styles.inlineErrorText, { color: palette.accentRed }]}
                          numberOfLines={1}
                        >
                          失败原因：{syncError}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <View style={styles.rowActions}>
                    <Pressable
                      onPress={() => handleEditAccount(account)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`编辑账户 ${account.username}`}
                      style={({ pressed }) => [
                        styles.iconActionButton,
                        { backgroundColor: palette.bgSecondaryFill, opacity: pressed ? 0.65 : 1 },
                      ]}
                    >
                      <SymbolView name="pencil" size={14} tintColor={palette.themeAccent} />
                    </Pressable>

                    <Pressable
                      onPress={() => handleDeleteAccount(account)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`删除账户 ${account.username}`}
                      style={({ pressed }) => [
                        styles.iconActionButton,
                        { backgroundColor: `${palette.accentRed}18`, opacity: pressed ? 0.65 : 1 },
                      ]}
                    >
                      <SymbolView name="trash" size={14} tintColor={palette.accentRed} />
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}
          </View>
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
    gap: 12,
  },
  feedbackPill: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  listGroup: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  inlineErrorRow: {
    marginTop: 2,
  },
  inlineErrorText: {
    fontSize: 11,
    fontWeight: '500',
  },
  remark: {
    fontSize: 13,
  },
  cookieText: {
    fontSize: 12,
    fontFamily: 'Menlo',
  },
  syncTime: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconActionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
