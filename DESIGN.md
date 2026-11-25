# DESIGN.md — User Interface & Experience Specification

> **App Name:** CNB 面板  
> **Target OS:** iOS 26+ (Expo SDK 58 / Expo Go)  
> **Design Philosophy:** **iOS 26 Liquid Glass Bottom Tab Bar** paired with **pure iOS 18 System Design** across every screen, card, control, and standalone native header (strictly NO Liquid Glass anywhere outside the bottom tab bar).

---

## 1. Visual Language & Platform Rules

1. **Bottom Tab Bar (iOS 26 Liquid Glass Only):**
   - Rendered via `expo-router/native-tabs` (`NativeTabs`), delegating directly to UIKit `UITabBarController` on iOS 26.
   - Four tabs from left to right:
     1. **概览** (`chart.bar` / `chart.bar.fill`)
     2. **账户** (`person.2` / `person.2.fill`)
     3. **用量** (`gauge.with.dots.needle.33percent` / `gauge.with.dots.needle.67percent`)
     4. **设置** (`gearshape` / `gearshape.fill`)
2. **Everything Else (iOS 18 Classic Design — No Liquid Glass):**
   - **Forbidden:** `expo-glass-effect`, `BlurView` floating cards, glass pill buttons in headers, or translucent floating iOS 26 navigation bars.
   - **Used Instead:** Solid iOS 18 grouped canvas (`#F2F2F7` light / `#000000` dark), pure opaque elevated cards & inset grouped rows (`#FFFFFF` light / `#1C1C1E` dark), crisp `0.5pt` hairline separators (`#C6C6C8` light / `#38383A` dark), and iOS 18 system semantic accents.
3. **Safe Area Discipline (Dynamic Island & Home Indicator):**
   - **No Occlusion, No Excessive Top Gap:** Main tab screens do **not** use a separate empty native header bar above custom titles. All four `<NativeTabs.Trigger>` entries set `disableAutomaticContentInsets`, and tab `ScrollView`s use `contentInsetAdjustmentBehavior="never"` so UIKit does not double-apply top insets. The App Store-style title row begins explicitly at `insets.top + 8pt`, sitting immediately below the Dynamic Island / status bar without colliding with it.
   - **Bottom Tab Clearance:** Tab `ScrollView`s apply explicit bottom content padding (`insets.bottom + 84pt`) so cards scroll cleanly above the floating iOS 26 Liquid Glass tab bar without clipping final items.
4. **No Pull-to-Refresh on Main Tabs:**
   - None of the 4 main tabs (`概览`, `账户`, `用量`, `设置`) attach a `RefreshControl`. Data synchronization is triggered explicitly from the `账户` tab or via Settings auto-refresh.
5. **Standalone Pages Use System Native Headers:**
   - Independent pages (`新建账户` / `编辑账户` and `运行日志`) push onto the root `<Stack>` above the tab bar with `headerShown: true`, `headerTransparent: false`, opaque iOS 18 `headerStyle`, native back button, and native right header action button(s).

---

## 2. Design Tokens (iOS 18 Semantic Palette)

| Token | Light Mode | Dark Mode | Usage |
| :--- | :--- | :--- | :--- |
| `bgCanvas` | `#F2F2F7` | `#000000` | Screen grouped background |
| `bgCard` | `#FFFFFF` | `#1C1C1E` | Cards, inset grouped list sections |
| `bgSecondaryFill` | `#E5E5EA` | `#2C2C2E` | Progress track, circular header buttons, segmented bg |
| `textPrimary` | `#000000` | `#FFFFFF` | Large titles, primary metrics, usernames |
| `textSecondary` | `#6C6C70` | `#8E8E93` | Subtitles, timestamps, units |
| `textTertiary` | `#AEAEB2` | `#636366` | Masked cookies, placeholders |
| `separator` | `#C6C6C8` | `#38383A` | 0.5pt hairline dividers |
| `themeAccent` | `#F76945` | `#F76945` | Primary app theme accent (bottom tab bar, header buttons, CTAs, active pills) |
| `accentBlue` | `#007AFF` | `#0A84FF` | `< 60%` usage bar threshold, `I` log badge, Settings clock badge |
| `accentOrange` | `#FF9500` | `#FF9F0A` | Warning banner, `60%–80%` usage bar, `W` log badge |
| `accentRed` | `#FF3B30` | `#FF453A` | Destructive actions, `>= 80%` usage bar, `E` log badge |
| `accentGreen` | `#34C759` | `#30D158` | Sync success status |
| `brandOrange` | `#F76945` | `#F76945` | CNB brand accent (from `logo.svg`) |

