# AGENTS.md — Technical Architecture & Implementation Specification

> **Project:** CNB 面板 (`m20.cnb.panel`)  
> **Target Platform:** iOS 26+ primary (Android relaxed for Windows real-device Expo Go debugging; Web strictly forbidden)  
> **Framework & Runtime:** Expo SDK 58 (React Native 0.88, React 19.3, TypeScript), debugged in **Expo Go**  
> **Language Policy:** All source code comments, JSDoc blocks, and inline engineering notes **MUST be written in English**.

---

## 1. Project Overview & Constraints

**CNB 面板** is a dedicated iOS utility app for monitoring remaining quotas and Cloud Native Dev ("云原生开发") container history across one or more CNB accounts/organizations:
- **AI Credits** (unit: `Credits`)
- **云原生构建-CPU** (unit: `核时`)
- **云原生开发-CPU** (unit: `核时`)
- **云原生开发容器与构建日志** (container list & per-container build/stage logs)

### Hard Technical Constraints
1. **iOS 26+ Primary & Windows Expo Go Compatibility:** Configure `"platforms": ["ios", "android"]` in `app.json` (Android is permitted solely so Windows developers can debug on physical/emulator Expo Go via `npm start` -> `expo start --go` without Xcode; `"web"` is strictly excluded). Do not introduce Web compatibility shims or platform branches unless required by an underlying library's TypeScript signature (such as `md` on `NativeTabs.Trigger.Icon`).
2. **Expo SDK 58 + Expo Go Compatibility:** Every dependency must be natively bundled in Expo Go SDK 58. Do not introduce custom native Swift/Obj-C modules or plugins that fail in Expo Go (e.g., do **not** enable `requireAuthentication: true` on `expo-secure-store`, and do **not** rely on OS-killed `BGTaskScheduler` background execution that requires a custom dev build).
3. **Static Verification First & Permanently No Web Debugging:**
   - Validate changes using static checks (`npx tsc --noEmit`, ESLint, and automated architectural boundary checks) only; avoid dynamic debugging unless strictly unavoidable.
   - **PERMANENTLY FORBIDDEN:** Never start, build, or debug Expo Web (`npx expo start --web`, `npx expo export --platform web`, or browser-based app debugging).
4. **English Comments Only:** Every comment in `.ts` and `.tsx` files must be in English. User-facing UI strings remain in Simplified Chinese (`zh-CN`).
5. **Live CNB Data Parsing:** `Usage Parser Service` and `Workspace Parser Service` query live CNB (`https://cnb.cool`) read-only `GET` endpoints using `fetch` with `credentials: 'omit'` to prevent cross-account cookie leakage in iOS `NSHTTPCookieStorage`.
6. **Strict Service Modification Isolation:**
   - `ui`, `storage`, `parser`, and `workspace-parser` may only be modified within their respective service directories (aside from necessary global config such as `src/contracts/`, `src/app/`, `eslint.config.js`, and `scripts/check-boundaries.mjs`). Modifying source code inside any other service is forbidden.
   - `exchange` may adjust interface-exchange glue with other services where needed, without modifying other services' core code.

---

## 2. Directory Layout & Five-Service Isolation

The application is strictly partitioned into **five independent services** plus a thin Expo Router entry layer and a zero-logic TypeScript contract layer:

