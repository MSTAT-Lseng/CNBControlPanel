# CNB 面板 (`m20.cnb.panel`)

An iOS 26+ utility app built with **Expo SDK 58** and **Expo Go** to manage multiple CNB accounts and monitor remaining **AI Credits**, **云原生构建-CPU**, and **云原生开发-CPU** quotas.

---

## Key Features

- **Multi-Account Management:** Add, edit (cookie & remark), delete, and one-tap sync multiple CNB accounts.
- **Overview Dashboard:** Aggregated remaining, total, used, and locked quota statistics across all accounts, with automatic 1-hour staleness alerts.
- **Detailed Per-User Quota Breakdown:** Horizontal per-user pages and metric tabs showing individual quota packages (e.g. free tier, student perks) with threshold-colored progress bars (`<60%` Blue, `60%–80%` Orange, `>=80%` Red) and appended locked-quota segments.
- **Settings & Auto-Refresh:** App version & live system time, background refresh on app activation, configurable interval auto-refresh (minutes), cache/log reset, and an isolated Log viewer supporting partial and full clipboard export.

---

## Architecture Summary

The codebase enforces strict separation across four independent services (see [AGENTS.md](./AGENTS.md) for full details and [DESIGN.md](./DESIGN.md) for UI/UX specifications):

1. **User Interface Service (`src/services/ui/` + `src/app/`):** Expo Router `NativeTabs` (iOS 26 Liquid Glass bottom tab bar) with iOS 18 styling on all screens, App Store-style tab headers, and native stack headers for standalone pages.
2. **Information Storage Service (`src/services/storage/`):** Hybrid `expo-sqlite` + `expo-secure-store` table/key/value persistence.
3. **Usage Parser Service (`src/services/parser/`):** Takes `{ username, cookie }` and returns structured quota data (currently randomized mock data; real CNB endpoint parsing will be implemented later).
4. **Update Exchange Service (`src/services/exchange/`):** Central mediator, validator, auto-refresh scheduler, and independent SQLite-backed `V/I/W/E` Log subsystem.

> `UI`, `Storage`, and `Parser` never import or invoke one another directly; all communication passes through `Exchange`.

---

## Quick Verification Commands (For Humans & Agents)

> **Important:** Target platform is **iOS 26+ in Expo Go** only. Never launch or debug with Expo Web.

```bash
# TypeScript static check
npx tsc --noEmit

# Lint & service-boundary check
npx eslint .
node scripts/check-boundaries.mjs

# Start Expo dev server for iOS Expo Go (no --web)
npx expo start --ios
```
