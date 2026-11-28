/**
 * Transaction coordinator for the Update Exchange Service.
 * Mediates all workflows across UI, Information Storage, Usage Parser,
 * Workspace Parser, and Log Subsystem.
 */

import type {
  AccountBackupEntry,
  AccountBackupFile,
  AccountEditorPayload,
  AccountImportFailure,
  AccountImportSummary,
  AccountProfile,
  AccountSecret,
  AccountView,
  AppSettings,
  BatchSyncSummary,
  CreateAccountInput,
  ErrorCode,
  ExchangeUiState,
  LogReporter,
  MetricAggregateSummary,
  MetricQuotaGroup,
  OverviewSummary,
  ParserPort,
  QuotaMetricKey,
  QuotaUnit,
  ServiceResult,
  StoragePort,
  UpdateAccountInput,
  UsageSnapshot,
  UserUsageEntry,
  WorkspaceBuildLogDetail,
  WorkspaceBuildLogQueryInput,
  WorkspaceListSnapshot,
  WorkspaceParserPort,
  WorkspaceStageLog,
  WorkspaceStageLogQueryInput,
  WorkspaceSyncInput,
} from '@/contracts';
import Constants from 'expo-constants';
import { createBackupFile, parseBackupFile } from './backup';
import type { LogSubsystem } from './logger';
import {
  DEFAULT_APP_SETTINGS,
  isAccountStale,
  maskCookie,
  sanitizeSettings,
  validateCreateAccount,
  validateUpdateAccount,
  validateUsageSnapshot,
  validateWorkspaceBuildLogQuery,
  validateWorkspaceListSnapshot,
  validateWorkspaceStageLogQuery,
  validateWorkspaceSyncInput,
} from './validator';

const TABLE_ACCOUNTS = 'accounts';
const TABLE_SECRETS = 'accounts_secrets';
const TABLE_USAGE_CACHE = 'usage_cache';
const TABLE_WORKSPACE_CACHE = 'workspace_cache';
const TABLE_SETTINGS = 'settings';
const KEY_APP_SETTINGS = 'app_settings';

function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data, timestamp: Date.now() };
}

function fail<T>(code: ErrorCode, message: string, cause?: string): ServiceResult<T> {
  return {
    ok: false,
    error: { code, message, cause },
    timestamp: Date.now(),
  };
}

function createEmptyMetricSummary(
  metric: QuotaMetricKey,
  label: string,
  unit: QuotaUnit,
): MetricAggregateSummary {
  return {
    metric,
    label,
    unit,
    total: 0,
    used: 0,
    locked: 0,
    remaining: 0,
    percentage: 0,
    packageCount: 0,
  };
}

function createEmptyOverview(): OverviewSummary {
  return {
    accountCount: 0,
    staleUsernames: [],
    hasStaleAccounts: false,
    lastUpdatedAt: null,
    metrics: [
      createEmptyMetricSummary('ai_credits', 'AI Credits', 'Credits'),
      createEmptyMetricSummary('build_cpu', '云原生构建-CPU', '核时'),
      createEmptyMetricSummary('dev_cpu', '云原生开发-CPU', '核时'),
    ],
  };
}

