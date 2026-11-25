/**
 * Core domain models shared across services.
 * Contains pure TypeScript types without any runtime logic.
 */

export type QuotaMetricKey = 'ai_credits' | 'build_cpu' | 'dev_cpu';

export type QuotaUnit = 'Credits' | '核时';

export interface QuotaPackage {
  id: string;
  name: string;
  total: number;
  used: number;
  locked?: number;
  unit: QuotaUnit;
}

export interface MetricQuotaGroup {
  metric: QuotaMetricKey;
  label: string;
  unit: QuotaUnit;
  packages: QuotaPackage[];
}

export interface UsageSnapshot {
  username: string;
  fetchedAt: number;
  aiCredits: MetricQuotaGroup;
  buildCpu: MetricQuotaGroup;
  devCpu: MetricQuotaGroup;
}

export interface AccountProfile {
  username: string;
  remark: string;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number | null;
}

export interface AccountSecret {
  cookie: string;
  updatedAt: number;
}

export interface AccountView {
  username: string;
  remark: string;
  maskedCookie: string;
  hasCookie: boolean;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number | null;
  isStale: boolean;
}

export interface AccountEditorPayload {
  username: string;
  cookie: string;
  remark: string;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number | null;
}

export interface CreateAccountInput {
  username: string;
  cookie: string;
  remark?: string;
}

export interface UpdateAccountInput {
  username: string;
  cookie: string;
  remark?: string;
}

export interface MetricAggregateSummary {
  metric: QuotaMetricKey;
  label: string;
  unit: QuotaUnit;
  total: number;
  used: number;
  locked: number;
  remaining: number;
  percentage: number;
  packageCount: number;
}

export interface OverviewSummary {
  accountCount: number;
  staleUsernames: string[];
  hasStaleAccounts: boolean;
  lastUpdatedAt: number | null;
  metrics: [MetricAggregateSummary, MetricAggregateSummary, MetricAggregateSummary];
}

export interface UserUsageEntry {
  account: AccountView;
  snapshot: UsageSnapshot | null;
}

export interface AppSettings {
  autoRefreshOnLaunch: boolean;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMinutes: number;
}

export type LogLevel = 'V' | 'I' | 'W' | 'E';

export type ServiceSource = 'UI' | 'Storage' | 'Parser' | 'Exchange';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: ServiceSource;
  action: string;
  message: string;
  details?: string;
  note?: string;
}

export interface LogQueryFilter {
  levels?: LogLevel[];
  sources?: ServiceSource[];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LogUpdateInput {
  id: string;
  note?: string;
  level?: LogLevel;
  message?: string;
}

export interface BatchSyncSummary {
  total: number;
  succeeded: number;
  failed: number;
  errors: { username: string; message: string }[];
  completedAt: number;
}