```text
CNBControlPanel/
├── logo.svg                          # Master vector app icon
├── app.json                          # Expo SDK 58 config (bundleIdentifier: m20.cnb.panel, ios + android for Windows Expo Go)
├── package.json
├── tsconfig.json
├── eslint.config.js                  # Enforces service boundary & English-comment/lint rules
├── scripts/
│   └── check-boundaries.mjs          # Static dependency-graph verifier across services
├── assets/                           # PNG icons/splash generated from logo.svg
└── src/
    ├── contracts/                    # Pure TypeScript types & port interfaces (NO runtime code)
    │   ├── domain.ts                 # Account, UsageSnapshot, Workspace, AppSettings, LogEntry
    │   ├── results.ts                # Structured ServiceResult<T>, ErrorCode
    │   └── ports.ts                  # LogReporter, StoragePort, ParserPort, WorkspaceParserPort, ExchangePort
    ├── app/                          # Thin Expo Router file-system routes (UI routing shell ONLY)
    │   ├── _layout.tsx               # Root Stack (hosts (tabs) + standalone native-header pages)
    │   ├── (tabs)/
    │   │   ├── _layout.tsx           # expo-router/native-tabs (iOS 26 Liquid Glass bottom bar)
    │   │   ├── index.tsx             # Re-exports OverviewScreen
    │   │   ├── accounts.tsx          # Re-exports AccountsScreen
    │   │   ├── usage.tsx             # Re-exports UsageScreen
    │   │   └── settings.tsx          # Re-exports SettingsScreen
    │   ├── account-editor.tsx        # Standalone create/edit account page (native Stack header)
    │   ├── workspaces.tsx            # Standalone per-user recent containers (up to 5/user) page
    │   ├── workspace-history.tsx     # Standalone paginated container list ("查看更多") page
    │   ├── workspace-logs.tsx        # Standalone container build log page (native Stack header)
    │   └── logs.tsx                  # Standalone Log viewer page (native Stack header)
    └── services/
        ├── ui/                       # [Service 1] User Interface Service
        │   ├── theme/
        │   ├── components/
        │   ├── hooks/
        │   └── screens/
        ├── storage/                  # [Service 2] Information Storage Service
        │   ├── index.ts
        │   ├── sqliteStore.ts
        │   └── secureCookieStore.ts
        ├── parser/                   # [Service 3] Usage Parser Service
        │   ├── index.ts
        │   ├── httpClient.ts
        │   └── cnbHtmlParser.ts
        ├── exchange/                 # [Service 4] Update Exchange Service + Log Subsystem
        │   ├── index.ts
        │   ├── validator.ts
        │   ├── transactions.ts
        │   ├── scheduler.ts
        │   └── logger/
        │       ├── index.ts
        │       └── logDatabase.ts
        └── workspace-parser/         # [Service 5] Cloud Native Dev Parser Service
            └── index.ts              # Exposes createWorkspaceParserService(logger) -> WorkspaceParserPort
```

### Dependency & Access Matrix (Strictly Enforced)

| Caller \ Target | `contracts` | `services/ui` | `services/storage` | `services/parser` | `services/workspace-parser` | `services/exchange` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `src/app/*` (Router Shell) | Allowed | Allowed | **FORBIDDEN** | **FORBIDDEN** | **FORBIDDEN** | **FORBIDDEN** |
| `src/services/ui/*` | Allowed | Self | **FORBIDDEN** | **FORBIDDEN** | **FORBIDDEN** | Allowed |
| `src/services/storage/*` | Allowed | **FORBIDDEN** | Self | **FORBIDDEN** | **FORBIDDEN** | **FORBIDDEN** |
| `src/services/parser/*` | Allowed | **FORBIDDEN** | **FORBIDDEN** | Self | **FORBIDDEN** | **FORBIDDEN** |
| `src/services/workspace-parser/*` | Allowed | **FORBIDDEN** | **FORBIDDEN** | **FORBIDDEN** | Self | **FORBIDDEN** |
| `src/services/exchange/*` | Allowed | **FORBIDDEN** | Allowed | Allowed | Allowed | Self |

**How Logging Stays Decoupled Without Circular Imports:**
- `src/contracts/ports.ts` defines a pure TypeScript interface `LogReporter` (`verbose`, `info`, `warn`, `error`).
- `exchange` instantiates `storage`, `parser`, and `workspace-parser` via factory functions (`createStorageService(logger)`, `createParserService(logger)`, and `createWorkspaceParserService(logger)`), injecting a bound `LogReporter` instance.
- Consequently, `storage`, `parser`, and `workspace-parser` **never** import `exchange`, `ui`, or each other, yet every single operation inside all five services emits structured `V`/`I`/`W`/`E` logs into the Exchange Log Subsystem.
- `ui` reports UI interaction and lifecycle logs through `exchange.reportUiLog(...)`.

---

## 3. Detailed Design of Each Service

### 3.1 Contracts Layer (`src/contracts/`)

