# CNB 面板 (`m20.cnb.panel`)

An iOS 26+ utility app built with **Expo SDK 58** and **Expo Go** to manage multiple CNB accounts, monitor remaining **AI Credits**, **云原生构建-CPU**, and **云原生开发-CPU** quotas, and inspect **云原生开发** container history and build logs.

---

## Key Features

- **Multi-Account Management:** Add, edit (cookie & remark), delete, and one-tap sync multiple CNB accounts with per-account sync status badges (`更新成功` / `更新失败` / `更新中` / `待更新`) and detailed failure reason alerts.
- **Overview Dashboard:** Aggregated remaining, total, used, and locked quota statistics across all accounts, with automatic 1-hour staleness alerts; tapping the **云原生开发-CPU** card drills into container history.
- **Detailed Per-User Quota Breakdown:** Horizontal per-user pages and animated icon metric tabs (`AI Credits`, `构建-CPU`, `开发-CPU`) showing individual quota packages (e.g. free tier, student perks) with threshold-colored progress bars (`<60%` Blue, `60%–80%` Orange, `>=80%` Red) and dark diagonal-striped locked-quota segments.
- **Cloud Native Dev History & Build Logs:** Entered from the **云原生开发-CPU** card on `概览`, showing up to 5 recent containers per user with **查看更多** pagination for full history, and tapping any container opens its complete build summary and sanitized stage log output.
- **Settings & Auto-Refresh:** App version & live system time, background refresh on app activation, configurable interval auto-refresh (minutes), optional foreground cleanup of expired local logs with a 1–720 hour retention setting, cache/log reset, and an isolated Log viewer supporting partial and full clipboard export.

---

## Architecture Summary

The codebase enforces strict separation across five independent services (see [AGENTS.md](./AGENTS.md) for full details and [DESIGN.md](./DESIGN.md) for UI/UX specifications):

1. **User Interface Service (`src/services/ui/` + `src/app/`):** Expo Router `NativeTabs` (iOS 26 Liquid Glass bottom tab bar) with iOS 18 styling on all screens, App Store-style tab headers, and native stack headers for standalone pages.
2. **Information Storage Service (`src/services/storage/`):** Hybrid `expo-sqlite` + `expo-secure-store` table/key/value persistence.
3. **Usage Parser Service (`src/services/parser/`):** Takes `{ username, cookie }`, verifies the CNB session (`GET /user`), discovers organizations (`/user/groups` or `/u/{username}/groups`), parses `/{org}/-/settings/charge` `__NEXT_DATA__` SSR data (with sub-org root fallback), converts milli-credits and CPU-seconds to `Credits` / `核时`, and allocates sequential packs and pre-frozen quotas.
4. **Update Exchange Service (`src/services/exchange/`):** Central mediator, validator, auto-refresh scheduler, foreground log-cleanup scheduler, and independent SQLite-backed `V/I/W/E` Log subsystem.
5. **Cloud Native Dev Parser Service (`src/services/workspace-parser/`):** Read-only parser exposing interfaces for listing historical "云原生开发" containers (`GET /workspace/list`) and inspecting single-container build summaries, configuration structure (env key names only), and sanitized stage log outputs (`GET /{slug}/-/build/...`).

> `UI`, `Storage`, `Parser`, and `Workspace Parser` never import or invoke one another directly; all communication passes through `Exchange`.

---

## Quick Verification Commands (For Humans & Agents)

> **Important:** Primary target platform is **iOS 26+ in Expo Go** (with **Android** relaxed for Windows real-device Expo Go debugging). Never launch or debug with Expo Web.

```bash
# TypeScript, ESLint, and service-boundary checks (combined)
npm run verify

# Start Expo Go dev server for real-device QR debugging on Windows (no --web)
npm start
```
