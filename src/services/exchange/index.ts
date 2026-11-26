/**
 * Public facade for the Update Exchange Service.
 * Instantiates isolated Storage, Parser, Workspace Parser, and Log subsystems
 * and exposes ExchangePort to UI.
 */

import type {
  AccountEditorPayload,
  AccountView,
  AppSettings,
  BatchSyncSummary,
  CreateAccountInput,
  ExchangePort,
  ExchangeUiState,
  LogEntry,
  LogLevel,
  LogQueryFilter,
  LogUpdateInput,
  OverviewSummary,
  ServiceResult,
  UpdateAccountInput,
  UsageSnapshot,
  UserUsageEntry,
  WorkspaceBuildLogDetail,
  WorkspaceBuildLogQueryInput,
  WorkspaceListSnapshot,
  WorkspaceStageLog,
  WorkspaceStageLogQueryInput,
  WorkspaceSyncInput,
} from '@/contracts';
import { createParserService } from '@/services/parser';
import { createStorageService } from '@/services/storage';
import { createWorkspaceParserService } from '@/services/workspace-parser';
import { LogSubsystem } from './logger';
import { RefreshScheduler } from './scheduler';
import { ExchangeCoordinator } from './transactions';
import { DEFAULT_APP_SETTINGS } from './validator';

const logSubsystem = new LogSubsystem();
const storageService = createStorageService(logSubsystem.createReporter('Storage'));
const parserService = createParserService(logSubsystem.createReporter('Parser'));
const workspaceParserService = createWorkspaceParserService(
  logSubsystem.createReporter('WorkspaceParser'),
);
const coordinator = new ExchangeCoordinator(
  storageService,
  parserService,
  workspaceParserService,
  logSubsystem,
);
const uiLogger = logSubsystem.createReporter('UI');
const schedulerLogger = logSubsystem.createReporter('Exchange');

const scheduler = new RefreshScheduler(
  DEFAULT_APP_SETTINGS,
  schedulerLogger,
  async (reason) => {
    const snapshot = coordinator.getStateSnapshot();
    if (snapshot.accounts.length === 0) {
      return;
    }
    await coordinator.syncAllAccountsUsage(reason);
  },
);

coordinator.setSettingsChangeHandler((nextSettings) => {
  scheduler.updateSettings(nextSettings);
});

export const exchangeService: ExchangePort = {
  async initialize(): Promise<ServiceResult<ExchangeUiState>> {
    const res = await coordinator.initialize();
    if (res.ok) {
      scheduler.updateSettings(res.data.settings);
      scheduler.start();
    }
    return res;
  },

  shutdown(): void {
    scheduler.stop();
  },

  getStateSnapshot(): ExchangeUiState {
    return coordinator.getStateSnapshot();
  },

  subscribe(listener: (state: ExchangeUiState) => void): () => void {
    return coordinator.subscribe(listener);
  },

  listAccounts(): Promise<ServiceResult<AccountView[]>> {
    return coordinator.listAccounts();
  },

  getAccountForEdit(username: string): Promise<ServiceResult<AccountEditorPayload>> {
    return coordinator.getAccountForEdit(username);
  },

  createAccount(input: CreateAccountInput): Promise<ServiceResult<AccountView>> {
    return coordinator.createAccount(input);
  },

  updateAccount(input: UpdateAccountInput): Promise<ServiceResult<AccountView>> {
    return coordinator.updateAccount(input);
  },

  deleteAccount(username: string): Promise<ServiceResult<{ deleted: boolean }>> {
    return coordinator.deleteAccount(username);
  },

  syncAccountUsage(username: string): Promise<ServiceResult<UsageSnapshot>> {
    return coordinator.syncAccountUsage(username);
  },

  syncAllAccountsUsage(
    reason: 'manual' | 'launch' | 'foreground' | 'interval' = 'manual',
  ): Promise<ServiceResult<BatchSyncSummary>> {
    return coordinator.syncAllAccountsUsage(reason);
  },

  getOverviewSummary(): Promise<ServiceResult<OverviewSummary>> {
    return coordinator.getOverviewSummary();
  },

  getAllUsageSnapshots(): Promise<ServiceResult<UserUsageEntry[]>> {
    return coordinator.getAllUsageSnapshots();
  },

  getSettings(): Promise<ServiceResult<AppSettings>> {
    return coordinator.getSettings();
  },

  updateSettings(patch: Partial<AppSettings>): Promise<ServiceResult<AppSettings>> {
    return coordinator.updateSettings(patch);
  },

  clearCacheAndLogs(): Promise<
    ServiceResult<{ clearedCacheCount: number; clearedLogCount: number }>
  > {
    return coordinator.clearCacheAndLogs();
  },

  reportUiLog(level: LogLevel, action: string, message: string, details?: string): void {
    switch (level) {
      case 'V':
        uiLogger.verbose(action, message, details);
        break;
      case 'I':
        uiLogger.info(action, message, details);
        break;
      case 'W':
        uiLogger.warn(action, message, details);
        break;
      case 'E':
        uiLogger.error(action, message, details);
        break;
    }
  },

  queryLogs(filter?: LogQueryFilter): Promise<ServiceResult<LogEntry[]>> {
    return logSubsystem.queryLogs(filter);
  },

  updateLog(input: LogUpdateInput): Promise<ServiceResult<LogEntry>> {
    return logSubsystem.updateLog(input);
  },

  deleteLogs(ids: string[]): Promise<ServiceResult<{ deletedCount: number }>> {
    return logSubsystem.deleteLogs(ids);
  },

  clearLogs(): Promise<ServiceResult<{ clearedCount: number }>> {
    return logSubsystem.clearLogs();
  },

  subscribeLogs(listener: () => void): () => void {
    return logSubsystem.subscribe(listener);
  },

  getCachedWorkspaces(username: string): Promise<ServiceResult<WorkspaceListSnapshot | null>> {
    return coordinator.getCachedWorkspaces(username);
  },

  syncAccountWorkspaces(input: WorkspaceSyncInput): Promise<ServiceResult<WorkspaceListSnapshot>> {
    return coordinator.syncAccountWorkspaces(input);
  },

  getWorkspaceBuildLog(
    input: WorkspaceBuildLogQueryInput,
  ): Promise<ServiceResult<WorkspaceBuildLogDetail>> {
    return coordinator.getWorkspaceBuildLog(input);
  },

  getWorkspaceStageLog(
    input: WorkspaceStageLogQueryInput,
  ): Promise<ServiceResult<WorkspaceStageLog>> {
    return coordinator.getWorkspaceStageLog(input);
  },
};