Zero runtime code—only `type` and `interface` declarations.

Key domain models:
- `QuotaMetricKey`: `'ai_credits' | 'build_cpu' | 'dev_cpu'`
- `QuotaUnit`: `'Credits' | '核时'`
- `QuotaPackage`:
  ```ts
  export interface QuotaPackage {
    id: string;
    name: string;        // e.g., "免费配额", "高校师生专属特权"
    total: number;       // Total quota (>= 0)
    used: number;        // Used quota (>= 0)
    locked?: number;     // Optional locked quota (>= 0, omitted if absent)
    unit: QuotaUnit;
  }
  ```
- `MetricQuotaGroup`:
  ```ts
  export interface MetricQuotaGroup {
    metric: QuotaMetricKey;
    label: string;       // "AI Credits" | "云原生构建-CPU" | "云原生开发-CPU"
    unit: QuotaUnit;
    packages: QuotaPackage[]; // Guaranteed >= 1 package
  }
  ```
- `UsageSnapshot`:
  ```ts
  export interface UsageSnapshot {
    username: string;
    fetchedAt: number;   // Unix epoch ms
    aiCredits: MetricQuotaGroup;
    buildCpu: MetricQuotaGroup;
    devCpu: MetricQuotaGroup;
  }
  ```
- `AccountProfile` / `AccountView` / `AccountEditorPayload`:
  ```ts
  export interface AccountProfile {
    username: string;    // Immutable primary key
    remark: string;      // Optional user note (empty string when unset)
    createdAt: number;
    updatedAt: number;
    lastSyncedAt: number | null;
  }
  // AccountSecret stores { cookie, updatedAt } separately via SecureStore.
  // AccountView exposes maskedCookie + isStale for list UIs; AccountEditorPayload supplies full cookie when editing.
  ```
- `AppSettings`:
  ```ts
  export interface AppSettings {
    autoRefreshOnLaunch: boolean; // Auto-refresh in background on app activation
    autoRefreshEnabled: boolean;  // Periodic interval auto-refresh toggle
    autoRefreshIntervalMinutes: number; // Clamped integer 1..1440 (default: 15)
  }
  ```
- `LogLevel`: `'V' | 'I' | 'W' | 'E'`
- `ServiceSource`: `'UI' | 'Storage' | 'Parser' | 'WorkspaceParser' | 'Exchange'`
- `LogEntry`:
  ```ts
  export interface LogEntry {
    id: string;
    timestamp: number;
    level: LogLevel;
    source: ServiceSource;
    action: string;
    message: string;
    details?: string;
    note?: string;       // Supports Log CRUD update operations
  }
  ```
- **Cloud Native Dev Contracts (`WorkspaceParserPort` domain models):**
  - `WorkspaceLifecycleStatus`: `'running' | 'closed'` (container lifecycle, distinct from build result status)
  - `BuildResultStatus`: `'pending' | 'success' | 'failed' | string`
  - `WorkspaceSummary`: `{ sn: string; pipelineId: string; slug: string; branch: string; userName: string; status: WorkspaceLifecycleStatus; createTime: string; durationMs: number; fileCount: number; repoUrl: string; ssh: boolean }`
  - `WorkspaceListSnapshot`: `{ requestedUsername: string; ownerUsername: string; ownerMismatch: boolean; total: number; page: number; pageSize: number; hasMore: boolean; fetchedAt: number; items: WorkspaceSummary[] }`
  - `WorkspaceStageSummary`: `{ id: string; name: string; status: BuildResultStatus; durationMs: number }`
  - `WorkspaceBuildConfigSummary`: `{ image?: string; stages: string[]; envKeys: string[] }` (key names only; raw `env` values are never exposed)
  - `WorkspaceBuildLogDetail`: `{ sn: string; slug: string; title: string; event: string; sha: string; buildStatus: BuildResultStatus; startTimestamp: number; endTimestamp: number; durationMs: number; canRebuild: boolean; logRetentionDays: number; buildLogUrl: string; pipelineId: string; image?: string; cpus?: number; isGpu?: boolean; metricCoreHours?: number; ip?: string; port?: number; aiUsage?: { totalTokens: number; totalMilliCredit: number }; stages: WorkspaceStageSummary[]; configSummary?: WorkspaceBuildConfigSummary; fetchedAt: number }`
  - `WorkspaceStageLog`: `{ id: string; name: string; status: BuildResultStatus; durationMs: number; startTime: number; endTime: number; error: string; lines: string[] }` (ANSI-stripped and credential-redacted lines)

