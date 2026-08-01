# 00 — System Overview

## What P4 is

An autonomous market-maker / directional-trading bot for Polymarket's rolling 5-minute BTC price markets. It runs as a long-lived Node.js process managed by PM2 with a Next.js 14 dashboard for observability and control.

## What it trades

- **Instrument:** Polymarket CLOB V2 binary outcome tokens for the current 5-minute BTC "will price go UP or DOWN" market.
- **Order style:** Post-only maker limit orders (`POST_ONLY = true`, `lib/v2/engine/execution/live.ts:33`).
- **Sides:** `UP` or `DOWN` only (`lib/v2/engine/types.ts:26`).

## Two independent trading subsystems

1. **Strategy Engine** — time-windowed, phase-driven (`PRIORITY_1`, `PRIORITY_2`, `STOPPING`) tick loop that quotes and reprices maker orders based on a pluggable strategy from the registry (`lib/v2/engine/engine.ts:855` `tick()`).
2. **Standing Limit Order (SLO)** — an independent trigger-based system that manages a persistent user-configured limit order across slots. Runs on its own clock inside `StandingOrderManager` (`lib/v2/engine/standing-order.ts`).

## Modes

- **PAPER_V1** — full engine + simulated exchange with chaos injection (`lib/v2/engine/execution/paper.ts:82`).
- **LIVE_V2** — real Polymarket CLOB V2 via `@polymarket/clob-client-v2` with EIP-712 order signing and HMAC API auth (`lib/v2/engine/execution/live.ts:65`).

Both implement one `Executor` contract (`lib/v2/engine/execution/executor.ts:42`), so strategy code never sees which mode it is in.

## Key numbers

- Tick loop cadence: `LOOP_MS` (see `lib/v2/engine/engine.ts`, config in `lib/v2/engine/config.ts`).
- Phase timings: `PRIORITY_1` T-20s→T-11s, `PRIORITY_2` T-10s→T-3s, `STOPPING` T-2s→T-0s (`lib/v2/engine/types.ts:18-24`).
- Default drift padding: $12 (`lib/v2/engine/config.ts`, `driftPaddingUsd`).
- Min shares: 5 (Polymarket floor guard, `config.ts`).
- Reconciler cadence: 60s (`lib/v2/engine/reconciler.ts:29`).
- Default risk limits: `maxDailyLossUsd=100`, `maxOrderNotionalUsd=500`, `maxDailyOrders=2000`, `maxSharesPerOrder=1000` (`lib/v2/engine/risk.ts:70-76`).

## Persistence

Single SQLite file (`better-sqlite3`, WAL mode, `synchronous=NORMAL`) at `env.DB_PATH` (`lib/v2/engine/db.ts:76-84`). Tables: `trades`, `order_log`, `audit_log`, `kv`.
