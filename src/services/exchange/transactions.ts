/**
 * Transaction coordinator for the Update Exchange Service.
 * Mediates all workflows across UI, Information Storage, Usage Parser, and Log Subsystem.
 */

import type {
  AccountEditorPayload,
  AccountProfile,
  AccountSecret,
  AccountView,
  AppSettings,
  BatchSyncSummary,
  CreateAccountInput,
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
} from '@/contracts';
import type { LogSubsystem } from './logger';
import {
  DEFAULT_APP_SETTINGS,
  isAccountStale,
  maskCookie,
  sanitizeSettings,
  validateCreateAccount,
  validateUpdateAccount,
  validateUsageSnapshot,
} from './validator';

const TABLE_ACCOUNTS = 'accounts';
const TABLE_SECRETS = 'accounts_secrets';
const TABLE_USAGE_CACHE = 'usage_cache';
const TABLE_SETTINGS = 'settings';
const KEY_APP_SETTINGS = 'app_settings';

function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data, timestamp: Date.now() };
}

function fail<T>(
  code:
    | 'VALIDATION_ERROR'
    | 'NOT_FOUND'
    | 'ALREADY_EXISTS'
    | 'STORAGE_ERROR'
    | 'PARSER_ERROR'
    | 'EXCHANGE_ERROR',
  message: string,
  cause?: string,
): ServiceResult<T> {
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
  private onSettingsChanged?: (settings: AppSettings) => void;

  constructor(storage: StoragePort, parser: ParserPort, logSubsystem: LogSubsystem) {
    this.storage = storage;
    this.parser = parser;
    this.logSubsystem = logSubsystem;
    this.logger = logSubsystem.createReporter('Exchange');
  }

  setSettingsChangeHandler(handler: (settings: AppSettings) => void): void {
    this.onSettingsChanged = handler;
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

    const [profileRemove, secretRemove, cacheRemove] = await Promise.all([
      this.storage.remove({ table: TABLE_ACCOUNTS, key: cleanUsername }),
      this.storage.remove({ table: TABLE_SECRETS, key: cleanUsername }),
      this.storage.remove({ table: TABLE_USAGE_CACHE, key: cleanUsername }),
    ]);

    if (!profileRemove.ok || !secretRemove.ok || !cacheRemove.ok) {
      const msg =
        (!profileRemove.ok && profileRemove.error.message) ||
        (!secretRemove.ok && secretRemove.error.message) ||
        (!cacheRemove.ok && cacheRemove.error.message) ||
        'Failed to remove account records';
      this.logger.error('exchange.deleteAccount', `Partial failure deleting "${cleanUsername}"`, msg);
      return fail('STORAGE_ERROR', msg);
    }

    await this.rebuildStateSnapshot();
    this.logger.info('exchange.deleteAccount', `Deleted account "${cleanUsername}" and its cached usage`);
    return ok({ deleted: profileRemove.data.deleted });
  }

  async syncAccountUsage(username: string): Promise<ServiceResult<UsageSnapshot>> {
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      return fail('VALIDATION_ERROR', '用户名不能为空');
    }

    this.markSyncingUser(cleanUsername, true);
    try {
      const profileRes = await this.storage.read<AccountProfile>({
        table: TABLE_ACCOUNTS,
        key: cleanUsername,
      });
      if (!profileRes.ok) {
        return fail('STORAGE_ERROR', profileRes.error.message, profileRes.error.cause);
      }
      if (!profileRes.data.exists || !profileRes.data.value) {
        return fail('NOT_FOUND', `账户 "${cleanUsername}" 不存在`);
      }

      const secretRes = await this.storage.read<AccountSecret>({
        table: TABLE_SECRETS,
        key: cleanUsername,
      });
      if (!secretRes.ok) {
        return fail('STORAGE_ERROR', secretRes.error.message, secretRes.error.cause);
      }

      const cookie = secretRes.data.value?.cookie ?? '';
      if (!cookie.trim()) {
        this.logger.warn('exchange.syncAccountUsage', `Missing cookie for "${cleanUsername}"`);
        return fail('VALIDATION_ERROR', `账户 "${cleanUsername}" 的 Cookie 缺失，请重新编辑`);
      }

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
        ...profileRes.data.value,
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

  async syncAllAccountsUsage(
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
          const singleRes = await this.syncAccountUsage(profile.username);
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

  async clearCacheAndLogs(): Promise<
    ServiceResult<{ clearedCacheCount: number; clearedLogCount: number }>
  > {
    this.logger.info('exchange.clearCacheAndLogs', 'Clearing usage cache and log records');

    const cacheClearRes = await this.storage.clearTable({ table: TABLE_USAGE_CACHE });
    if (!cacheClearRes.ok) {
      return fail('STORAGE_ERROR', cacheClearRes.error.message, cacheClearRes.error.cause);
    }

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
      `Cleared ${cacheClearRes.data.clearedCount} cached snapshot(s) and ${logClearRes.data.clearedCount} log(s)`,
    );

    return ok({
      clearedCacheCount: cacheClearRes.data.clearedCount,
      clearedLogCount: logClearRes.data.clearedCount,
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