---

### 3.2 Information Storage Service (`src/services/storage/`)

**Purpose:** Pure table/key/value persistence abstraction without business validation or knowledge of UI/Parser.

**Selected Persistence Stack (Optimal for Expo SDK 58 & Expo Go):**
1. **`expo-sqlite` (`cnb_panel_storage.db`)**: Primary structured key-value table store:
   - Schema: `CREATE TABLE IF NOT EXISTS storage_records (table_name TEXT NOT NULL, record_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (table_name, record_key));`
   - Supports arbitrary `table` + `key` + `value` serialization with prepared statements (`runAsync`, `getFirstAsync`, `getAllAsync`).
2. **`expo-secure-store` (iOS Keychain)**: Transparently isolates sensitive credential payloads (specifically `accounts_secrets` / cookie strings) inside iOS Keychain rather than plaintext SQLite, while keeping key indexing and non-sensitive metadata in SQLite.
   - SecureStore key naming uses an Expo-Go-safe sanitized identifier (`cnb.panel.secret.<hex-encoded-key>`) because iOS Keychain keys only permit `[A-Za-z0-9._-]`.
   - `requireAuthentication` is explicitly **not** used so Expo Go never fails due to missing `NSFaceIDUsageDescription`.

**Core API Contract:**
- `save({ table, key, value })` -> `Promise<ServiceResult<{ table: string; key: string; savedAt: number }>>`
- `read<T>({ table, key })` -> `Promise<ServiceResult<{ table: string; key: string; exists: boolean; value: T | null; updatedAt: number | null }>>`
- Supporting table management methods on the same service:
  - `remove({ table, key })` -> `Promise<ServiceResult<{ table: string; key: string; deleted: boolean }>>`
  - `readTable<T>({ table })` -> `Promise<ServiceResult<Array<{ key: string; value: T; updatedAt: number }>>>`
  - `clearTable({ table })` -> `Promise<ServiceResult<{ table: string; clearedCount: number }>>`

**Logical Tables Managed by Exchange via Storage:**
- `accounts`: Account profiles (`username`, `remark`, `createdAt`, `updatedAt`, `lastSyncedAt`)
- `accounts_secrets`: Sensitive `cookie` values (routed to `expo-secure-store` inside Storage service)
- `usage_cache`: Latest `UsageSnapshot` keyed by `username`
- `workspace_cache`: Latest `WorkspaceListSnapshot` keyed by `username`
- `settings`: App configuration keyed by `'app_settings'`

---

### 3.3 Usage Parser Service (`src/services/parser/`)

**Purpose:** Given `{ username, cookie }`, execute read-only GET requests against `https://cnb.cool`, parse organization billing data, and output a structured `UsageSnapshot`.

**Core API Contract:**
- `parseUsage({ username, cookie })` -> `Promise<ServiceResult<UsageSnapshot>>`

**Live Implementation (`httpClient.ts`, `cnbHtmlParser.ts`, `index.ts`):**
1. **Cookie Isolation & Resilience (`httpClient.ts`):**
   - Strips optional leading `Cookie:` prefix and line breaks via `sanitizeCookieHeader` without ever logging raw cookies.
   - Calls `fetch` with `credentials: 'omit'` so React Native's native `NSHTTPCookieStorage` never leaks cookies across accounts.
   - Applies a 20-second `AbortController` timeout and up to 2 exponential-backoff retries on HTTP `429`/`5xx` or network errors.
2. **Account & Organization Discovery (`index.ts`):**
   - Verifies session validity via `GET /user` (`Accept: application/json`), rejecting HTTP `401` clearly.
   - If `username` matches the authenticated Cookie user (case-insensitive), paginates `GET /user/groups?page=N&page_size=100` using `x-cnb-total` / `x-cnb-page-size`.
   - If `username` differs from the Cookie user, fetches `GET /u/{username}/groups` HTML and extracts `props.pageProps.initialState.user.global.userGroups` from `__NEXT_DATA__`.
