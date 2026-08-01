# 02 — Dashboard

## Framework

Next.js 14 App Router, TypeScript, Tailwind. Dashboard lives under `app/v2/` and reusable panels under `components/v2/`.

## Pages

- `app/page.tsx` — root redirect / landing.
- `app/login/page.tsx` — dashboard login form (`components/login-form.tsx`).
- `app/v1/page.tsx` — legacy V1 dashboard (kept for historical comparison).
- `app/v2/page.tsx` — the main operator console.

## Auth

- Login route: `app/api/auth/login/route.ts`. Logout: `app/api/auth/logout/route.ts`.
- Session + CSRF enforced by root middleware in `proxy.ts` (Next middleware / `middleware.ts` equivalent).
- API auth helpers live in `lib/v2/engine/api-auth.ts` and `dashboard-auth.ts`.

Server-side rule: every state-changing API route must go through `api-auth.ts` before calling into the engine.

## API surface (`app/api/v2/bot/`)

| Route | Purpose |
|-------|---------|
| `status/route.ts` | Returns `engine.snapshot()` for polling by the dashboard |
| `control/route.ts` | Start/stop, mode, strategy, params, kill switch, bands, drift padding, TIF, price range, limit order set/clear/pause/resume, reset ledger |
| `strategies/route.ts` | List + configure strategies |
| `profiles/route.ts` | Named parameter presets |
| `analytics/route.ts` | Aggregations (win rate, PnL curve, latency stats) |
| `trades/route.ts` | Paged ledger reads |
| `trades/[id]/replay/route.ts` | Per-trade replay for `trade-replay-view` |
| `audit/route.ts` | Structured audit log |
| `notifications/route.ts` | Alert stream |
| `preflight/route.ts` | Preflight/config sanity checks |
| `database/route.ts` | DB introspection for support |
| `health/route.ts` | Liveness probe |
| `system/route.ts` | CPU/mem/heap sampling |

## Panels (`components/v2/`)

- `terminal-dashboard.tsx` — top-level layout composing all panels.
- `top-nav.tsx` — nav + connection state.
- `command-deck.tsx` — start/stop, mode switch, kill switch controls.
- `strategy-configurator.tsx` — strategy select + parameters.
- `profiles-panel.tsx` — save/load parameter presets.
- `limit-order-panel.tsx` — arm/pause/resume the Standing Limit Order.
- `market-monitor.tsx` — current slot, phase, strike, spot, bands.
- `ledger.tsx` — trade history table.
- `intel-feed.tsx` — structured `logEvent` stream.
- `live-account.tsx` — mirror of on-exchange orders/trades/balance.
- `analytics-panel.tsx` — win rate, PnL, latency histograms.
- `feed-diagnostics.tsx` — feed staleness, WS state, spot vs oracle drift.
- `system-panel.tsx` — CPU/mem/heap.
- `trade-replay-view.tsx` — per-trade tick-by-tick replay.
- `use-bot.ts` — React hook that polls `/api/v2/bot/status`.

## Update pattern

Client polls `status` on an interval; mutation routes return the freshly-computed message string produced by the corresponding engine method (`start()` returns "…" etc., see `engine.ts:309,374,449,467`).
