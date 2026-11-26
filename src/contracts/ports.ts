/**
 * Port interfaces enforcing strict dependency inversion between services.
 * Storage and Parser only depend on these contracts and never import Exchange or UI.
 */

import type {
  AccountEditorPayload,
  AccountView,
  AppSettings,
  BatchSyncSummary,
  CreateAccountInput,
  LogEntry,
  LogLevel,
  LogQueryFilter,
  LogUpdateInput,
  OverviewSummary,
  UpdateAccountInput,
  UsageSnapshot,
  UserUsageEntry,
  WorkspaceBuildLogDetail,
  WorkspaceBuildLogQueryInput,
  WorkspaceLifecycleStatus,
  WorkspaceListSnapshot,
  WorkspaceStageLog,
  WorkspaceStageLogQueryInput,
  WorkspaceSyncInput,
} from './domain';
import type {
  ServiceResult,
  StorageClearTableData,
  StorageKeyInput,
  StorageReadData,
  StorageRemoveData,
  StorageSaveData,
  StorageSaveInput,
  StorageTableRecord,
} from './results';

export interface LogReporter {
  verbose(action: string, message: string, details?: string): void;
  info(action: string, message: string, details?: string): void;
  warn(action: string, message: string, details?: string): void;
  error(action: string, message: string, details?: string): void;
}

export interface StoragePort {
  save(input: StorageSaveInput): Promise<ServiceResult<StorageSaveData>>;
  read<T = unknown>(input: StorageKeyInput): Promise<ServiceResult<StorageReadData<T>>>;
  remove(input: StorageKeyInput): Promise<ServiceResult<StorageRemoveData>>;
  readTable<T = unknown>(input: { table: string }): Promise<ServiceResult<StorageTableRecord<T>[]>>;
  clearTable(input: { table: string }): Promise<ServiceResult<StorageClearTableData>>;
}

export interface ParserInput {
  username: string;
  cookie: string;
}

export interface ParserPort {
  parseUsage(input: ParserInput): Promise<ServiceResult<UsageSnapshot>>;
}

export interface WorkspaceListInput {
  username: string;
  cookie: string;
  page?: number;
  pageSize?: number;
  status?: WorkspaceLifecycleStatus | '';
  slug?: string;
  branch?: string;
}

export interface WorkspaceBuildLogInput {
  username: string;
  cookie: string;
  slug: string;
  sn: string;
  includeConfig?: boolean;
}

export interface WorkspaceStageLogInput {
  username: string;
  cookie: string;
  slug: string;
  sn: string;
  pipelineId: string;
  stageId: string;
  status?: string;
}

export interface WorkspaceParserPort {
  parseWorkspaceList(input: WorkspaceListInput): Promise<ServiceResult<WorkspaceListSnapshot>>;
  parseWorkspaceBuildLog(
    input: WorkspaceBuildLogInput,
  ): Promise<ServiceResult<WorkspaceBuildLogDetail>>;
  parseWorkspaceStageLog(input: WorkspaceStageLogInput): Promise<ServiceResult<WorkspaceStageLog>>;
}

export interface ExchangeUiState {
  initialized: boolean;
  isSyncing: boolean;
  syncingUsernames: string[];
  accounts: AccountView[];
  overview: OverviewSummary;
  usageList: UserUsageEntry[];
  settings: AppSettings;
  lastSyncSummary: BatchSyncSummary | null;
}

export interface ExchangePort {
  initialize(): Promise<ServiceResult<ExchangeUiState>>;
  shutdown(): void;
  getStateSnapshot(): ExchangeUiState;
  subscribe(listener: (state: ExchangeUiState) => void): () => void;

  listAccounts(): Promise<ServiceResult<AccountView[]>>;
  getAccountForEdit(username: string): Promise<ServiceResult<AccountEditorPayload>>;
  createAccount(input: CreateAccountInput): Promise<ServiceResult<AccountView>>;
  updateAccount(input: UpdateAccountInput): Promise<ServiceResult<AccountView>>;
  deleteAccount(username: string): Promise<ServiceResult<{ deleted: boolean }>>;

  syncAccountUsage(username: string): Promise<ServiceResult<UsageSnapshot>>;
  syncAllAccountsUsage(reason?: 'manual' | 'launch' | 'foreground' | 'interval'): Promise<ServiceResult<BatchSyncSummary>>;

  getOverviewSummary(): Promise<ServiceResult<OverviewSummary>>;
  getAllUsageSnapshots(): Promise<ServiceResult<UserUsageEntry[]>>;

  getSettings(): Promise<ServiceResult<AppSettings>>;
  updateSettings(patch: Partial<AppSettings>): Promise<ServiceResult<AppSettings>>;
  clearCacheAndLogs(): Promise<ServiceResult<{ clearedCacheCount: number; clearedLogCount: number }>>;

  reportUiLog(level: LogLevel, action: string, message: string, details?: string): void;
  queryLogs(filter?: LogQueryFilter): Promise<ServiceResult<LogEntry[]>>;
  updateLog(input: LogUpdateInput): Promise<ServiceResult<LogEntry>>;
  deleteLogs(ids: string[]): Promise<ServiceResult<{ deletedCount: number }>>;
  clearLogs(): Promise<ServiceResult<{ clearedCount: number }>>;
  subscribeLogs(listener: () => void): () => void;

  getCachedWorkspaces(username: string): Promise<ServiceResult<WorkspaceListSnapshot | null>>;
  syncAccountWorkspaces(input: WorkspaceSyncInput): Promise<ServiceResult<WorkspaceListSnapshot>>;
  getWorkspaceBuildLog(
    input: WorkspaceBuildLogQueryInput,
  ): Promise<ServiceResult<WorkspaceBuildLogDetail>>;
  getWorkspaceStageLog(
    input: WorkspaceStageLogQueryInput,
  ): Promise<ServiceResult<WorkspaceStageLog>>;
}