3. **Billing Extraction, Unit Conversion & Freeze Allocation (`cnbHtmlParser.ts`):**
   - Fetches `GET /{org}/-/settings/charge` HTML (rate-limited at 450 ms between organizations) and extracts `props.pageProps.initialState.group.setting.charge` from `__NEXT_DATA__`.
   - Sub-organizations (`org/sub`) lacking an independent charge page automatically fall back to their root organization (`org`) and are deduplicated by resolved root path to avoid double-counting.
   - Converts raw metrics: `credit_in_milli ÷ 1000` -> `Credits`; `ci_in_sec ÷ 3600` & `dev_in_sec ÷ 3600` -> `核时`.
   - Allocates `formattedPacks` sequentially in array order and assigns pre-frozen amounts (`charge.freezeVolume[resType]` falling back to `usage.data['freeze_' + usageKey]`) to remaining pack capacity (`QuotaPackage.locked`, omitted when zero).
   - Emits `V`/`I`/`W`/`E` trace events for every stage while keeping credentials redacted.

---

### 3.4 Update Exchange Service & Log Subsystem (`src/services/exchange/`)

**Purpose:** Central transaction coordinator, validator, background/interval refresh scheduler, and independent logging subsystem.

#### A. Independent Log Subsystem (`src/services/exchange/logger/`)
- **Physical Isolation:** Uses its own dedicated SQLite database (`cnb_panel_logs.db`) via `expo-sqlite`, completely separate from `storage` (`cnb_panel_storage.db` / Keychain). If `storage` fails or clears cache, logs remain intact unless the user explicitly clears logs.
- **Schema:**
  ```sql
  CREATE TABLE IF NOT EXISTS app_logs (
    id TEXT PRIMARY KEY NOT NULL,
    timestamp INTEGER NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    note TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs(timestamp DESC);
  ```
- **Resilience:** Maintains a small in-memory pending queue if SQLite is still initializing at cold boot, flushing immediately once the DB handle opens, plus automatic retention cap (e.g., pruning oldest entries beyond 5,000 rows).
- **CRUD Operations:**
  - **Create:** `LogSubsystem.record(...)` / `exchangeService.reportUiLog(...)`
  - **Read:** `queryLogs({ levels?, sources?, search?, limit?, offset? })`
  - **Update:** `updateLog({ id, note?, level?, message? })`
  - **Delete:** `deleteLogs({ ids })` / `clearLogs()`

#### B. Validation & Transactions (`validator.ts` & `transactions.ts`)
Every transaction validates inputs before invoking `storage`, `parser`, or `workspace-parser`, logs start/success/failure, and emits state-change events to subscribed UI hooks:
1. `listAccounts()` — merges `accounts` metadata + secret presence status; returns sanitized `AccountView` (`maskedCookie` for UI lists), while `getAccountForEdit(username)` returns `AccountEditorPayload` (`cookie` only when requested for editing).
2. `createAccount({ username, cookie, remark })` — rejects empty `username`/`cookie` or duplicate `username`; persists account metadata + secret cookie.
3. `updateAccount({ username, cookie, remark })` — rejects `username` modification; updates `cookie` and `remark`.
4. `deleteAccount({ username })` — removes from `accounts`, `accounts_secrets`, `usage_cache`, and `workspace_cache`.
5. `syncAccountUsage({ username })` — reads account + cookie from `storage`, calls `parser.parseUsage`, validates returned `UsageSnapshot`, updates `usage_cache` and `lastSyncedAt` in `accounts`.
6. `syncAllAccountsUsage()` — iterates through all stored accounts sequentially/bounded-concurrently, aggregates per-account successes & failures, and updates state atomically per account.
7. `getOverviewSummary()` — reads all accounts + cached snapshots; computes aggregated totals (`remaining`, `total`, `used`, `locked`, `percentage`) for `aiCredits`, `buildCpu`, and `devCpu`, plus `hasStaleAccounts` (`lastSyncedAt === null` or `now - lastSyncedAt > 3_600_000` ms) and `staleUsernames`.
8. `getAllUsageSnapshots()` — returns ordered user list paired with their cached `UsageSnapshot | null`.
9. `syncAccountWorkspaces({ username, page?, pageSize?, status?, slug?, branch? })` / `getCachedWorkspaces(username)` — resolves account credentials via `storage`, invokes `workspaceParser.parseWorkspaceList`, caches page 1 (`pageSize: 5` default preview) in `workspace_cache`, and exposes `hasMore` + `ownerMismatch` metadata for `"查看更多"` pagination.
10. `getWorkspaceBuildLog({ username, slug, sn, includeConfig? })` / `getWorkspaceStageLog({ username, slug, sn, pipelineId, stageId, status? })` — resolves account credentials via `storage` and delegates to `workspaceParser` for on-demand container build detail and stage output retrieval.
11. `getSettings()` / `updateSettings(patch)` — reads/updates `AppSettings`, reconfiguring the auto-refresh scheduler immediately.
12. `clearCacheAndLogs()` — clears `usage_cache` and `workspace_cache` via `storage.clearTable(...)`, resets `lastSyncedAt` to `null` on accounts (preserving accounts and settings), and calls `logger.clearLogs()`, then logs a fresh `I` entry confirming the reset.

