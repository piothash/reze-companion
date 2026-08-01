# 03 — Trading Engine

## Class: `Engine` (`lib/v2/engine/engine.ts`, 1551 LOC)

The engine is a single long-lived object stored on `globalThis` (`engine.ts:1540`). All state is in-process; durable state is copied through KV/SQLite.

## Core state (fields)

| Field | Line | Role |
|-------|------|------|
| `spotFeed` | 81 | BTC reference feed |
| `clobPriceFeed` | 82 | Best-ask per side |
| `discovery` | 83 | Rolling market discovery |
| `market` | 84 | Currently-armed `DiscoveredMarket` |
| `executor` | 85 | Live or Paper `Executor` |
| `loop` | 86 | `setInterval` handle for the tick loop |
| `busy` | 87 | Reentrancy guard on `tick()` |
| `accountSync` | 92 | Dashboard mirror pump |
| `slotEndMs` | 94 | Current slot end time (UTC ms) |
| `strike` | 95 | Slot strike price |
| `rolloverState` | 109 | `"LIVE" \| "ROLLING_OVER"` |
| `openOrder` | 112 | Currently-tracked resting order (strategy path) |
| `position` | 113 | Filled position awaiting settlement |
| `pendingResolutions` | 116 | Slots waiting for oracle resolution |
| `standingOrders` | 151 | `StandingOrderManager` (SLO) |
| `reconciler` | 130 | Reconciler with dependency injection |

## Phases (`types.ts:18-24`)

`OFFLINE`, `WAITING`, `PRIORITY_1`, `PRIORITY_2`, `STOPPING`.

Timing (from `types.ts` and `config.ts`):
- `PRIORITY_1`: T-20s → T-11s
- `PRIORITY_2`: T-10s → T-3s
- `STOPPING`: T-2s → T-0s (no new orders; cleanup only)

## Public control API

All are called by the dashboard through `app/api/v2/bot/control/route.ts`. Each returns a human-readable status string.

| Method | Line | Notes |
|--------|------|-------|
| `start()` | 309 | Boots feeds, arms market, starts tick loop, reconciler, SLO |
| `stop()` | 374 | Persists `v2:engine:running=false`; graceful teardown |
| `dispose()` | 405 | Full cleanup, used on hot reload |
| `setMode(mode)` | 449 | PAPER ↔ LIVE; rebuilds executor |
| `setPaperBalance(amount)` | 467 | Reset paper bankroll |
| `setBands(p1, p2)` | 475 | Per-phase price acceptance bands |
| `setDriftPadding(usd)` | 486 | Extra USD gap spot must clear over strike |
| `setTif(tif)` | 492 | `"1m" | "2m" | "GTC"` |
| `setP1Window(ms)` | 500 | Override PRIORITY_1 duration |
| `setPriceRange(floor, ceil)` | 510 | Hard price acceptance range |
| `setStrategy(id)` | 519 | Swap strategy id from registry |
| `setStrategyParams(id, params)` | 537 | Update strategy params |
| `setLimitOrder(...)` | 552 | Configure Standing Limit Order |
| `clearLimitOrder()` | 573 | Remove SLO configuration |
| `pauseLimitOrder()` / `resumeLimitOrder()` | 577 / 581 | SLO gating |
| `engageKillSwitch(reason?)` | 591 | Hard stop, persisted |
| `disengageKillSwitch()` | 610 | Only if healthy |
| `setRiskLimits(limits)` | 616 | Partial risk limit update |
| `resetLedger()` | 626 | Ledger nuke (paper-only guardrails) |

## Tick loop (`tick()`, engine.ts:855)

Called by `setInterval(loop, LOOP_MS)`. Guarded by `busy` (`engine.ts:87`) to prevent re-entry. Broad shape:

1. Refresh clocks and compute current `EnginePhase` from `slotEndMs`.
2. If we crossed the slot boundary → `settleSlot()` and roll over.
3. If rollover pending → try `tryExitRollover()` (`engine.ts:669`) — waits until discovery has the next market, book depth ≥ threshold, and oracle-sync guard clears.
4. Read fresh spot from `freshSpot()` — rejected if older than `SPOT_STALE_MS` (10s, `engine.ts:837`).
5. Compute `fairFor(side)` (`engine.ts:846`), consult the active strategy, and either `quote()` (`engine.ts:1050`) or `reprice()` (`engine.ts:1101`) via the executor.
6. Poll `executor.checkFill(openOrder)`; on fill call `onFill()` (`engine.ts:1153`) to book position.

## Order flow (strategy path)

```
Strategy.decide → quote() → risk.checkOrder → executor.placeOrder → openOrder tracked
              │            (RiskVerdict)
              └──► reprice() (cancel-replace pipeline) on price move
```

## Rollover

- Enters `ROLLING_OVER` at slot end (`engine.ts:109-111`).
- `cancelAllOrders()` on the executor (live-only path) purges any stragglers.
- `tryExitRollover()` gates re-entry on fresh discovery + oracle sync + book depth.

## Snapshot (`engine.ts:1388`)

Produces the single JSON blob the dashboard reads. It composes: phase, slot info, strategy id/params, openOrder, position, reconciler.latest, risk snapshot, SLO snapshot, latency stats, feed health, and account mirror.

## Recovery

- `maybeAutoResume()` (`engine.ts:247`) resumes if KV `v2:engine:running=true` at boot.
- Config re-hydrated in `restoreConfig()` (`engine.ts:260`).
- Any `OPEN` trade rows from before the crash are SCRATCHed with cost refunded to the bankroll in `db.ts:scratchOrphanedOpenRows` (`db.ts:157`).
