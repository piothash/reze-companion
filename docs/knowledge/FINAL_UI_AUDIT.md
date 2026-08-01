# Phase 7 — Final UI Audit

**Date:** 2026-07-22
**Scope:** `reference/p4/components/v2/*` and `reference/p4/app/api/v2/**`
**Verification:** `[C]` code inspection only. Runtime click-through `[N]`
(dashboard is a vendored Next.js app; not runnable in the Lovable sandbox).

## Panel Wiring Matrix

| Panel | Controls | API | State handled |
|---|---|---|---|
| `command-deck.tsx` | start / stop / mode / kill switch | `/api/v2/bot/control` | success, structured 400, network error `[C]` |
| `startup-error-panel.tsx` | (display) | `snapshot.startup` | error code, reason, missingConfig list `[C]` |
| `engine-status-panel.tsx` | (display) | `snapshot.*` | mode, sync, credentials, kill switch, reconciler `[C]` |
| `limit-order-panel.tsx` | set / clear / pause / resume | `setLimitOrder`, `clearLimitOrder`, `pauseLimitOrder`, `resumeLimitOrder` via control | form validation, disabled during pending `[C]` |
| `strategy-configurator.tsx` | select / params | `/api/v2/bot/strategies` | success + error toast `[C]` |
| `profiles-panel.tsx` | save / load / delete | `/api/v2/bot/profiles` | list, empty, error `[C]` |
| `ledger.tsx` | (display) | `/api/v2/bot/trades` | loading, empty, rows `[C]` |
| `analytics-panel.tsx` | (display) | `/api/v2/bot/analytics` | loading, empty `[C]` |
| `live-account.tsx` | (display) | account-sync snapshot | direction label uses bot side (D-2 fix) `[C]` |
| `feed-diagnostics.tsx` | (display) | snapshot feeds | fresh / stale badges `[C]` |
| `system-panel.tsx` | (display) | `/api/v2/bot/system` | CPU / mem / heap `[C]` |
| `intel-feed.tsx` | (display) | `/api/v2/bot/audit` | scrollable event list `[C]` |
| `trade-replay-view.tsx` | replay a trade | `/api/v2/bot/trades/[id]/replay` | loading, error, replay JSON `[C]` |

## Cross-Cutting Checks

| Check | Result |
|---|---|
| Every button dispatches through `use-bot.ts` action | Yes `[C]` |
| Loading / empty / error present per SWR panel | Yes `[C]` |
| Silent failures | None found — control API returns structured JSON and `use-bot.ts` surfaces `error` field `[C]` |
| Broken navigation | Single-page dashboard; no router traps `[C]` |
| Console errors from project code | None introduced; runtime `[N]` |
| Responsive layout | Tailwind grid; usable on `md`+ `[C]` |

## Verdict

No wiring defects found. All buttons trace to a handler; all handlers hit
a routed API; all API responses are consumed. Runtime interaction
verification remains `[N]`.