#### C. Auto-Refresh Scheduler (`scheduler.ts`)
- Listens to React Native `AppState` transitions (`'background' | 'inactive'` -> `'active'`).
  - When `autoRefreshOnLaunch` is `true`, triggers a non-blocking silent `syncAllAccountsUsage()` on initial app startup and when returning to foreground (debounced e.g. at least 15s between foreground triggers to avoid duplicate bursts).
- When `autoRefreshEnabled` is `true`, runs a `setInterval` timer every `autoRefreshIntervalMinutes * 60_000` ms while the app is active, triggering `syncAllAccountsUsage()`.
- Re-arms/cancels cleanly whenever settings change.

---

### 3.5 User Interface Service (`src/services/ui/`) & Router Shell (`src/app/`)

- **Root Navigation (`src/app/_layout.tsx`)**:
  - Calls `enableLegacyHeaderAppearance()` at module top level so native Stack screens use classic iOS 18 opaque styling on iOS 26+.
  - Uses `<Stack>` with `headerShown: false` for `(tabs)` and `headerShown: true` (`headerTransparent: false`, `headerTintColor: palette.themeAccent` `#F76945`, explicit opaque `bgCard` background, `headerBlurEffect: undefined`) for standalone pages (`account-editor`, `workspaces`, `workspace-history`, `workspace-logs`, `logs`).
  - Initializes `exchangeService.initialize()` once on mount via `useExchangeBootstrap()` and subscribes cleanly.
- **Tab Bar (`src/app/(tabs)/_layout.tsx`)**:
  - Uses `expo-router/native-tabs` (`NativeTabs` with `tintColor={palette.themeAccent}` `#F76945` and `disableAutomaticContentInsets` on each trigger) to get the authentic **iOS 26 Liquid Glass** bottom tab bar with SF Symbols (and required `md` fallback symbols):
    1. `index` -> Title: `概览`, SF Symbol: `{ default: 'chart.bar', selected: 'chart.bar.fill' }`, MD: `'bar_chart'`
    2. `accounts` -> Title: `账户`, SF Symbol: `{ default: 'person.2', selected: 'person.2.fill' }`, MD: `'group'`
    3. `usage` -> Title: `用量`, SF Symbol: `{ default: 'gauge.with.dots.needle.33percent', selected: 'gauge.with.dots.needle.67percent' }`, MD: `'speed'`
    4. `settings` -> Title: `设置`, SF Symbol: `{ default: 'gearshape', selected: 'gearshape.fill' }`, MD: `'settings'`