function roundDisplayMetric(value: number, unit: QuotaUnit): number {
  const decimals = unit === 'Credits' ? 0 : 1;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function accumulateGroup(target: MetricAggregateSummary, group: MetricQuotaGroup): void {
  for (const pkg of group.packages) {
    const locked = pkg.locked ?? 0;
    const pkgRemaining = Math.max(0, pkg.total - pkg.used - locked);
    target.total += pkg.total;
    target.used += pkg.used;
    target.locked += locked;
    target.remaining += pkgRemaining;
    target.packageCount += 1;
  }
}

function finalizeMetricSummary(summary: MetricAggregateSummary): MetricAggregateSummary {
  const total = roundDisplayMetric(summary.total, summary.unit);
  const used = roundDisplayMetric(summary.used, summary.unit);
  const locked = roundDisplayMetric(summary.locked, summary.unit);
  const remaining = roundDisplayMetric(summary.remaining, summary.unit);
  const percentage =
    total > 0 ? Math.min(100, Math.round(((used + locked) / total) * 1000) / 10) : 0;

  return {
    ...summary,
    total,
    used,
    locked,
    remaining,
    percentage,
  };
}

export class ExchangeCoordinator {
  private readonly storage: StoragePort;
  private readonly parser: ParserPort;
  private readonly workspaceParser: WorkspaceParserPort;
  private readonly logSubsystem: LogSubsystem;
  private readonly logger: LogReporter;
  private readonly listeners = new Set<(state: ExchangeUiState) => void>();

  private state: ExchangeUiState = {
    initialized: false,
    isSyncing: false,
    syncingUsernames: [],
    accounts: [],
    overview: createEmptyOverview(),
    usageList: [],
    settings: { ...DEFAULT_APP_SETTINGS },
    lastSyncSummary: null,
  };

  private initPromise: Promise<ServiceResult<ExchangeUiState>> | null = null;
  private activeBatchSyncPromise: Promise<ServiceResult<BatchSyncSummary>> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private onSettingsChanged?: (settings: AppSettings) => void;

  constructor(
    storage: StoragePort,
    parser: ParserPort,
    workspaceParser: WorkspaceParserPort,
    logSubsystem: LogSubsystem,
  ) {
    this.storage = storage;
    this.parser = parser;
    this.workspaceParser = workspaceParser;
    this.logSubsystem = logSubsystem;
    this.logger = logSubsystem.createReporter('Exchange');
  }

  setSettingsChangeHandler(handler: (settings: AppSettings) => void): void {
    this.onSettingsChanged = handler;
  }

  // Serializes storage mutations so backup imports cannot race with usage syncs.
  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(async () => {
      try {
        return await task();
      } finally {
        release();
      }
    });
  }

  getStateSnapshot(): ExchangeUiState {
    return this.state;
  }

  subscribe(listener: (state: ExchangeUiState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async initialize(): Promise<ServiceResult<ExchangeUiState>> {
    if (this.state.initialized) {
      return ok(this.state);
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      this.logger.info('exchange.initialize', 'Initializing Update Exchange Service');
      const settingsRes = await this.loadSettingsFromStorage();
      const settings = settingsRes.ok ? settingsRes.data : { ...DEFAULT_APP_SETTINGS };

      await this.rebuildStateSnapshot({ settings, initialized: true });
      this.onSettingsChanged?.(settings);

      this.logger.info(
        'exchange.initialize',
        `Exchange initialized (${this.state.accounts.length} account(s))`,
      );
      return ok(this.state);
    })().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  async listAccounts(): Promise<ServiceResult<AccountView[]>> {
    await this.rebuildStateSnapshot();
    return ok(this.state.accounts);
  }

  async getAccountForEdit(username: string): Promise<ServiceResult<AccountEditorPayload>> {
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      return fail('VALIDATION_ERROR', '用户名不能为空');
    }

    this.logger.verbose('exchange.getAccountForEdit', `Loading account details for "${cleanUsername}"`);
    const profileRes = await this.storage.read<AccountProfile>({
      table: TABLE_ACCOUNTS,
      key: cleanUsername,
    });
    if (!profileRes.ok) {
      return fail('STORAGE_ERROR', profileRes.error.message, profileRes.error.cause);
    }
    if (!profileRes.data.exists || !profileRes.data.value) {
      return fail('NOT_FOUND', `未找到账户 "${cleanUsername}"`);
    }

    const secretRes = await this.storage.read<AccountSecret>({
      table: TABLE_SECRETS,
      key: cleanUsername,
    });
    if (!secretRes.ok) {
      return fail('STORAGE_ERROR', secretRes.error.message, secretRes.error.cause);
    }

    const profile = profileRes.data.value;
    const cookie = secretRes.data.value?.cookie ?? '';
    return ok({
      username: profile.username,
      cookie,
      remark: profile.remark,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastSyncedAt: profile.lastSyncedAt,
    });
  }

  async createAccount(input: CreateAccountInput): Promise<ServiceResult<AccountView>> {
    const validated = validateCreateAccount(input);
    if (!validated.valid || !validated.value) {
      this.logger.warn('exchange.createAccount', 'Account validation failed', validated.message);
      return fail('VALIDATION_ERROR', validated.message ?? 'Invalid account input');
    }

    const { username, cookie, remark } = validated.value;
    this.logger.verbose('exchange.createAccount', `Creating account "${username}"`);

    const existingRes = await this.storage.read<AccountProfile>({
      table: TABLE_ACCOUNTS,
      key: username,
    });
    if (!existingRes.ok) {
      return fail('STORAGE_ERROR', existingRes.error.message, existingRes.error.cause);
    }
    if (existingRes.data.exists) {
      this.logger.warn('exchange.createAccount', `Duplicate username rejected: "${username}"`);
      return fail('ALREADY_EXISTS', `账户 "${username}" 已存在，请勿重复添加`);
    }

    const now = Date.now();
    const profile: AccountProfile = {
      username,
      remark,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
    };
    const secret: AccountSecret = {
      cookie,
      updatedAt: now,
    };

    const secretSaveRes = await this.storage.save({
      table: TABLE_SECRETS,
      key: username,
      value: secret,
    });
    if (!secretSaveRes.ok) {
      return fail('STORAGE_ERROR', secretSaveRes.error.message, secretSaveRes.error.cause);
    }

    const profileSaveRes = await this.storage.save({
      table: TABLE_ACCOUNTS,
      key: username,
      value: profile,
    });
    if (!profileSaveRes.ok) {
      // Roll back orphaned secret if profile save fails.
      await this.storage.remove({ table: TABLE_SECRETS, key: username });
      return fail('STORAGE_ERROR', profileSaveRes.error.message, profileSaveRes.error.cause);
    }

    await this.rebuildStateSnapshot();
    this.logger.info('exchange.createAccount', `Created account "${username}"`);

    const createdView = this.state.accounts.find((acc) => acc.username === username);
    if (!createdView) {
      return fail('EXCHANGE_ERROR', 'Account saved but missing from rebuilt view');
    }
    return ok(createdView);
  }

  async updateAccount(input: UpdateAccountInput): Promise<ServiceResult<AccountView>> {
    const validated = validateUpdateAccount(input);
    if (!validated.valid || !validated.value) {
      this.logger.warn('exchange.updateAccount', 'Account update validation failed', validated.message);
      return fail('VALIDATION_ERROR', validated.message ?? 'Invalid account update input');
    }

    const { username, cookie, remark } = validated.value;
    this.logger.verbose('exchange.updateAccount', `Updating account "${username}"`);

    const existingRes = await this.storage.read<AccountProfile>({
      table: TABLE_ACCOUNTS,
      key: username,
    });
    if (!existingRes.ok) {
      return fail('STORAGE_ERROR', existingRes.error.message, existingRes.error.cause);
    }
    if (!existingRes.data.exists || !existingRes.data.value) {
      return fail('NOT_FOUND', `账户 "${username}" 不存在，无法修改`);
    }

    const now = Date.now();
    const nextProfile: AccountProfile = {
      ...existingRes.data.value,
      remark,
      updatedAt: now,
    };

    const secretSaveRes = await this.storage.save({
      table: TABLE_SECRETS,
      key: username,
      value: { cookie, updatedAt: now } satisfies AccountSecret,
    });
    if (!secretSaveRes.ok) {
      return fail('STORAGE_ERROR', secretSaveRes.error.message, secretSaveRes.error.cause);
    }

    const profileSaveRes = await this.storage.save({
      table: TABLE_ACCOUNTS,
      key: username,
      value: nextProfile,
    });
    if (!profileSaveRes.ok) {
      return fail('STORAGE_ERROR', profileSaveRes.error.message, profileSaveRes.error.cause);
    }

    await this.rebuildStateSnapshot();
    this.logger.info('exchange.updateAccount', `Updated cookie/remark for "${username}"`);

    const updatedView = this.state.accounts.find((acc) => acc.username === username);
    if (!updatedView) {
      return fail('EXCHANGE_ERROR', 'Account updated but missing from rebuilt view');
    }
    return ok(updatedView);
  }

  async deleteAccount(username: string): Promise<ServiceResult<{ deleted: boolean }>> {
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      return fail('VALIDATION_ERROR', '用户名不能为空');
    }

    this.logger.verbose('exchange.deleteAccount', `Deleting account "${cleanUsername}"`);

    const [profileRemove, secretRemove, usageCacheRemove, workspaceCacheRemove] = await Promise.all([
      this.storage.remove({ table: TABLE_ACCOUNTS, key: cleanUsername }),
      this.storage.remove({ table: TABLE_SECRETS, key: cleanUsername }),
      this.storage.remove({ table: TABLE_USAGE_CACHE, key: cleanUsername }),
      this.storage.remove({ table: TABLE_WORKSPACE_CACHE, key: cleanUsername }),
    ]);

    if (
      !profileRemove.ok ||
      !secretRemove.ok ||
      !usageCacheRemove.ok ||
      !workspaceCacheRemove.ok
    ) {
      const msg =
        (!profileRemove.ok && profileRemove.error.message) ||
        (!secretRemove.ok && secretRemove.error.message) ||
        (!usageCacheRemove.ok && usageCacheRemove.error.message) ||
        (!workspaceCacheRemove.ok && workspaceCacheRemove.error.message) ||
        'Failed to remove account records';
      this.logger.error('exchange.deleteAccount', `Partial failure deleting "${cleanUsername}"`, msg);
      return fail('STORAGE_ERROR', msg);
    }

    await this.rebuildStateSnapshot();
    this.logger.info('exchange.deleteAccount', `Deleted account "${cleanUsername}" and its cached data`);
    return ok({ deleted: profileRemove.data.deleted });
  }

  exportAccounts(): Promise<ServiceResult<AccountBackupFile>> {
    return this.runSerialized(() => this.exportAccountsInternal());
  }

  private async exportAccountsInternal(): Promise<ServiceResult<AccountBackupFile>> {
    this.logger.verbose('exchange.exportAccounts', 'Exporting account backup');
    try {
      const [profilesRes, secretsRes] = await Promise.all([
        this.storage.readTable<AccountProfile>({ table: TABLE_ACCOUNTS }),
        this.storage.readTable<AccountSecret>({ table: TABLE_SECRETS }),
      ]);
      if (!profilesRes.ok) {
        return fail('STORAGE_ERROR', profilesRes.error.message, profilesRes.error.cause);
      }
      if (!secretsRes.ok) {
        return fail('STORAGE_ERROR', secretsRes.error.message, secretsRes.error.cause);
      }

      const secretMap = new Map<string, AccountSecret>();
      for (const record of secretsRes.data) {
        secretMap.set(record.key, record.value);
      }

      const entries: AccountBackupEntry[] = profilesRes.data
        .map((record) => record.value)
        .filter((profile) => profile.username.trim().length > 0)
        .map((profile) => ({
          username: profile.username,
          cookie: secretMap.get(profile.username)?.cookie ?? '',
          remark: profile.remark,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          lastSyncedAt: profile.lastSyncedAt,
        }));

      const appVersion = Constants.expoConfig?.version ?? '1.0.3';
      const file = createBackupFile(entries, appVersion, Date.now());

      this.logger.info(
        'exchange.exportAccounts',
        `Exported ${entries.length} account(s) to backup payload`,
      );
      return ok(file);
    } catch (err) {
      this.logger.error('exchange.exportAccounts', 'Failed to export account backup', String(err));
      return fail('EXCHANGE_ERROR', '导出账户数据失败', err instanceof Error ? err.message : String(err));
    }
  }

  importAccounts(rawJson: string): Promise<ServiceResult<AccountImportSummary>> {
    return this.runSerialized(() => this.importAccountsInternal(rawJson));
  }

  private async importAccountsInternal(rawJson: string): Promise<ServiceResult<AccountImportSummary>> {
    this.logger.verbose('exchange.importAccounts', 'Importing account backup');
    const parsed = parseBackupFile(rawJson);
    if (!parsed.valid || !parsed.value) {
      this.logger.warn('exchange.importAccounts', 'Backup validation failed', parsed.message);
      return fail('VALIDATION_ERROR', parsed.message ?? '备份文件格式无效');
    }

    const entries = parsed.value.accounts;
    const summary: AccountImportSummary = {
      total: entries.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: [],
    };

    // Capture existing profiles and secrets as a rollback baseline for overwritten accounts.
    const [profilesRes, secretsRes] = await Promise.all([
      this.storage.readTable<AccountProfile>({ table: TABLE_ACCOUNTS }),
      this.storage.readTable<AccountSecret>({ table: TABLE_SECRETS }),
    ]);
    if (!profilesRes.ok) {
      return fail('STORAGE_ERROR', profilesRes.error.message, profilesRes.error.cause);
    }
    if (!secretsRes.ok) {
      return fail('STORAGE_ERROR', secretsRes.error.message, secretsRes.error.cause);
    }

    const profileMap = new Map<string, AccountProfile>();
    for (const record of profilesRes.data) {
      profileMap.set(record.key, record.value);
    }
    const secretMap = new Map<string, AccountSecret>();
    for (const record of secretsRes.data) {
      secretMap.set(record.key, record.value);
    }

    type AppliedWrite = {
      username: string;
      hadProfile: boolean;
      hadSecret: boolean;
      previousProfile: AccountProfile | null;
      previousSecret: AccountSecret | null;
    };
    const applied: AppliedWrite[] = [];

    try {
      const now = Date.now();
      for (const entry of entries) {
        const existingProfile = profileMap.get(entry.username) ?? null;
        const previousSecret = secretMap.get(entry.username) ?? null;
        const hadProfile = existingProfile !== null;
        const hadSecret = previousSecret !== null;

        try {
          const secretSaveRes = await this.storage.save({
            table: TABLE_SECRETS,
            key: entry.username,
            value: { cookie: entry.cookie, updatedAt: now } satisfies AccountSecret,
          });
          if (!secretSaveRes.ok) {
            throw new Error(secretSaveRes.error.message);
          }

          const nextProfile: AccountProfile = {
            username: entry.username,
            remark: entry.remark,
            createdAt: hadProfile ? existingProfile!.createdAt : entry.createdAt,
            updatedAt: now,
            lastSyncedAt: null,
          };
          const profileSaveRes = await this.storage.save({
            table: TABLE_ACCOUNTS,
            key: entry.username,
            value: nextProfile,
          });
          if (!profileSaveRes.ok) {
            throw new Error(profileSaveRes.error.message);
          }

          const cacheRemoveRes = await Promise.all([
            this.storage.remove({ table: TABLE_USAGE_CACHE, key: entry.username }),
            this.storage.remove({ table: TABLE_WORKSPACE_CACHE, key: entry.username }),
          ]);
          if (cacheRemoveRes.some((res) => !res.ok)) {
            throw new Error('Failed to clear cached data for imported account');
          }

          applied.push({
            username: entry.username,
            hadProfile,
            hadSecret,
            previousProfile: existingProfile,
            previousSecret,
          });
          if (hadProfile) {
            summary.updated += 1;
          } else {
            summary.created += 1;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const failure: AccountImportFailure = { username: entry.username, message };
          summary.failed.push(failure);
          this.logger.error(
            'exchange.importAccounts',
            `Failed to import account "${entry.username}"`,
            message,
          );
        }
      }

      // Roll back every applied write when any account failed, keeping the import all-or-nothing.
      if (summary.failed.length > 0) {
        for (const write of applied.reverse()) {
          if (write.hadProfile && write.previousProfile) {
            // Caches were cleared during the import, so keep the restored profile unsynced.
            await this.storage.save({
              table: TABLE_ACCOUNTS,
              key: write.username,
              value: { ...write.previousProfile, lastSyncedAt: null },
            });
          } else {
            await this.storage.remove({ table: TABLE_ACCOUNTS, key: write.username });
          }
          if (write.hadSecret && write.previousSecret) {
            await this.storage.save({
              table: TABLE_SECRETS,
              key: write.username,
              value: write.previousSecret,
            });
          } else {
            await this.storage.remove({ table: TABLE_SECRETS, key: write.username });
          }
        }
        await this.rebuildStateSnapshot();
        return fail(
          'EXCHANGE_ERROR',
          `导入失败：${summary.failed.length} 个账户未成功写入，已回滚全部更改`,
          summary.failed.map((item) => `${item.username}: ${item.message}`).join('; '),
        );
      }

      await this.rebuildStateSnapshot();
      this.logger.info(
        'exchange.importAccounts',
        `Imported ${summary.total} account(s) (created=${summary.created}, updated=${summary.updated})`,
      );
      return ok(summary);
    } catch (err) {
      this.logger.error('exchange.importAccounts', 'Unexpected failure during import', String(err));
      return fail('EXCHANGE_ERROR', '导入账户数据失败', err instanceof Error ? err.message : String(err));
    }
  }

  syncAccountUsage(username: string): Promise<ServiceResult<UsageSnapshot>> {
    return this.runSerialized(() => this.syncAccountUsageInternal(username));
  }

  private async syncAccountUsageInternal(username: string): Promise<ServiceResult<UsageSnapshot>> {
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      return fail('VALIDATION_ERROR', '用户名不能为空');
    }

    this.markSyncingUser(cleanUsername, true);
    try {
      const credRes = await this.resolveAccountCredentials(cleanUsername, 'exchange.syncAccountUsage');
      if (!credRes.ok) {
        return fail(credRes.error.code, credRes.error.message, credRes.error.cause);
      }

      const { profile, cookie } = credRes.data;
      this.logger.verbose('exchange.syncAccountUsage', `Dispatching parser for "${cleanUsername}"`);
      const parseRes = await this.parser.parseUsage({ username: cleanUsername, cookie });
      if (!parseRes.ok) {
        this.logger.error(
          'exchange.syncAccountUsage',
          `Parser failed for "${cleanUsername}"`,
          parseRes.error.message,
        );
        return fail('PARSER_ERROR', parseRes.error.message, parseRes.error.cause);
      }

      const validatedSnapshot = validateUsageSnapshot(parseRes.data);
      if (!validatedSnapshot.valid || !validatedSnapshot.value) {
        this.logger.error(
          'exchange.syncAccountUsage',
          `Invalid parser output for "${cleanUsername}"`,
          validatedSnapshot.message,
        );
        return fail('PARSER_ERROR', validatedSnapshot.message ?? 'Invalid parser output');
      }

      const snapshot = validatedSnapshot.value;
      const cacheSaveRes = await this.storage.save({
        table: TABLE_USAGE_CACHE,
        key: cleanUsername,
        value: snapshot,
      });
      if (!cacheSaveRes.ok) {
        return fail('STORAGE_ERROR', cacheSaveRes.error.message, cacheSaveRes.error.cause);
      }

      const updatedProfile: AccountProfile = {
        ...profile,
        lastSyncedAt: snapshot.fetchedAt,
      };
      const profileSaveRes = await this.storage.save({
        table: TABLE_ACCOUNTS,
        key: cleanUsername,
        value: updatedProfile,
      });
      if (!profileSaveRes.ok) {
        return fail('STORAGE_ERROR', profileSaveRes.error.message, profileSaveRes.error.cause);
      }

      await this.rebuildStateSnapshot();
      this.logger.info('exchange.syncAccountUsage', `Synced usage snapshot for "${cleanUsername}"`);
      return ok(snapshot);
    } finally {
      this.markSyncingUser(cleanUsername, false);
    }
  }

  syncAllAccountsUsage(
    reason: 'manual' | 'launch' | 'foreground' | 'interval' = 'manual',
  ): Promise<ServiceResult<BatchSyncSummary>> {
    return this.runSerialized(() => this.syncAllAccountsUsageInternal(reason));
  }

  private async syncAllAccountsUsageInternal(
    reason: 'manual' | 'launch' | 'foreground' | 'interval' = 'manual',
  ): Promise<ServiceResult<BatchSyncSummary>> {
    if (this.activeBatchSyncPromise) {
      this.logger.verbose(
        'exchange.syncAllAccountsUsage',
        `Coalescing concurrent sync request (${reason}) into active run`,
      );
      return this.activeBatchSyncPromise;
    }

    this.activeBatchSyncPromise = (async () => {
      this.setGlobalSyncing(true);
      try {
        const accountsRes = await this.storage.readTable<AccountProfile>({
          table: TABLE_ACCOUNTS,
        });
        if (!accountsRes.ok) {
          this.logger.error(
            'exchange.syncAllAccountsUsage',
            'Failed to enumerate accounts before sync',
            accountsRes.error.message,
          );
          return fail<BatchSyncSummary>('STORAGE_ERROR', accountsRes.error.message, accountsRes.error.cause);
        }

        const profiles = accountsRes.data.map((row) => row.value);
        this.logger.info(
          'exchange.syncAllAccountsUsage',
          `Starting batch sync (${reason}) for ${profiles.length} account(s)`,
        );

        const errors: { username: string; message: string }[] = [];
        let succeeded = 0;

        for (const profile of profiles) {
          const singleRes = await this.syncAccountUsageInternal(profile.username);
          if (singleRes.ok) {
            succeeded += 1;
          } else {
            errors.push({
              username: profile.username,
              message: singleRes.error.message,
            });
          }
        }

        const summary: BatchSyncSummary = {
          total: profiles.length,
          succeeded,
          failed: errors.length,
          errors,
          completedAt: Date.now(),
        };

        this.updateState({ lastSyncSummary: summary });
        if (errors.length > 0) {
          this.logger.warn(
            'exchange.syncAllAccountsUsage',
            `Batch sync (${reason}) finished with ${errors.length} error(s)`,
            JSON.stringify(errors),
          );
        } else {
          this.logger.info(
            'exchange.syncAllAccountsUsage',
            `Batch sync (${reason}) succeeded for ${succeeded}/${profiles.length} account(s)`,
          );
        }

        return ok(summary);
      } finally {
        this.setGlobalSyncing(false);
        this.activeBatchSyncPromise = null;
      }
    })();

    return this.activeBatchSyncPromise;
  }

  async getOverviewSummary(): Promise<ServiceResult<OverviewSummary>> {
    await this.rebuildStateSnapshot();
    return ok(this.state.overview);
  }

  async getAllUsageSnapshots(): Promise<ServiceResult<UserUsageEntry[]>> {
    await this.rebuildStateSnapshot();
    return ok(this.state.usageList);
  }

  async getSettings(): Promise<ServiceResult<AppSettings>> {
    const res = await this.loadSettingsFromStorage();
    if (!res.ok) {
      return res;
    }
    this.updateState({ settings: res.data });
    return ok(res.data);
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<ServiceResult<AppSettings>> {
    const currentRes = await this.loadSettingsFromStorage();
    const current = currentRes.ok ? currentRes.data : this.state.settings;
    const next = sanitizeSettings(current, patch);

    this.logger.verbose('exchange.updateSettings', 'Updating application settings', JSON.stringify(next));
    const saveRes = await this.storage.save({
      table: TABLE_SETTINGS,
      key: KEY_APP_SETTINGS,
      value: next,
    });
    if (!saveRes.ok) {
      return fail('STORAGE_ERROR', saveRes.error.message, saveRes.error.cause);
    }

    this.updateState({ settings: next });
    this.onSettingsChanged?.(next);
    this.logger.info('exchange.updateSettings', 'Application settings updated', JSON.stringify(next));
    return ok(next);
  }

  async getCachedWorkspaces(username: string): Promise<ServiceResult<WorkspaceListSnapshot | null>> {
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      return fail('VALIDATION_ERROR', '用户名不能为空');
    }

    const readRes = await this.storage.read<WorkspaceListSnapshot>({
      table: TABLE_WORKSPACE_CACHE,
      key: cleanUsername,
    });
    if (!readRes.ok) {
      return fail('STORAGE_ERROR', readRes.error.message, readRes.error.cause);
    }
    if (!readRes.data.exists || !readRes.data.value) {
      return ok(null);
    }

    const validated = validateWorkspaceListSnapshot(readRes.data.value);
    if (!validated.valid || !validated.value) {
      this.logger.warn(
        'exchange.getCachedWorkspaces',
        `Discarding malformed cached workspace snapshot for "${cleanUsername}"`,
        validated.message,
      );
      return ok(null);
    }

    return ok(validated.value);
  }

  async syncAccountWorkspaces(
    input: WorkspaceSyncInput,
  ): Promise<ServiceResult<WorkspaceListSnapshot>> {
    const validatedInput = validateWorkspaceSyncInput(input);
    if (!validatedInput.valid || !validatedInput.value) {
      this.logger.warn(
        'exchange.syncAccountWorkspaces',
        'Workspace sync input validation failed',
        validatedInput.message,
      );
      return fail('VALIDATION_ERROR', validatedInput.message ?? 'Invalid workspace query');
    }

    const { username, page, pageSize, status, slug, branch } = validatedInput.value;
    const credRes = await this.resolveAccountCredentials(
      username,
      'exchange.syncAccountWorkspaces',
    );
    if (!credRes.ok) {
      return fail(credRes.error.code, credRes.error.message, credRes.error.cause);
    }

    this.logger.verbose(
      'exchange.syncAccountWorkspaces',
      `Dispatching workspace parser for "${username}" (page=${page}, pageSize=${pageSize}, status=${status || 'all'})`,
    );

    const parseRes = await this.workspaceParser.parseWorkspaceList({
      username,
      cookie: credRes.data.cookie,
      page,
      pageSize,
      status,
      slug,
      branch,
    });
    if (!parseRes.ok) {
      this.logger.error(
        'exchange.syncAccountWorkspaces',
        `Workspace parser failed for "${username}"`,
        parseRes.error.message,
      );
      return fail(parseRes.error.code, parseRes.error.message, parseRes.error.cause);
    }

    const validatedSnapshot = validateWorkspaceListSnapshot(parseRes.data);
    if (!validatedSnapshot.valid || !validatedSnapshot.value) {
      this.logger.error(
        'exchange.syncAccountWorkspaces',
        `Invalid workspace list snapshot for "${username}"`,
        validatedSnapshot.message,
      );
      return fail(
        'WORKSPACE_PARSER_ERROR',
        validatedSnapshot.message ?? 'Invalid workspace list output',
      );
    }

    const snapshot = validatedSnapshot.value;

    // Cache unfiltered page-1 snapshots so Workspaces preview loads immediately on reopen.
    if (page === 1 && status === '' && !slug && !branch) {
      const saveRes = await this.storage.save({
        table: TABLE_WORKSPACE_CACHE,
        key: username,
        value: snapshot,
      });
      if (!saveRes.ok) {
        this.logger.warn(
          'exchange.syncAccountWorkspaces',
          `Failed to cache workspace preview for "${username}": ${saveRes.error.message}`,
        );
      }
    }

    this.logger.info(
      'exchange.syncAccountWorkspaces',
      `Synced ${snapshot.items.length} workspace(s) (total=${snapshot.total}, page=${snapshot.page}) for "${username}"`,
    );
    return ok(snapshot);
  }

  async getWorkspaceBuildLog(
    input: WorkspaceBuildLogQueryInput,
  ): Promise<ServiceResult<WorkspaceBuildLogDetail>> {
    const validated = validateWorkspaceBuildLogQuery(input);
    if (!validated.valid || !validated.value) {
      return fail('VALIDATION_ERROR', validated.message ?? 'Invalid build log query');
    }

    const { username, slug, sn, includeConfig } = validated.value;
    const credRes = await this.resolveAccountCredentials(
      username,
      'exchange.getWorkspaceBuildLog',
    );
    if (!credRes.ok) {
      return fail(credRes.error.code, credRes.error.message, credRes.error.cause);
    }

    this.logger.verbose(
      'exchange.getWorkspaceBuildLog',
      `Fetching build log for "${slug}" (${sn})`,
    );

    const res = await this.workspaceParser.parseWorkspaceBuildLog({
      username,
      cookie: credRes.data.cookie,
      slug,
      sn,
      includeConfig,
    });
    if (!res.ok) {
      this.logger.error(
        'exchange.getWorkspaceBuildLog',
        `Build log fetch failed for "${sn}"`,
        res.error.message,
      );
      return fail(res.error.code, res.error.message, res.error.cause);
    }

    this.logger.info(
      'exchange.getWorkspaceBuildLog',
      `Fetched build log "${res.data.sn}" (${res.data.buildStatus})`,
    );
    return ok(res.data);
  }

  async getWorkspaceStageLog(
    input: WorkspaceStageLogQueryInput,
  ): Promise<ServiceResult<WorkspaceStageLog>> {
    const validated = validateWorkspaceStageLogQuery(input);
    if (!validated.valid || !validated.value) {
      return fail('VALIDATION_ERROR', validated.message ?? 'Invalid stage log query');
    }

    const { username, slug, sn, pipelineId, stageId, status } = validated.value;
    const credRes = await this.resolveAccountCredentials(
      username,
      'exchange.getWorkspaceStageLog',
    );
    if (!credRes.ok) {
      return fail(credRes.error.code, credRes.error.message, credRes.error.cause);
    }

    this.logger.verbose(
      'exchange.getWorkspaceStageLog',
      `Fetching stage "${stageId}" log for "${sn}"`,
    );

    const res = await this.workspaceParser.parseWorkspaceStageLog({
      username,
      cookie: credRes.data.cookie,
      slug,
      sn,
      pipelineId,
      stageId,
      status,
    });
    if (!res.ok) {
      this.logger.error(
        'exchange.getWorkspaceStageLog',
        `Stage log fetch failed for "${sn}/${stageId}"`,
        res.error.message,
      );
      return fail(res.error.code, res.error.message, res.error.cause);
    }

    this.logger.info(
      'exchange.getWorkspaceStageLog',
      `Fetched stage "${res.data.id}" (${res.data.lines.length} line(s)) for "${sn}"`,
    );
    return ok(res.data);
  }

  async clearCacheAndLogs(): Promise<
    ServiceResult<{ clearedCacheCount: number; clearedLogCount: number }>
  > {
    this.logger.info('exchange.clearCacheAndLogs', 'Clearing usage/workspace caches and log records');

    const [usageCacheClearRes, workspaceCacheClearRes] = await Promise.all([
      this.storage.clearTable({ table: TABLE_USAGE_CACHE }),
      this.storage.clearTable({ table: TABLE_WORKSPACE_CACHE }),
    ]);
    if (!usageCacheClearRes.ok) {
      return fail('STORAGE_ERROR', usageCacheClearRes.error.message, usageCacheClearRes.error.cause);
    }
    if (!workspaceCacheClearRes.ok) {
      return fail(
        'STORAGE_ERROR',
        workspaceCacheClearRes.error.message,
        workspaceCacheClearRes.error.cause,
      );
    }

    const totalClearedCache =
      usageCacheClearRes.data.clearedCount + workspaceCacheClearRes.data.clearedCount;

    const accountsRes = await this.storage.readTable<AccountProfile>({
      table: TABLE_ACCOUNTS,
    });
    if (accountsRes.ok) {
      for (const record of accountsRes.data) {
        if (record.value.lastSyncedAt !== null) {
          await this.storage.save({
            table: TABLE_ACCOUNTS,
            key: record.key,
            value: {
              ...record.value,
              lastSyncedAt: null,
            } satisfies AccountProfile,
          });
        }
      }
    }

    const logClearRes = await this.logSubsystem.clearLogs();
    if (!logClearRes.ok) {
      return fail('EXCHANGE_ERROR', logClearRes.error.message, logClearRes.error.cause);
    }

    await this.rebuildStateSnapshot({ lastSyncSummary: null });

    this.logger.info(
      'exchange.clearCacheAndLogs',
      `Cleared ${totalClearedCache} cached snapshot(s) and ${logClearRes.data.clearedCount} log(s)`,
    );

    return ok({
      clearedCacheCount: totalClearedCache,
      clearedLogCount: logClearRes.data.clearedCount,
    });
  }

  private async resolveAccountCredentials(
    username: string,
    actionName: string,
  ): Promise<ServiceResult<{ profile: AccountProfile; cookie: string }>> {
    const profileRes = await this.storage.read<AccountProfile>({
      table: TABLE_ACCOUNTS,
      key: username,
    });
    if (!profileRes.ok) {
      return fail('STORAGE_ERROR', profileRes.error.message, profileRes.error.cause);
    }
    if (!profileRes.data.exists || !profileRes.data.value) {
      return fail('NOT_FOUND', `账户 "${username}" 不存在`);
    }

    const secretRes = await this.storage.read<AccountSecret>({
      table: TABLE_SECRETS,
      key: username,
    });
    if (!secretRes.ok) {
      return fail('STORAGE_ERROR', secretRes.error.message, secretRes.error.cause);
    }

    const cookie = secretRes.data.value?.cookie ?? '';
    if (!cookie.trim()) {
      this.logger.warn(actionName, `Missing cookie for "${username}"`);
      return fail('VALIDATION_ERROR', `账户 "${username}" 的 Cookie 缺失，请重新编辑`);
    }

    return ok({
      profile: profileRes.data.value,
      cookie,
    });
  }

  private async loadSettingsFromStorage(): Promise<ServiceResult<AppSettings>> {
    const readRes = await this.storage.read<AppSettings>({
      table: TABLE_SETTINGS,
      key: KEY_APP_SETTINGS,
    });
    if (!readRes.ok) {
      return fail('STORAGE_ERROR', readRes.error.message, readRes.error.cause);
    }
    if (!readRes.data.exists || !readRes.data.value) {
      return ok({ ...DEFAULT_APP_SETTINGS });
    }
    return ok(sanitizeSettings(DEFAULT_APP_SETTINGS, readRes.data.value));
  }

  private async rebuildStateSnapshot(partialOverrides: Partial<ExchangeUiState> = {}): Promise<void> {
    const [accountsRes, secretsRes, cacheRes] = await Promise.all([
      this.storage.readTable<AccountProfile>({ table: TABLE_ACCOUNTS }),
      this.storage.readTable<AccountSecret>({ table: TABLE_SECRETS }),
      this.storage.readTable<UsageSnapshot>({ table: TABLE_USAGE_CACHE }),
    ]);

    const profiles = accountsRes.ok ? accountsRes.data.map((r) => r.value) : [];
    const secretMap = new Map<string, AccountSecret>();
    if (secretsRes.ok) {
      for (const r of secretsRes.data) {
        secretMap.set(r.key, r.value);
      }
    }

    const cacheMap = new Map<string, UsageSnapshot>();
    if (cacheRes.ok) {
      for (const r of cacheRes.data) {
        cacheMap.set(r.key, r.value);
      }
    }

    const now = Date.now();
    const accountViews: AccountView[] = profiles.map((profile) => {
      const secret = secretMap.get(profile.username);
      const rawCookie = secret?.cookie ?? '';
      return {
        username: profile.username,
        remark: profile.remark,
        maskedCookie: maskCookie(rawCookie),
        hasCookie: rawCookie.trim().length > 0,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        lastSyncedAt: profile.lastSyncedAt,
        isStale: isAccountStale(profile.lastSyncedAt, now),
      };
    });

    const usageList: UserUsageEntry[] = accountViews.map((account) => ({
      account,
      snapshot: cacheMap.get(account.username) ?? null,
    }));

    const overview = this.computeOverview(accountViews, cacheMap);
    this.updateState({
      accounts: accountViews,
      usageList,
      overview,
      ...partialOverrides,
    });
  }

  private computeOverview(
    accounts: AccountView[],
    cacheMap: Map<string, UsageSnapshot>,
  ): OverviewSummary {
    const aiSummary = createEmptyMetricSummary('ai_credits', 'AI Credits', 'Credits');
    const buildSummary = createEmptyMetricSummary('build_cpu', '云原生构建-CPU', '核时');
    const devSummary = createEmptyMetricSummary('dev_cpu', '云原生开发-CPU', '核时');

    const staleUsernames: string[] = [];
    let lastUpdatedAt: number | null = null;

    for (const account of accounts) {
      if (account.isStale) {
        staleUsernames.push(account.username);
      }
      if (account.lastSyncedAt !== null) {
        lastUpdatedAt =
          lastUpdatedAt === null ? account.lastSyncedAt : Math.max(lastUpdatedAt, account.lastSyncedAt);
      }

      const snapshot = cacheMap.get(account.username);
      if (snapshot) {
        accumulateGroup(aiSummary, snapshot.aiCredits);
        accumulateGroup(buildSummary, snapshot.buildCpu);
        accumulateGroup(devSummary, snapshot.devCpu);
      }
    }

    return {
      accountCount: accounts.length,
      staleUsernames,
      hasStaleAccounts: staleUsernames.length > 0,
      lastUpdatedAt,
      metrics: [
        finalizeMetricSummary(aiSummary),
        finalizeMetricSummary(buildSummary),
        finalizeMetricSummary(devSummary),
      ],
    };
  }

  private markSyncingUser(username: string, active: boolean): void {
    const next = new Set(this.state.syncingUsernames);
    if (active) {
      next.add(username);
    } else {
      next.delete(username);
    }
    this.updateState({
      syncingUsernames: Array.from(next),
      isSyncing: active || this.activeBatchSyncPromise !== null || next.size > 0,
    });
  }

  private setGlobalSyncing(active: boolean): void {
    this.updateState({
      isSyncing: active || this.state.syncingUsernames.length > 0,
    });
  }

  private updateState(patch: Partial<ExchangeUiState>): void {
    this.state = {
      ...this.state,
      ...patch,
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