### Typography Scale (SF Pro System Defaults)
- **Tab Large Title (App Store Style):** `34pt`, Bold (`700`), tracking `-0.4`
- **Section Header:** `13pt` uppercase/grouped label (`#6C6C70`) or `20pt` Semibold (`600`) card section title
- **Card Title / Row Primary:** `17pt`, Semibold (`600`) / Regular (`400`)
- **Metric Hero Value:** `24pt`–`28pt`, Bold (`700`), `fontVariant: ['tabular-nums']`
- **Secondary / Caption:** `13pt`–`15pt`, Regular (`400`), `fontVariant: ['tabular-nums']`

---

## 3. Quota Progress Bar Specification (Critical Component)

Every quota card (both aggregated on `概览` and per-package on `用量`) renders the unified `QuotaProgressBar` component:

### Calculation Rules
Let:
- `used` = consumed quota (`>= 0`)
- `locked` = optional locked quota (`>= 0`, `0` if absent)
- `total` = total quota (`>= 0`)
- `effectiveUsed = used + locked`
- `ratio = total > 0 ? Math.min(effectiveUsed / total, 1) : 0`
- `percentage = total > 0 ? (effectiveUsed / total) * 100 : 0`
- `usedRatio = total > 0 ? Math.min(used / total, 1) : 0`
- `lockedRatio = total > 0 ? Math.min(locked / total, Math.max(0, 1 - usedRatio)) : 0`

### Color Thresholds (Based on `(used + locked) / total`)
- **`percentage < 60%`**: Blue (`#007AFF` / `#0A84FF`)
- **`60% <= percentage < 80%`**: Orange (`#FF9500` / `#FF9F0A`)
- **`percentage >= 80%`**: Red (`#FF3B30` / `#FF453A`)

### Visual Rendering of Locked Quota (`locked > 0`)
- Track height: `10pt`, `borderRadius: 5`, track background `bgSecondaryFill`.
- **Segment 1 (Used Quota):** Width `usedRatio * 100%`, solid fill using the active threshold color (`Blue` / `Orange` / `Red`).
- **Segment 2 (Locked Quota, appended immediately after Segment 1):** Width `lockedRatio * 100%`, visually distinct from Segment 1:
  - Uses a darkened shade of the active threshold hue (`#004C9E` for `< 60%`, `#AD5B00` for `60%–80%`, `#A81B14` for `>= 80%`) with no top/bottom/right borders, separated from Segment 1 by a `1.5pt` `bgCard` left divider when `used > 0`.
  - Overlaid with crisp 45° diagonal white stripes (`rgba(255, 255, 255, 0.38)`) drawn via `react-native-svg` `<Line>` primitives sized dynamically from the segment's `onLayout` pixel width so stripes always span the full locked segment width.
  - Below the bar, a matching `9×9pt` dark-striped legend swatch accompanies `锁定 <value> <unit>`.
- When `locked` is absent or `0`, Segment 2 and the locked legend item are omitted cleanly.

---

## 4. App Store-Style Tab Header Specification

Used at the top of `概览`, `账户`, `用量`, and `设置`:
- Layout: Horizontal flex row (`justifyContent: 'space-between'`, `alignItems: 'center'`), `paddingTop: insets.top + 8`, `paddingHorizontal: 16`, `paddingBottom: 12`.
- Left: Bold `34pt` title (`概览` / `账户` / `用量` / `设置`), with optional subtle subtitle directly above or below only if appropriate (keep clean like App Store Today/Apps).
- Right: Clean iOS 18 circular action button(s) (`36x36pt` circle in `bgCard` with subtle `hairlineWidth` border and shadow, SF Symbol `18pt` in `themeAccent` `#F76945`) aligned to the Large Title baseline:
  - **概览:** Quick-jump circular button (`person.2.fill`) to `账户` when accounts exist (hidden when empty).
  - **账户:** Two crisp circular buttons (`gap: 10`): **一键同步** (`arrow.triangle.2.circlepath`) and **新建账户** (`plus`).
  - **用量:** Quick-jump circular button (`person.2`) to `账户` when accounts exist.
  - **设置:** Clean title-only header (matching iOS Settings / App Store profile minimalism).