- **Tab Screen Layout Rules**:
  - No `RefreshControl` (pull-to-refresh is strictly disabled on all 4 main tabs).
  - App Store-inspired inline header (`AppStoreTabHeader`) inside the scroll view starting cleanly at `insets.top + 8`: large bold title on the left + circular action button(s) (`themeAccent` `#F76945`) on the right.
  - ScrollView uses `contentInsetAdjustmentBehavior="never"` alongside `disableAutomaticContentInsets` on tab triggers and explicit `paddingBottom: insets.bottom + 84` so content scrolls cleanly under the Liquid Glass tab bar without double top insets or hidden final items.
- **Cloud Native Dev Navigation Flow:**
  - Tapping the `云原生开发-CPU` card on `概览` pushes `workspaces` (up to 5 recent containers per user + `"查看更多"` action per user).
  - Tapping `"查看更多"` pushes `workspace-history` for that account to load paginated older containers.
  - Tapping any container row in either `workspaces` or `workspace-history` pushes `workspace-logs` to inspect the full build summary and stage logs.
- **App Version Retrieval in Expo Go**:
  - Reads `Constants.expoConfig?.version ?? '1.0.0'` so Settings displays the CNB 面板 project version rather than the Expo Go host app binary version.

---

### 3.6 Cloud Native Dev Parser Service (`src/services/workspace-parser/`)

**Purpose:** Read-only service for querying a CNB account's historical "云原生开发" container list and inspecting single-container build logs and stage outputs from `https://cnb.cool`.

**Core API Contract (`WorkspaceParserPort`):**
- `parseWorkspaceList({ username, cookie, page?, pageSize?, status?, slug?, branch? })` -> `Promise<ServiceResult<WorkspaceListSnapshot>>`
- `parseWorkspaceBuildLog({ username, cookie, slug, sn, includeConfig? })` -> `Promise<ServiceResult<WorkspaceBuildLogDetail>>`
- `parseWorkspaceStageLog({ username, cookie, slug, sn, pipelineId, stageId, status? })` -> `Promise<ServiceResult<WorkspaceStageLog>>`

**Interface Boundaries & Constraints:**
- Instantiated by `exchange` via `createWorkspaceParserService(logger: LogReporter)` and emits `V`/`I`/`W`/`E` trace events without ever logging raw cookies or secrets.
- Uses `fetch` with `credentials: 'omit'`, `CNBSESSION` cookie authentication (no `csrftoken` required for read-only `GET`), and exact `Accept: application/json` content negotiation.
- **Account Scope Boundary:** `GET /workspace/list` returns workspaces belonging to the authenticated Cookie owner regardless of `username`; the response explicitly reports `ownerUsername` and `ownerMismatch` so callers can warn users when the configured `username` differs from the Cookie owner.
- **Repository & Retention Boundary:** Build and stage logs (`/{slug}/-/build/...`) are repository-scoped, distinguish container lifecycle (`running`/`closed`) from build result (`pending`/`success`/`failed`), and are subject to CNB's 7-day retention window (`logRetentionDays`).
- **Sanitization Guarantee:** `parseWorkspaceStageLog` returns ANSI-stripped, credential-redacted plain-text lines; `configSummary` exposes structural metadata (`image`, `stages`, `envKeys`) and never exposes `env` values.

---

## 4. Key Engineering Policies & Verification Checklist

1. **Boundary Enforcement (`scripts/check-boundaries.mjs` + ESLint):**
   - Statically parses all `.ts`/`.tsx` imports under `src/`.
   - Fails immediately if `ui` or `app` imports `storage`, `parser`, or `workspace-parser`, or if `storage`/`parser`/`workspace-parser` imports `ui`, `exchange`, `app`, or each other.
   - Also blocks `RefreshControl` in `src/services/ui/screens/` and forbidden glass/blur dependencies (`expo-glass-effect`, `expo-blur`).
2. **English Comment Audit:**
   - All comments (`//` and `/* ... */`) across `src/` must be in English. UI string literals inside JSX/constants are Chinese.
3. **Static Quality Gate (Run After Edits):**
   - `npx tsc --noEmit`
   - `npx eslint . --max-warnings 0`
   - `node scripts/check-boundaries.mjs`
   - Combined shortcut: `npm run verify`
   - Prefer static verification only; avoid dynamic debugging unless strictly unavoidable, and **permanently forbid Expo Web** (`expo start --web` / `expo export --platform web`).
