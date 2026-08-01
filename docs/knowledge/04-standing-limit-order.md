# 04 — Standing Limit Order (SLO)

## Purpose

An independent order manager, decoupled from the tick-loop strategy engine, that maintains a persistent user-configured maker limit order across many slots. Implemented in `StandingOrderManager` (`lib/v2/engine/standing-order.ts`, 2489 LOC).

## Independence from the strategy engine

- Runs on its own clock inside `standing-order.ts` (not driven by `Engine.tick()`).
- Has its own risk gate integration and its own cancel-replace pipeline.
- The `Engine` holds a reference (`engine.ts:151`) purely to `snapshot()` its state and to route `setLimitOrder/pauseLimitOrder/...` commands.
- Both paths share the same `Executor` and go through the same `RiskManager.checkOrder` gate.

## Lifecycle states

`ARMED → TRIGGERED → RESTING → FILLED` (with side-transitions to `CANCELLED`, `EXPIRED`, and `PAUSED`). The trigger evaluates whether the SLO's price/side is currently postable given live book state and phase constraints.

## Configuration surface

Exposed via `engine.setLimitOrder(...)` (`engine.ts:552`), `clearLimitOrder()` (573), `pauseLimitOrder()` (577), `resumeLimitOrder()` (581). Parameters include side (`UP`/`DOWN`), limit price, share count (exact — not compounding), and TIF.

## Sizing

SLO uses **fixed-size debits**, unlike the strategy path's compounding all-in model. See `bankroll.ts` — `commitFill` zeros the bankroll and rolls remainder to dust, whereas the SLO simply deducts `cost` from the pool.

## Safeguards

- **Stuck-RESTING guard** — if a resting SLO is externally cancelled/filled, the manager detects the mismatch on next poll (uses `executor.getOrderState`, `executor.ts:60`) and re-arms.
- **Duplicate-order safety** — cancel-replace verifies the old order is `DEAD` or `MATCHED` before posting a replacement (`live.ts:169-190` and mirrored in `paper.ts:256-273`).
- **Risk-gated** — every placement passes through `RiskManager.checkOrder` (`risk.ts`).
- **Reconciler visibility** — tracked SLO order ids are reported to the reconciler so they are NOT flagged as untracked.

## Interaction with the strategy engine

- Both may hold orders at the same time on different sides/prices.
- Rollover (`engine.ts:669`) coordinates so the strategy engine's `cancelAllOrders()` does not orphan the SLO — the SLO manager re-arms after purge if still configured.