---

## 5. Screen-by-Screen Layout & Interaction Design

### 5.1 概览 (Overview Tab — `index`)
1. **Empty State (No Accounts):**
   - Centered iOS 18 grouped card with SF Symbol (`person.crop.circle.badge.plus` in `themeAccent` `#F76945`), concise message: *"暂无 CNB 账户"* and *"请先前往“账户”页面新建账户信息，即可汇总查看 AI Credits、云原生构建与开发 CPU 剩余用量。"*, plus a solid `#F76945` (`themeAccent`) iOS 18 rounded button: **前往“账户”新建**.
2. **Populated State (>= 1 Account):**
   - **Stale Data Warning Banner (Conditional):** Displayed at the top if **any** account has never synced or `now - lastSyncedAt > 1 hour`.
     - Soft iOS 18 warning card (`#FFF5E5` light / `#2B2010` dark, `1pt` border `#FF9500`), SF Symbol `exclamationmark.triangle.fill`, copy: *"有 N 个账户用量超过 1 小时未更新"* / *"请前往“账户”页面刷新最新用量数据。"*, with inline **去刷新** link button navigating to `账户`.
   - **Summary Overview Cards (3 Vertical Cards):**
     1. **AI Credits** (icon: `sparkles`, unit: `Credits`)
     2. **云原生构建-CPU** (icon: `hammer.fill`, unit: `核时`)
     3. **云原生开发-CPU** (icon: `cpu.fill`, unit: `核时`)
   - Each card displays:
     - Header: Metric icon + title + package count on the left; `剩余可用` value + unit in bold tabular numerals on the right.
     - `QuotaProgressBar` + overall percentage (`XX.X%`).
     - 3-column footer metrics: **总额度** | **已用额度** | **锁定额度**.

---

### 5.2 账户 (Accounts Tab — `accounts`)
1. **Header Right Actions (App Store Style):**
   - **一键同步** button (`arrow.triangle.2.circlepath`): Syncs all accounts via Exchange; shows subtle spinner while running and toast/banner summary on completion.
   - **新建** button (`plus`): Pushes standalone `account-editor` page (`mode: 'create'`).
2. **Account List (iOS 18 Inset Grouped Cards):**
   - Each account row displays:
     - **Avatar:** `44x44pt` circle with deterministic pastel/brand tint background and the **first character of `username`** centered in bold white (`18pt`).
     - **Primary Info:** `username` (`17pt` semibold) + optional `remark` pill/subtitle (`13pt` secondary).
     - **Masked Cookie:** Monospace `12pt` tertiary label showing first 6 chars + `••••` + last 4 chars (gracefully shortened for short strings).
     - **Sync Timestamp:** Relative/formatted time (e.g., `最后更新：10:35` or `未同步` with orange dot if > 1h).
     - **Row Actions:** Trailing edit button (chevron / `pencil` pushing `account-editor` in `edit` mode) and delete button (`trash` in red `#FF3B30`, triggering native `Alert.alert` confirmation).
3. **Empty State:** Prompts tapping `+` to add the first account.

---

### 5.3 用量 (Usage Tab — `usage`)
1. **Top Horizontal User Switcher (Page Control):**
   - Horizontal scrollable bar (`ScrollView horizontal`, `showsHorizontalScrollIndicator={false}`) of pill buttons, one per stored account (avatar initial + `username`).
   - Selecting a pill highlights it (`themeAccent` `#F76945` fill with white text) and switches the active user page (synchronized with a horizontal paging `FlatList` so users can either tap pills or swipe pages).
2. **Metric Segmented Switcher (iOS 18 Style with Icons & Animation):**
   - Directly below user selector inside each user page: iOS 18 3-segment control (`#E5E5EA` / `#2C2C2E` track with an `Animated.spring` sliding elevated thumb `#FFFFFF` / `#636366`):
     - `AI Credits` (left icon: `sparkles`)
     - `构建-CPU` (left icon: `hammer.fill`)
     - `开发-CPU` (left icon: `cpu.fill`)
   - Active tab icon uses `textPrimary` (deep black `#000000` in light mode); inactive tab icons use `textSecondary`. Switching tabs also triggers a smooth `200ms` fade + vertical slide transition on the metric content below.
