/**
 * Settings tab screen modeled directly after iOS 18 System Settings inset grouped lists.
 * Ordered top-to-bottom: App Version & System Time, Background Refresh Switch,
 * Auto-Refresh Switch & Interval (minutes), Open Logs, and Clear Cache & Logs.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exchangeService } from '@/services/exchange';
import { AppStoreTabHeader } from '../components/AppStoreTabHeader';
import { useExchangeState } from '../hooks/useExchange';
import { formatClockDateTime, useIos18Palette } from '../theme/tokens';

interface IconBadgeProps {
  symbol: SFSymbol;
  bgColor: string;
}

function SettingIconBadge({ symbol, bgColor }: IconBadgeProps) {
  return (
    <View style={[styles.iconBadge, { backgroundColor: bgColor }]}>
      <SymbolView name={symbol} size={15} tintColor="#FFFFFF" weight="semibold" />
    </View>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();
  const { settings } = useExchangeState();
  const [now, setNow] = useState(() => new Date());

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleToggleOnLaunch = (nextValue: boolean) => {
    exchangeService.reportUiLog(
      'I',
      'ui.settings.toggleOnLaunch',
      `Set autoRefreshOnLaunch=${nextValue}`,
    );
    void exchangeService.updateSettings({ autoRefreshOnLaunch: nextValue });
  };

  const handleToggleAutoRefresh = (nextValue: boolean) => {
    exchangeService.reportUiLog(
      'I',
      'ui.settings.toggleAutoRefresh',
      `Set autoRefreshEnabled=${nextValue}`,
    );
    void exchangeService.updateSettings({ autoRefreshEnabled: nextValue });
  };

  const handleStepInterval = (delta: number) => {
    const nextMinutes = Math.max(1, Math.min(1440, settings.autoRefreshIntervalMinutes + delta));
    if (nextMinutes === settings.autoRefreshIntervalMinutes) {
      return;
    }
    void Haptics.selectionAsync();
    exchangeService.reportUiLog(
      'I',
      'ui.settings.changeInterval',
      `Updated autoRefreshIntervalMinutes=${nextMinutes}`,
    );
    void exchangeService.updateSettings({ autoRefreshIntervalMinutes: nextMinutes });
  };

  const handleOpenLogs = () => {
    exchangeService.reportUiLog('I', 'ui.settings.openLogs', 'Opening standalone Logs page');
    router.push('/logs');
  };

  const handleClearCacheAndLogs = () => {
    Alert.alert(
      '清除缓存和 Log 数据',
      '将清空本地缓存的用量快照与所有运行日志（账户配置与系统设置会保留）。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认清除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const res = await exchangeService.clearCacheAndLogs();
              if (res.ok) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert(
                  '已清除',
                  `已清除 ${res.data.clearedCacheCount} 条缓存快照和 ${res.data.clearedLogCount} 条日志。`,
                );
              } else {
                Alert.alert('清除失败', res.error.message);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.bgCanvas }]}
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 84 }}
    >
      <AppStoreTabHeader title="设置" />

      <View style={styles.sectionsWrap}>
        {/* Section 1: App Version & Current System Time */}
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>应用信息</Text>
          <View style={[styles.groupCard, { backgroundColor: palette.bgCard }]}>
            <View
              style={[
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.separator,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <SettingIconBadge symbol="app.badge" bgColor={palette.brandOrange} />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>App 版本</Text>
              </View>
              <Text style={[styles.rowValue, { color: palette.textSecondary }]}>
                v{appVersion}
              </Text>
            </View>

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <SettingIconBadge symbol="clock.fill" bgColor={palette.accentBlue} />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>当前系统时间</Text>
              </View>
              <Text style={[styles.rowValue, { color: palette.textSecondary }]}>
                {formatClockDateTime(now)}
              </Text>
            </View>
          </View>
        </View>

        {/* Section 2: Background & Periodic Auto-Refresh */}
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>刷新策略</Text>
          <View style={[styles.groupCard, { backgroundColor: palette.bgCard }]}>
            <View
              style={[
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.separator,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <SettingIconBadge
                  symbol="arrow.clockwise.icloud.fill"
                  bgColor={palette.accentGreen}
                />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>
                  启用应用时后台自动刷新用量
                </Text>
              </View>
              <Switch
                value={settings.autoRefreshOnLaunch}
                onValueChange={handleToggleOnLaunch}
              />
            </View>

            <View
              style={[
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.separator,
                },
              ]}
            >
              <View style={styles.rowLeft}>
                <SettingIconBadge symbol="timer" bgColor={palette.accentIndigo} />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>自动刷新</Text>
              </View>
              <Switch
                value={settings.autoRefreshEnabled}
                onValueChange={handleToggleAutoRefresh}
              />
            </View>

            <View
              style={[
                styles.row,
                !settings.autoRefreshEnabled && styles.rowDimmed,
              ]}
            >
              <View style={styles.rowLeft}>
                <SettingIconBadge symbol="hourglass" bgColor={palette.accentOrange} />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>
                  自动刷新间隔
                </Text>
              </View>

              <View style={styles.stepper}>
                <Pressable
                  onPress={() => handleStepInterval(-5)}
                  onLongPress={() => handleStepInterval(-1)}
                  disabled={!settings.autoRefreshEnabled || settings.autoRefreshIntervalMinutes <= 1}
                  style={({ pressed }) => [
                    styles.stepBtn,
                    {
                      backgroundColor: palette.bgSecondaryFill,
                      opacity: pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.stepBtnText, { color: palette.textPrimary }]}>−</Text>
                </Pressable>

                <Text style={[styles.intervalText, { color: palette.textPrimary }]}>
                  {settings.autoRefreshIntervalMinutes} 分钟
                </Text>

                <Pressable
                  onPress={() => handleStepInterval(5)}
                  onLongPress={() => handleStepInterval(1)}
                  disabled={!settings.autoRefreshEnabled || settings.autoRefreshIntervalMinutes >= 1440}
                  style={({ pressed }) => [
                    styles.stepBtn,
                    {
                      backgroundColor: palette.bgSecondaryFill,
                      opacity: pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.stepBtnText, { color: palette.textPrimary }]}>＋</Text>
                </Pressable>
              </View>
            </View>
          </View>
          <Text style={[styles.sectionFooter, { color: palette.textSecondary }]}>
            点按“− / ＋”每次调整 5 分钟，长按微调 1 分钟（范围 1–1440 分钟）。
          </Text>
        </View>

        {/* Section 3: Open Logs Standalone Page */}
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>诊断日志</Text>
          <View style={[styles.groupCard, { backgroundColor: palette.bgCard }]}>
            <Pressable
              onPress={handleOpenLogs}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: `${palette.bgSecondaryFill}66` },
              ]}
            >
              <View style={styles.rowLeft}>
                <SettingIconBadge symbol="doc.text.magnifyingglass" bgColor="#636366" />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>运行日志 (Log)</Text>
              </View>
              <View style={styles.chevronRight}>
                <Text style={[styles.rowValue, { color: palette.textSecondary }]}>查看</Text>
                <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={palette.textTertiary} />
              </View>
            </Pressable>
          </View>
        </View>

        {/* Section 4: Clear Cache and Log Data */}
        <View style={styles.sectionBlock}>
          <View style={[styles.groupCard, { backgroundColor: palette.bgCard }]}>
            <Pressable
              onPress={handleClearCacheAndLogs}
              style={({ pressed }) => [
                styles.destructiveRow,
                pressed && { backgroundColor: `${palette.accentRed}14` },
              ]}
            >
              <SymbolView name="trash.fill" size={16} tintColor={palette.accentRed} />
              <Text style={[styles.destructiveText, { color: palette.accentRed }]}>
                清除缓存和 Log 数据
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionsWrap: {
    paddingHorizontal: 16,
    gap: 20,
  },
  sectionBlock: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 14,
  },
  sectionFooter: {
    fontSize: 12,
    paddingHorizontal: 14,
  },
  groupCard: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowDimmed: {
    opacity: 0.45,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 16,
    flexShrink: 1,
  },
  rowValue: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 30,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  intervalText: {
    fontSize: 15,
    fontWeight: '600',
    minWidth: 56,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  chevronRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  destructiveRow: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  destructiveText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
