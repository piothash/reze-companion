# 08 — Risk

## Class: `RiskManager` (`lib/v2/engine/risk.ts`, 283 LOC)

The **single mandatory gate** in front of every order placement. Both order-producing paths (strategy engine and Standing Limit Order) MUST call `checkOrder()` before `executor.placeOrder()` (`risk.ts:1-20`).

## Checks (in order)

1. **Kill switch** — operator- or breaker-engaged, persisted in KV (`risk:killswitch`).
2. **Daily loss limit** — realized PnL for the current UTC day. Breach → auto-engage kill switch with `source="BREAKER"` (circuit breaker).
3. **Order notional cap** — `price × shares ≤ maxOrderNotionalUsd`.
4. **Daily order cap** — bounds total daily SUBMITTED events (runaway-loop guard).
5. **Price sanity** — inside `[0.01, 0.99]` and tick-aligned to `TICK_SIZE=0.01`.
6. **Share sanity** — integer shares within `[1, maxSharesPerOrder]`.
7. **Expiry guard** — refuse new orders for an already-expired slot.

## Default limits (`risk.ts:70-76`)

| Limit | Default |
|-------|---------|
| `maxDailyLossUsd` | 100 |
| `maxOrderNotionalUsd` | 500 |
| `maxDailyOrders` | 2000 |
| `maxSharesPerOrder` | 1000 |

`maxDailyOrders=2000` is intentionally high — it is a runaway-loop guard, not a business limit. See rationale in `risk.ts:58-68`: the SLO alone submits up to 288 orders/day (one per 5-minute window), plus cancel-replace churn from the strategy engine. The previous default of 300 was silently hit within a single day of healthy trading.

## Persistence

- `risk:limits` — the four limit values (KV).
- `risk:killswitch` — `{engaged, reason, atMs, source}` (KV).
- Daily aggregates read via `dailyOrderSubmissions` and `dailyRiskStats` from `db.ts`.

## Migration

`risk:migration:daily-order-cap-2000` is a KV flag ensuring the 300→2000 bump is applied exactly once, preserving any operator override made after migration.

## Kill switch semantics

- Engage: `engageKillSwitch(reason?)` (`engine.ts:591`) — hard stops all new order placement and cancels resting orders on next tick.
- Disengage: only if engine is healthy (`engine.ts:610`).
- Persisted, so a restart with an engaged kill switch stays engaged.

## Notification

Breaches route through `notifier.ts` (`risk.ts:26`), which owns Telegram alerting via `telegram.ts`.