3. **Quota Package List (Per User & Selected Metric):**
   - Displays a summary header line (full metric name e.g. `云原生构建-CPU · N 个额度包（核时）` + last sync timestamp) followed by individual package cards (`#FFFFFF`, `16pt` radius):
     - Package name (`免费配额`, `高校师生专属特权`, etc.) + remaining value (`剩余 ...`).
     - `QuotaProgressBar` with threshold color & dark diagonal-striped locked bar (if `locked > 0`).
     - Breakdown grid: **总额度** / **已用** / **已锁定** (only rendered when package has `locked !== undefined && locked > 0`).
   - If the selected user has not synced yet, displays an iOS 18 empty card prompting sync on the `账户` tab.

---

### 5.4 设置 (Settings Tab — `settings`)
Pure iOS 18 System Settings Inset Grouped List style, ordered strictly from top to bottom:
1. **Section 1 — 应用信息:**
   - Row 1: `App 版本` — trailing value `v1.0.0` (from `Constants.expoConfig.version`)
   - Row 2: `当前系统时间` — trailing live-updating value (`YYYY-MM-DD HH:mm:ss`, tabular numerals)
2. **Section 2 — 刷新策略:**
   - Row 1: `启用应用时后台自动刷新用量` — trailing iOS `<Switch>`
   - Row 2: `自动刷新` — trailing iOS `<Switch>`
   - Row 3: `自动刷新间隔` — trailing `−` / `N 分钟` / `＋` stepper controls (`±5` min on tap, `±1` min on long press, 1–1440 min range; visually dimmed when `自动刷新` is off)
3. **Section 3 — 诊断日志:**
   - Row 1: `运行日志 (Log)` — trailing `查看 >` disclosure indicator; pushes standalone `logs` page
4. **Section 4 — 数据清理:**
   - Row 1: `清除缓存和 Log 数据` — centered destructive red (`#FF3B30`) button; shows native iOS `Alert.alert` confirmation before clearing usage cache & all logs (accounts and settings remain intact).

---

### 5.5 新建 / 编辑账户独立页面 (`account-editor`)
- **Navigation Header:** System native `<Stack>` header (`headerShown: true`, opaque iOS 18 style, `headerTransparent: false`, `headerTintColor: themeAccent` `#F76945`, title `"新建账户"` or `"编辑账户"`, native back button, right native `"保存"` button).
- **Form (iOS 18 Inset Grouped Form):**
  1. **用户名 (`username`)**:
     - Create mode: editable `TextInput`, autoCapitalize `"none"`, autoCorrect `false`.
     - Edit mode: read-only locked row (`editable={false}`) with subtle lock icon & hint *"不可更改"*.
  2. **Cookie (`cookie`)**:
     - Multi-line `TextInput` (`minHeight: 112`), monospace font, plus `从剪贴板粘贴` button.
  3. **备注 (`remark`, 可选)**:
     - Single-line `TextInput`, placeholder `"例如：个人主力号 / 高校特权组织"`.
- **Validation Feedback:** Inline red alert banner or native alert for missing `username`/`cookie` or duplicate `username`.

---

### 5.6 Log 独立页面 (`logs`)
- **Navigation Header:** System native `<Stack>` header (`headerShown: true`, opaque iOS 18 style, `headerTintColor: themeAccent` `#F76945`, title `"运行日志"`).
  - Right native header actions: Toggle **选择模式** (`选择` / `完成`) and **复制全部** (`复制全部`).
- **Filter Strip (iOS 18 Bar below header):**
  - Level filter pills: `全部` (`themeAccent` `#F76945` when active), `V`, `I`, `W`, `E` with distinct semantic badge colors:
    - `V` (Verbose): `#8E8E93` Gray
    - `I` (Info): `#007AFF` Blue
    - `W` (Warning): `#FF9500` Orange
    - `E` (Error): `#FF3B30` Red
  - Search input (`搜索操作、消息或详情`) directly below the level pills.
- **Log List & Selection Copy:**
  - Displays timestamp (`HH:mm:ss.SSS`), level pill (`V`/`I`/`W`/`E`), service source (`UI`/`Storage`/`Parser`/`Exchange`), action, and message/details (`selectable` text).
  - **Partial Copy:** Entering selection mode shows iOS circular checkboxes on each log row; a bottom action bar appears showing `"已选 N 条"` + **复制所选** button (`expo-clipboard`). Users can also long-press any single log entry to copy that entry immediately.
  - **Copy All:** Tapping **复制全部** copies all currently filtered/loaded formatted logs to the system clipboard with haptic + visual confirmation.
