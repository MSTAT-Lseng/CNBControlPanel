/**
 * Settings tab screen modeled directly after iOS 18 System Settings inset grouped lists.
 * Ordered top-to-bottom: App Version & System Time, Background Refresh Switch,
 * Auto-Refresh Switch & Interval (minutes), Log Retention & Viewer, and Clear Cache & Logs.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppSettings } from '@/contracts/domain';
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
  const { settings: persistedSettings } = useExchangeState();
  const [pendingSettings, setPendingSettings] = useState<Partial<AppSettings> | null>(null);
  const settings = { ...persistedSettings, ...pendingSettings };
  const savingSettings = pendingSettings !== null;
  const [now, setNow] = useState(() => new Date());
  const settingsSaveLock = useRef(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupBusyRef = useRef(false);
  const retentionDisabled = !settings.autoLogCleanupEnabled;
  const decreaseRetentionDisabled = retentionDisabled || settings.logRetentionHours <= 1;
  const increaseRetentionDisabled = retentionDisabled || settings.logRetentionHours >= 720;

  const appVersion = Constants.expoConfig?.version ?? '1.0.2';

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const saveSettings = async (patch: Partial<AppSettings>) => {
    // Serialize saves without toggling native disabled styles or changing the page layout.
    if (settingsSaveLock.current) {
      return;
    }
    settingsSaveLock.current = true;
    // Keep controlled switches responsive while persistence is in flight.
    setPendingSettings(patch);
    try {
      const result = await exchangeService.updateSettings(patch);
      if (!result.ok) {
        Alert.alert('保存设置失败', result.error.message);
      }
    } catch {
      Alert.alert('保存设置失败', '暂时无法保存设置，请稍后重试。');
    } finally {
      settingsSaveLock.current = false;
      // Exchange publishes successful saves; failures fall back to the persisted values.
      setPendingSettings(null);
    }
  };

  const handleToggleOnLaunch = (nextValue: boolean) => {
    if (settingsSaveLock.current) {
      return;
    }
    exchangeService.reportUiLog(
      'I',
      'ui.settings.toggleOnLaunch',
      `Set autoRefreshOnLaunch=${nextValue}`,
    );
    void saveSettings({ autoRefreshOnLaunch: nextValue });
  };

  const handleToggleAutoRefresh = (nextValue: boolean) => {
    if (settingsSaveLock.current) {
      return;
    }
    exchangeService.reportUiLog(
      'I',
      'ui.settings.toggleAutoRefresh',
      `Set autoRefreshEnabled=${nextValue}`,
    );
    void saveSettings({ autoRefreshEnabled: nextValue });
  };

  const handleStepInterval = (delta: number) => {
    if (settingsSaveLock.current || !settings.autoRefreshEnabled) {
      return;
    }
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
    void saveSettings({ autoRefreshIntervalMinutes: nextMinutes });
  };

  const handleToggleLogCleanup = (nextValue: boolean) => {
    if (settingsSaveLock.current) {
      return;
    }
    exchangeService.reportUiLog(
      'I',
      'ui.settings.toggleLogCleanup',
      `Set autoLogCleanupEnabled=${nextValue}`,
    );
    void saveSettings({ autoLogCleanupEnabled: nextValue });
  };

  const handleStepLogRetention = (delta: number) => {
    if (settingsSaveLock.current || !settings.autoLogCleanupEnabled) {
      return;
    }
    const nextHours = Math.max(1, Math.min(720, settings.logRetentionHours + delta));
    if (nextHours === settings.logRetentionHours) {
      return;
    }
    void Haptics.selectionAsync();
    exchangeService.reportUiLog(
      'I',
      'ui.settings.changeLogRetention',
      `Set logRetentionHours=${nextHours}`,
    );
    void saveSettings({ logRetentionHours: nextHours });
  };

  const handleOpenLogs = () => {
    exchangeService.reportUiLog('I', 'ui.settings.openLogs', 'Opening standalone Logs page');
    router.push('/logs');
  };

  const buildBackupFileName = (): string => {
    const stamp = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `cnb-panel-accounts-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(
      stamp.getDate(),
    )}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.json`;
  };

  const handleExportAccounts = () => {
    if (backupBusyRef.current) {
      return;
    }
    exchangeService.reportUiLog('I', 'ui.settings.exportAccounts', 'Export accounts requested');
    Alert.alert(
      '导出账户数据',
      '导出的 JSON 文件包含所有账户的明文 Cookie。请仅保存在安全位置，勿通过不安全渠道传输。是否继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '继续导出',
          onPress: () => {
            void (async () => {
              if (backupBusyRef.current) {
                return;
              }
              backupBusyRef.current = true;
              setBackupBusy(true);
              try {
                const res = await exchangeService.exportAccounts();
                if (!res.ok) {
                  Alert.alert('导出失败', res.error.message);
                  return;
                }
                const file = new File(Paths.document, buildBackupFileName());
                await file.write(JSON.stringify(res.data, null, 2));
                await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
                exchangeService.reportUiLog(
                  'I',
                  'ui.settings.exportAccounts',
                  `Shared backup with ${res.data.accounts.length} account(s)`,
                );
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                exchangeService.reportUiLog('E', 'ui.settings.exportAccounts', message);
                Alert.alert('导出失败', '无法生成或分享备份文件，请稍后重试。');
              } finally {
                backupBusyRef.current = false;
                setBackupBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const handleImportAccounts = () => {
    if (backupBusyRef.current) {
      return;
    }
    exchangeService.reportUiLog('I', 'ui.settings.importAccounts', 'Import accounts requested');
    void (async () => {
      backupBusyRef.current = true;
      setBackupBusy(true);
      try {
        const picked = await DocumentPicker.getDocumentAsync({
          type: 'application/json',
          copyToCacheDirectory: true,
        });
        if (picked.canceled || !picked.assets || picked.assets.length === 0) {
          return;
        }
        const [asset] = picked.assets;
        if (!asset) {
          return;
        }
        const raw = await new File(asset.uri).text();
        const res = await exchangeService.importAccounts(raw);
        if (!res.ok) {
          exchangeService.reportUiLog('W', 'ui.settings.importAccounts', res.error.message);
          Alert.alert('导入失败', res.error.message);
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        exchangeService.reportUiLog(
          'I',
          'ui.settings.importAccounts',
          `Imported ${res.data.total} account(s) (created=${res.data.created}, updated=${res.data.updated})`,
        );
        const failureLines = res.data.failed
          .map((failure) => `${failure.username}：${failure.message}`)
          .join('\n');
        Alert.alert(
          '导入完成',
          `共 ${res.data.total} 个账户，新建 ${res.data.created}，覆盖 ${res.data.updated}，跳过 ${res.data.skipped}，失败 ${res.data.failed.length}。` +
            (failureLines ? `\n\n失败详情：\n${failureLines}` : ''),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        exchangeService.reportUiLog('E', 'ui.settings.importAccounts', message);
        Alert.alert('导入失败', '无法读取备份文件，请确认文件格式后重试。');
      } finally {
        backupBusyRef.current = false;
        setBackupBusy(false);
      }
    })();
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

        {/* Section 3: Local Log Retention and Standalone Viewer */}
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>诊断日志</Text>
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
                <SettingIconBadge symbol="trash.fill" bgColor={palette.accentGreen} />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>
                  自动清理过期日志
                </Text>
              </View>
              <Switch
                accessibilityLabel="自动清理过期日志"
                accessibilityState={{ busy: savingSettings }}
                value={settings.autoLogCleanupEnabled}
                onValueChange={handleToggleLogCleanup}
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
              <View style={[styles.rowLeft, retentionDisabled && styles.rowDimmed]}>
                <SettingIconBadge symbol="hourglass" bgColor={palette.accentOrange} />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>
                  日志保留时长
                </Text>
              </View>
              <View style={[styles.stepper, retentionDisabled && styles.rowDimmed]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="日志保留时长减少 1 小时"
                  accessibilityState={{ disabled: decreaseRetentionDisabled, busy: savingSettings }}
                  onPress={() => handleStepLogRetention(-1)}
                  disabled={decreaseRetentionDisabled}
                  style={({ pressed }) => [
                    styles.stepBtn,
                    {
                      backgroundColor: palette.bgSecondaryFill,
                      opacity: decreaseRetentionDisabled ? 0.45 : pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.stepBtnText, { color: palette.textPrimary }]}>−</Text>
                </Pressable>
                <Text
                  accessibilityLabel={`日志保留时长 ${settings.logRetentionHours} 小时`}
                  style={[styles.intervalText, { color: palette.textPrimary }]}
                >
                  {settings.logRetentionHours} 小时
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="日志保留时长增加 1 小时"
                  accessibilityState={{ disabled: increaseRetentionDisabled, busy: savingSettings }}
                  onPress={() => handleStepLogRetention(1)}
                  disabled={increaseRetentionDisabled}
                  style={({ pressed }) => [
                    styles.stepBtn,
                    {
                      backgroundColor: palette.bgSecondaryFill,
                      opacity: increaseRetentionDisabled ? 0.45 : pressed ? 0.65 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.stepBtnText, { color: palette.textPrimary }]}>＋</Text>
                </Pressable>
              </View>
            </View>

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
          <Text style={[styles.sectionFooter, { color: palette.textSecondary }]}>
            点按“− / ＋”每次调整 1 小时（范围 1–720 小时）。
          </Text>
        </View>

        {/* Section 4: Account Backup Export and Import */}
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>账户数据</Text>
          <View style={[styles.groupCard, { backgroundColor: palette.bgCard }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="导出账户"
              accessibilityState={{ disabled: backupBusy, busy: backupBusy }}
              onPress={handleExportAccounts}
              disabled={backupBusy}
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.separator,
                },
                pressed && !backupBusy && { backgroundColor: `${palette.bgSecondaryFill}66` },
                backupBusy && styles.rowDimmed,
              ]}
            >
              <View style={styles.rowLeft}>
                <SettingIconBadge symbol="square.and.arrow.up" bgColor={palette.themeAccent} />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>导出账户</Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={13}
                weight="semibold"
                tintColor={palette.textTertiary}
              />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="导入账户"
              accessibilityState={{ disabled: backupBusy, busy: backupBusy }}
              onPress={handleImportAccounts}
              disabled={backupBusy}
              style={({ pressed }) => [
                styles.row,
                pressed && !backupBusy && { backgroundColor: `${palette.bgSecondaryFill}66` },
                backupBusy && styles.rowDimmed,
              ]}
            >
              <View style={styles.rowLeft}>
                <SettingIconBadge symbol="square.and.arrow.down" bgColor={palette.accentBlue} />
                <Text style={[styles.rowTitle, { color: palette.textPrimary }]}>导入账户</Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={13}
                weight="semibold"
                tintColor={palette.textTertiary}
              />
            </Pressable>
          </View>
          <Text style={[styles.sectionFooter, { color: palette.textSecondary }]}>
            导出的文件包含明文 Cookie，请勿通过不安全渠道传输或长期保存。
          </Text>
        </View>

        {/* Section 5: Clear Cache and Log Data */}
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
