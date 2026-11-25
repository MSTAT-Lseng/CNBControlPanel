/**
 * Standalone Log Viewer screen rendered inside a native iOS 18 Stack header.
 * Reads logs from the Update Exchange Log Subsystem, supports filtering by level,
 * partial multi-select clipboard copying, and full clipboard export.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LogEntry, LogLevel } from '@/contracts';
import { exchangeService } from '@/services/exchange';
import {
  formatClockDateTime,
  getLogLevelColor,
  useIos18Palette,
} from '../theme/tokens';

type LevelFilter = 'ALL' | LogLevel;

const LEVEL_FILTERS: readonly { key: LevelFilter; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'V', label: 'V' },
  { key: 'I', label: 'I' },
  { key: 'W', label: 'W' },
  { key: 'E', label: 'E' },
];

function formatLogsForClipboard(entries: LogEntry[]): string {
  return entries
    .map((entry) => {
      const ts = formatClockDateTime(new Date(entry.timestamp), true);
      const details = entry.details ? ` | ${entry.details}` : '';
      const note = entry.note ? ` [Note: ${entry.note}]` : '';
      return `[${ts}] [${entry.level}] [${entry.source}] ${entry.action} — ${entry.message}${details}${note}`;
    })
    .join('\n');
}

export function LogsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [toastText, setToastText] = useState<string | null>(null);

  const fetchMatchingLogs = useCallback(async () => {
    const res = await exchangeService.queryLogs({
      levels: levelFilter === 'ALL' ? undefined : [levelFilter],
      search: searchQuery.trim() || undefined,
      limit: 500,
    });
    return res.ok ? res.data : null;
  }, [levelFilter, searchQuery]);

  useEffect(() => {
    let cancelled = false;
    void fetchMatchingLogs().then((data) => {
      if (!cancelled && data !== null) {
        setLogs(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMatchingLogs]);

  useEffect(() => {
    const unsubscribe = exchangeService.subscribeLogs(() => {
      void fetchMatchingLogs().then((data) => {
        if (data !== null) {
          setLogs(data);
        }
      });
    });
    return unsubscribe;
  }, [fetchMatchingLogs]);

  const showToast = useCallback((message: string) => {
    setToastText(message);
    setTimeout(() => {
      setToastText((current) => (current === message ? null : current));
    }, 2200);
  }, []);

  const handleCopyAll = useCallback(async () => {
    if (logs.length === 0) {
      Alert.alert('提示', '当前没有可复制的日志记录。');
      return;
    }
    const payload = formatLogsForClipboard(logs);
    await Clipboard.setStringAsync(payload);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`已复制全部 ${logs.length} 条日志`);
  }, [logs, showToast]);

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedIds(new Set());
      }
      return !prev;
    });
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '运行日志',
      headerStyle: { backgroundColor: palette.bgCard },
      headerTintColor: palette.accentBlue,
      headerTitleStyle: { color: palette.textPrimary },
      headerRight: () => (
        <View style={styles.headerRightRow}>
          <Pressable onPress={handleToggleSelectionMode} hitSlop={8}>
            <Text style={[styles.headerBtnText, { color: palette.accentBlue }]}>
              {selectionMode ? '完成' : '选择'}
            </Text>
          </Pressable>
          <Pressable onPress={() => void handleCopyAll()} hitSlop={8}>
            <Text style={[styles.headerBtnText, { color: palette.accentBlue }]}>复制全部</Text>
          </Pressable>
        </View>
      ),
    });
  }, [handleCopyAll, handleToggleSelectionMode, navigation, palette, selectionMode]);

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map((entry) => entry.id)));
    }
  };

  const selectedEntries = useMemo(
    () => logs.filter((entry) => selectedIds.has(entry.id)),
    [logs, selectedIds],
  );

  const handleCopySelected = async () => {
    if (selectedEntries.length === 0) {
      return;
    }
    await Clipboard.setStringAsync(formatLogsForClipboard(selectedEntries));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`已复制所选 ${selectedEntries.length} 条日志`);
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleCopySingle = async (entry: LogEntry) => {
    await Clipboard.setStringAsync(formatLogsForClipboard([entry]));
    void Haptics.selectionAsync();
    showToast('已复制该条日志');
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.bgCanvas }]}>
      <View
        style={[
          styles.filterBar,
          {
            backgroundColor: palette.bgCard,
            borderBottomColor: palette.separator,
          },
        ]}
      >
        <View style={styles.levelRow}>
          {LEVEL_FILTERS.map((item) => {
            const active = item.key === levelFilter;
            const badgeColor =
              item.key === 'ALL' ? palette.accentBlue : getLogLevelColor(item.key, palette);

            return (
              <Pressable
                key={item.key}
                onPress={() => setLevelFilter(item.key)}
                style={[
                  styles.levelPill,
                  {
                    backgroundColor: active ? badgeColor : palette.bgSecondaryFill,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.levelPillText,
                    { color: active ? '#FFFFFF' : palette.textPrimary },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.searchBox, { backgroundColor: palette.bgSecondaryFill }]}>
          <SymbolView name="magnifyingglass" size={14} tintColor={palette.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="搜索操作、消息或详情"
            placeholderTextColor={palette.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: palette.textPrimary }]}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <SymbolView name="xmark.circle.fill" size={14} tintColor={palette.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {toastText ? (
        <View
          style={[
            styles.toastBar,
            {
              backgroundColor: palette.successBannerBg,
              borderColor: palette.successBannerBorder,
            },
          ]}
        >
          <SymbolView name="checkmark.circle.fill" size={15} tintColor={palette.accentGreen} />
          <Text style={[styles.toastText, { color: palette.textPrimary }]}>{toastText}</Text>
        </View>
      ) : null}

      <FlatList
        data={logs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: (selectionMode ? 84 : 24) + insets.bottom },
        ]}
        ListEmptyComponent={
          <View style={[styles.emptyBox, { backgroundColor: palette.bgCard }]}>
            <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>暂无匹配日志</Text>
            <Text style={[styles.emptySub, { color: palette.textSecondary }]}>
              各服务执行操作时将自动记录 V/I/W/E 级别日志。
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const levelColor = getLogLevelColor(item.level, palette);
          const isSelected = selectedIds.has(item.id);
          const formattedTime = formatClockDateTime(new Date(item.timestamp), true).slice(11);

          return (
            <Pressable
              onPress={() => {
                if (selectionMode) {
                  toggleSelectId(item.id);
                }
              }}
              onLongPress={() => void handleCopySingle(item)}
              style={[
                styles.logCard,
                {
                  backgroundColor: palette.bgCard,
                  borderColor: isSelected ? palette.accentBlue : 'transparent',
                  borderWidth: isSelected ? 1.5 : 0,
                },
              ]}
            >
              <View style={styles.logHeader}>
                {selectionMode ? (
                  <SymbolView
                    name={isSelected ? 'checkmark.circle.fill' : 'circle'}
                    size={20}
                    tintColor={isSelected ? palette.accentBlue : palette.textTertiary}
                  />
                ) : null}

                <View style={[styles.levelBadge, { backgroundColor: `${levelColor}22` }]}>
                  <Text style={[styles.levelBadgeText, { color: levelColor }]}>
                    {item.level}
                  </Text>
                </View>

                <Text style={[styles.sourceTag, { color: palette.textSecondary }]}>
                  {item.source}
                </Text>

                <Text style={[styles.actionName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {item.action}
                </Text>

                <Text style={[styles.timeText, { color: palette.textTertiary }]}>
                  {formattedTime}
                </Text>
              </View>

              <Text
                selectable={!selectionMode}
                style={[styles.messageText, { color: palette.textPrimary }]}
              >
                {item.message}
              </Text>

              {item.details ? (
                <Text
                  selectable={!selectionMode}
                  style={[styles.detailsText, { color: palette.textSecondary }]}
                >
                  {item.details}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />

      {selectionMode ? (
        <View
          style={[
            styles.selectionToolbar,
            {
              backgroundColor: palette.bgCard,
              borderTopColor: palette.separator,
              paddingBottom: Math.max(12, insets.bottom),
            },
          ]}
        >
          <Pressable onPress={handleSelectAllVisible} hitSlop={8}>
            <Text style={[styles.toolbarLink, { color: palette.accentBlue }]}>
              {selectedIds.size === logs.length && logs.length > 0 ? '取消全选' : '全选当前'}
            </Text>
          </Pressable>

          <Text style={[styles.selectedCount, { color: palette.textSecondary }]}>
            已选 {selectedIds.size} 条
          </Text>

          <Pressable
            onPress={() => void handleCopySelected()}
            disabled={selectedIds.size === 0}
            style={[
              styles.copySelectedBtn,
              {
                backgroundColor: palette.accentBlue,
                opacity: selectedIds.size === 0 ? 0.45 : 1,
              },
            ]}
          >
            <Text style={styles.copySelectedText}>复制所选</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  filterBar: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  levelRow: {
    flexDirection: 'row',
    gap: 8,
  },
  levelPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  levelPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  toastBar: {
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toastText: {
    fontSize: 13,
    fontWeight: '500',
  },
  listContent: {
    padding: 14,
    gap: 10,
  },
  emptyBox: {
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
  },
  logCard: {
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  levelBadge: {
    width: 22,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sourceTag: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionName: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Menlo',
  },
  timeText: {
    fontSize: 11,
    fontFamily: 'Menlo',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 19,
  },
  detailsText: {
    fontSize: 12,
    fontFamily: 'Menlo',
    lineHeight: 17,
  },
  selectionToolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolbarLink: {
    fontSize: 15,
    fontWeight: '600',
  },
  selectedCount: {
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  copySelectedBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  copySelectedText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
