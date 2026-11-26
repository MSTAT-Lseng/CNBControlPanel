/**
 * Standalone Container Build Log screen rendered inside a native iOS 18 Stack header.
 * Displays container build metadata, resource/AI billing usage, sanitized pipeline config keys,
 * and expandable per-stage terminal log outputs fetched on demand.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  WorkspaceBuildLogDetail,
  WorkspaceStageLog,
  WorkspaceStageSummary,
} from '@/contracts';
import { exchangeService } from '@/services/exchange';
import { EmptyStateCard } from '../components/StatusBanners';
import {
  fetchWorkspaceBuildLogViaExchange,
  fetchWorkspaceStageLogViaExchange,
} from '../hooks/useExchange';
import { useIos18Palette } from '../theme/tokens';
import {
  formatAiCreditsFromMilli,
  formatDurationMs,
  formatShanghaiDateTime,
  getBuildStatusMeta,
} from '../theme/workspaceFormat';

const STAGE_COLLAPSE_THRESHOLD = 40;
const STAGE_HEAD_LINES = 15;
const STAGE_TAIL_LINES = 20;
const STAGE_TEXT_CHUNK_SIZE = 150;

interface StageLogState {
  loading: boolean;
  data: WorkspaceStageLog | null;
  error: string | null;
  showFull: boolean;
}

function buildDisplayedStageLines(lines: string[], showFull: boolean): {
  chunks: string[];
  omittedCount: number;
} {
  let displayLines: string[];
  let omittedCount = 0;

  if (showFull || lines.length <= STAGE_COLLAPSE_THRESHOLD) {
    displayLines = lines;
  } else {
    const head = lines.slice(0, STAGE_HEAD_LINES);
    const tail = lines.slice(-STAGE_TAIL_LINES);
    omittedCount = lines.length - head.length - tail.length;
    displayLines = [...head, `... 已折叠中间 ${omittedCount} 行 ...`, ...tail];
  }

  const chunks: string[] = [];
  for (let i = 0; i < displayLines.length; i += STAGE_TEXT_CHUNK_SIZE) {
    chunks.push(displayLines.slice(i, i + STAGE_TEXT_CHUNK_SIZE).join('\n'));
  }

  return { chunks, omittedCount };
}

export function WorkspaceLogsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const palette = useIos18Palette();
  const params = useLocalSearchParams<{
    username?: string;
    slug?: string;
    sn?: string;
    pipelineId?: string;
    branch?: string;
  }>();

  const username = typeof params.username === 'string' ? params.username.trim() : '';
  const slug = typeof params.slug === 'string' ? params.slug.trim() : '';
  const sn = typeof params.sn === 'string' ? params.sn.trim() : '';
  const branch = typeof params.branch === 'string' ? params.branch.trim() : '';

  const hasValidParams = Boolean(username && slug && sn);

  const [detail, setDetail] = useState<WorkspaceBuildLogDetail | null>(null);
  const [isLoading, setIsLoading] = useState(() => hasValidParams);
  const [errorText, setErrorText] = useState<string | null>(() =>
    hasValidParams ? null : '缺少容器标识参数（username / slug / sn）',
  );
  const [expandedStageIds, setExpandedStageIds] = useState<Set<string>>(() => new Set());
  const [stageLogs, setStageLogs] = useState<Record<string, StageLogState>>({});
  const [toastText, setToastText] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToastText(message);
    setTimeout(() => {
      if (mountedRef.current) {
        setToastText((current) => (current === message ? null : current));
      }
    }, 2200);
  }, []);

  const loadBuildLog = useCallback(async () => {
    if (!hasValidParams) {
      setErrorText('缺少容器标识参数（username / slug / sn）');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorText(null);

    const res = await fetchWorkspaceBuildLogViaExchange({
      username,
      slug,
      sn,
      includeConfig: true,
    });

    if (!mountedRef.current) {
      return;
    }

    if (res.ok) {
      setDetail(res.data);
    } else {
      setErrorText(res.error.message);
    }
    setIsLoading(false);
  }, [hasValidParams, slug, sn, username]);

  useEffect(() => {
    if (!hasValidParams) {
      return;
    }

    let cancelled = false;
    void fetchWorkspaceBuildLogViaExchange({
      username,
      slug,
      sn,
      includeConfig: true,
    }).then((res) => {
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setDetail(res.data);
      } else {
        setErrorText(res.error.message);
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [hasValidParams, slug, sn, username]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '构建日志',
      headerStyle: { backgroundColor: palette.bgCard },
      headerTintColor: palette.themeAccent,
      headerTitleStyle: { color: palette.textPrimary },
      headerRight: () => (
        <Pressable
          onPress={() => void loadBuildLog()}
          disabled={isLoading}
          hitSlop={8}
          accessibilityLabel="刷新构建日志"
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
  }, [isLoading, loadBuildLog, navigation, palette]);

  const loadStageLog = useCallback(
    async (stage: WorkspaceStageSummary) => {
      if (!detail) {
        return;
      }

      setStageLogs((prev) => ({
        ...prev,
        [stage.id]: {
          loading: true,
          data: prev[stage.id]?.data ?? null,
          error: null,
          showFull: prev[stage.id]?.showFull ?? false,
        },
      }));

      const res = await fetchWorkspaceStageLogViaExchange({
        username,
        slug: detail.slug,
        sn: detail.sn,
        pipelineId: detail.pipelineId,
        stageId: stage.id,
        status: stage.status,
      });

      if (!mountedRef.current) {
        return;
      }

      if (res.ok) {
        setStageLogs((prev) => ({
          ...prev,
          [stage.id]: {
            loading: false,
            data: res.data,
            error: null,
            showFull: prev[stage.id]?.showFull ?? false,
          },
        }));
      } else {
        setStageLogs((prev) => ({
          ...prev,
          [stage.id]: {
            loading: false,
            data: prev[stage.id]?.data ?? null,
            error: res.error.message,
            showFull: prev[stage.id]?.showFull ?? false,
          },
        }));
      }
    },
    [detail, username],
  );

  const handleToggleStage = (stage: WorkspaceStageSummary) => {
    const isCurrentlyExpanded = expandedStageIds.has(stage.id);
    setExpandedStageIds((prev) => {
      const next = new Set(prev);
      if (next.has(stage.id)) {
        next.delete(stage.id);
      } else {
        next.add(stage.id);
      }
      return next;
    });

    const existing = stageLogs[stage.id];
    if (!isCurrentlyExpanded && !existing?.data && !existing?.loading) {
      exchangeService.reportUiLog(
        'I',
        'ui.workspaceLogs.loadStage',
        `Loaded stage "${stage.id}" log for "${sn}"`,
      );
      void loadStageLog(stage);
    }
  };

  const handleToggleFullStage = (stageId: string) => {
    setStageLogs((prev) => {
      const existing = prev[stageId];
      if (!existing) {
        return prev;
      }
      return {
        ...prev,
        [stageId]: {
          ...existing,
          showFull: !existing.showFull,
        },
      };
    });
  };

  const handleCopyStageLog = async (stageLog: WorkspaceStageLog) => {
    const payload = stageLog.lines.join('\n');
    if (!payload) {
      return;
    }
    await Clipboard.setStringAsync(payload);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`已复制 ${stageLog.name} 阶段 ${stageLog.lines.length} 行日志`);
  };

  const buildBadge = detail ? getBuildStatusMeta(detail.buildStatus, palette) : null;

  return (
    <View style={[styles.container, { backgroundColor: palette.bgCanvas }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && !detail ? (
          <View style={styles.centeredLoader}>
            <ActivityIndicator size="large" color={palette.themeAccent} />
            <Text style={[styles.loadingLabel, { color: palette.textSecondary }]}>
              正在获取构建日志详情...
            </Text>
          </View>
        ) : errorText && !detail ? (
          <EmptyStateCard
            symbol="doc.text.magnifyingglass"
            title="无法获取构建日志"
            description={`${errorText}（CNB 构建日志默认保留 7 天）`}
            actionLabel="重试"
            onAction={() => void loadBuildLog()}
          />
        ) : detail && buildBadge ? (
          <>
            <View style={[styles.card, { backgroundColor: palette.bgCard }]}>
              <View style={styles.cardTopRow}>
                <View style={styles.titleCol}>
                  <Text style={[styles.repoTitle, { color: palette.textPrimary }]}>
                    {detail.slug}
                    {branch ? ` @ ${branch}` : ''}
                  </Text>
                  <Text style={[styles.snMono, { color: palette.textTertiary }]}>
                    {detail.sn}
                  </Text>
                </View>

                <View style={[styles.statusBadge, { backgroundColor: buildBadge.bgColor }]}>
                  <Text style={[styles.statusBadgeText, { color: buildBadge.color }]}>
                    {buildBadge.label}
                  </Text>
                </View>
              </View>

              <View style={[styles.kvGrid, { borderTopColor: palette.separator }]}>
                <InfoRow
                  label="标题 / 事件"
                  value={`${detail.title}${detail.event ? ` · ${detail.event}` : ''}`}
                />
                {detail.sha ? (
                  <InfoRow label="Commit" value={detail.sha.slice(0, 8)} mono />
                ) : null}
                <InfoRow
                  label="构建时间"
                  value={`${formatShanghaiDateTime(detail.startTimestamp, true)} → ${
                    detail.endTimestamp > 0
                      ? formatShanghaiDateTime(detail.endTimestamp, true)
                      : '进行中'
                  }`}
                />
                <InfoRow
                  label="总耗时"
                  value={`${formatDurationMs(detail.durationMs)}${
                    detail.canRebuild ? ' · 可重建' : ''
                  }`}
                />
                {detail.image ? <InfoRow label="开发镜像" value={detail.image} mono /> : null}
                {detail.cpus !== undefined || detail.metricCoreHours !== undefined ? (
                  <InfoRow
                    label="算力与计费"
                    value={[
                      detail.cpus !== undefined
                        ? `${detail.cpus} 核${detail.isGpu ? ' · GPU' : ''}`
                        : null,
                      detail.metricCoreHours !== undefined
                        ? `计费 ${detail.metricCoreHours.toFixed(2)} 核时`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ) : null}
                {detail.ip ? (
                  <InfoRow
                    label="运行地址"
                    value={detail.port ? `${detail.ip}:${detail.port}` : detail.ip}
                    mono
                  />
                ) : null}
                {detail.aiUsage ? (
                  <InfoRow
                    label="AI 用量"
                    value={`${detail.aiUsage.totalTokens.toLocaleString('en-US')} tokens · ${formatAiCreditsFromMilli(
                      detail.aiUsage.totalMilliCredit,
                    )} Credits`}
                  />
                ) : null}
                <InfoRow
                  label="日志保留期"
                  value={`${detail.logRetentionDays} 天`}
                />
              </View>
            </View>

            {detail.configSummary ? (
              <View style={[styles.card, { backgroundColor: palette.bgCard }]}>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  流水线配置摘要
                </Text>
                <View style={[styles.kvGrid, { borderTopColor: palette.separator }]}>
                  {detail.configSummary.image ? (
                    <InfoRow label="配置镜像" value={detail.configSummary.image} mono />
                  ) : null}
                  {detail.configSummary.stages.length > 0 ? (
                    <InfoRow
                      label="定义阶段"
                      value={detail.configSummary.stages.join('、')}
                    />
                  ) : null}
                  <InfoRow
                    label="env 键名"
                    value={
                      detail.configSummary.envKeys.length > 0
                        ? `${detail.configSummary.envKeys.join(', ')}（值已省略）`
                        : '无'
                    }
                  />
                </View>
              </View>
            ) : null}

            <View
              style={[
                styles.card,
                { backgroundColor: palette.bgCard },
                detail.stages.length > 0 && styles.stagesCard,
              ]}
            >
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  阶段执行与原始日志
                </Text>
                <Text style={[styles.sectionHint, { color: palette.textSecondary }]}>
                  共 {detail.stages.length} 个阶段（点击展开）
                </Text>
              </View>

              {detail.stages.length === 0 ? (
                <Text style={[styles.emptyStageNote, { color: palette.textSecondary }]}>
                  暂无阶段明细
                </Text>
              ) : (
                <View style={[styles.stageList, { borderTopColor: palette.separator }]}>
                  {detail.stages.map((stage, index) => {
                    const stageBadge = getBuildStatusMeta(stage.status, palette);
                    const isExpanded = expandedStageIds.has(stage.id);
                    const stageState = stageLogs[stage.id];
                    const stageOutput = stageState?.data
                      ? buildDisplayedStageLines(stageState.data.lines, stageState.showFull)
                      : null;

                    return (
                      <View
                        key={stage.id}
                        style={
                          index > 0
                            ? {
                                borderTopWidth: StyleSheet.hairlineWidth,
                                borderTopColor: palette.separator,
                              }
                            : undefined
                        }
                      >
                        <Pressable
                          onPress={() => handleToggleStage(stage)}
                          accessibilityRole="button"
                          style={({ pressed }) => [
                            styles.stageHeader,
                            { opacity: pressed ? 0.65 : 1 },
                          ]}
                        >
                          <View style={styles.stageLeft}>
                            <Text style={[styles.stageName, { color: palette.textPrimary }]}>
                              {stage.name}
                            </Text>
                            <View
                              style={[
                                styles.miniBadge,
                                { backgroundColor: stageBadge.bgColor },
                              ]}
                            >
                              <Text style={[styles.miniBadgeText, { color: stageBadge.color }]}>
                                {stageBadge.label}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.stageRight}>
                            <Text style={[styles.stageDuration, { color: palette.textSecondary }]}>
                              {formatDurationMs(stage.durationMs)}
                            </Text>
                            <SymbolView
                              name={isExpanded ? 'chevron.down' : 'chevron.right'}
                              size={12}
                              weight="semibold"
                              tintColor={palette.textTertiary}
                            />
                          </View>
                        </Pressable>

                        {isExpanded ? (
                          <View style={styles.stageBody}>
                            {stageState?.loading ? (
                              <View style={styles.stageLoading}>
                                <ActivityIndicator size="small" color={palette.themeAccent} />
                                <Text style={[styles.stageNote, { color: palette.textSecondary }]}>
                                  正在加载阶段输出...
                                </Text>
                              </View>
                            ) : stageState?.error ? (
                              <View
                                style={[
                                  styles.stageErrorBox,
                                  {
                                    backgroundColor: palette.dangerBannerBg,
                                    borderColor: palette.dangerBannerBorder,
                                  },
                                ]}
                              >
                                <Text style={[styles.stageErrorText, { color: palette.accentRed }]}>
                                  {stageState.error}
                                </Text>
                                <Pressable onPress={() => void loadStageLog(stage)}>
                                  <Text
                                    style={[styles.retryLink, { color: palette.themeAccent }]}
                                  >
                                    重新加载
                                  </Text>
                                </Pressable>
                              </View>
                            ) : stageState?.data ? (
                              <>
                                {stageState.data.error ? (
                                  <Text
                                    style={[styles.stageErrorInline, { color: palette.accentRed }]}
                                  >
                                    错误：{stageState.data.error}
                                  </Text>
                                ) : null}

                                {stageState.data.lines.length === 0 ? (
                                  <Text
                                    style={[styles.stageNote, { color: palette.textSecondary }]}
                                  >
                                    无输出日志
                                  </Text>
                                ) : (
                                  <>
                                    <View style={styles.stageToolbar}>
                                      <Text
                                        style={[
                                          styles.stageLineCount,
                                          { color: palette.textSecondary },
                                        ]}
                                      >
                                        共 {stageState.data.lines.length} 行
                                      </Text>
                                      <View style={styles.stageActionsRow}>
                                        {stageOutput && stageOutput.omittedCount > 0 ? (
                                          <Pressable
                                            onPress={() => handleToggleFullStage(stage.id)}
                                            hitSlop={6}
                                          >
                                            <Text
                                              style={[
                                                styles.stageActionText,
                                                { color: palette.themeAccent },
                                              ]}
                                            >
                                              展开全部
                                            </Text>
                                          </Pressable>
                                        ) : stageState.data.lines.length > STAGE_COLLAPSE_THRESHOLD ? (
                                          <Pressable
                                            onPress={() => handleToggleFullStage(stage.id)}
                                            hitSlop={6}
                                          >
                                            <Text
                                              style={[
                                                styles.stageActionText,
                                                { color: palette.themeAccent },
                                              ]}
                                            >
                                              收起摘要
                                            </Text>
                                          </Pressable>
                                        ) : null}

                                        <Pressable
                                          onPress={() => void handleCopyStageLog(stageState.data!)}
                                          hitSlop={6}
                                        >
                                          <Text
                                            style={[
                                              styles.stageActionText,
                                              { color: palette.themeAccent },
                                            ]}
                                          >
                                            复制本阶段
                                          </Text>
                                        </Pressable>
                                      </View>
                                    </View>

                                    <ScrollView
                                      horizontal
                                      style={[
                                        styles.terminalBox,
                                        { backgroundColor: palette.bgSecondaryFill },
                                      ]}
                                      contentContainerStyle={styles.terminalContent}
                                    >
                                      <View style={styles.terminalColumn}>
                                        {(stageOutput?.chunks ?? []).map((chunk, chunkIndex) => (
                                          <Text
                                            key={`${stage.id}-chunk-${chunkIndex}`}
                                            selectable
                                            style={[
                                              styles.terminalText,
                                              { color: palette.textPrimary },
                                            ]}
                                          >
                                            {chunk}
                                          </Text>
                                        ))}
                                      </View>
                                    </ScrollView>
                                  </>
                                )}
                              </>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>

      {toastText ? (
        <View
          style={[
            styles.toast,
            {
              bottom: insets.bottom + 18,
              backgroundColor: palette.isDark ? '#2C2C2E' : '#1C1C1E',
            },
          ]}
        >
          <Text style={styles.toastText}>{toastText}</Text>
        </View>
      ) : null}
    </View>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function InfoRow({ label, value, mono = false }: InfoRowProps) {
  const palette = useIos18Palette();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: palette.textSecondary }]}>{label}</Text>
      <Text
        selectable
        style={[
          styles.infoValue,
          { color: palette.textPrimary },
          mono && styles.monoFont,
        ]}
      >
        {value}
      </Text>
    </View>
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
  centeredLoader: {
    paddingVertical: 56,
    alignItems: 'center',
    gap: 12,
  },
  loadingLabel: {
    fontSize: 14,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  stagesCard: {
    paddingBottom: 4,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleCol: {
    flex: 1,
    gap: 3,
  },
  repoTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  snMono: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  kvGrid: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 9,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoLabel: {
    fontSize: 13,
    width: 82,
  },
  infoValue: {
    flex: 1,
    fontSize: 13,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  monoFont: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  sectionHint: {
    fontSize: 12,
  },
  emptyStageNote: {
    fontSize: 13,
    paddingVertical: 8,
  },
  stageList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 10,
  },
  stageLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  stageName: {
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  miniBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  miniBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  stageRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stageDuration: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  stageBody: {
    paddingBottom: 12,
    gap: 8,
  },
  stageLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  stageNote: {
    fontSize: 13,
  },
  stageErrorBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  stageErrorText: {
    flex: 1,
    fontSize: 12,
  },
  retryLink: {
    fontSize: 12,
    fontWeight: '600',
  },
  stageErrorInline: {
    fontSize: 12,
  },
  stageToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stageLineCount: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  stageActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  stageActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  terminalBox: {
    borderRadius: 10,
  },
  terminalContent: {
    padding: 10,
  },
  terminalColumn: {
    flexDirection: 'column',
  },
  terminalText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
});
