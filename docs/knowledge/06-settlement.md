# 06 — Settlement

## Slot end

Called from `tick()` when the current time crosses `slotEndMs`. Entry point: `settleSlot()` (`engine.ts:1189`).

Sequence:
1. Enter `ROLLING_OVER` (`engine.ts:109`).
2. Purge any resting orders on the executor via `cancelAllOrders()` (LIVE_V2/PAPER_V1 both implement).
3. If there is a filled `position`, call `settleOfficial(pos, fallbackWinner)` (`engine.ts:1221`).
4. Record the settlement (`recordSettlement`, `engine.ts:1272`).

## Winner resolution

`settleOfficial()` (`engine.ts:1221`) prefers the official market resolution (from CLOB / condition metadata), falling back to `computeSpotFallback()` (`engine.ts:1263`) which uses the BTC reference feed's price at slot end vs strike.

Rules:
- WIN → payout = `shares * 1.00` — credited back to bankroll and (paper) to the sim wallet via `Executor.creditSettlement(usd)`.
- LOSS → nothing credited; PnL = `-cost`.
- SCRATCH → cost refunded to bankroll and to sim wallet; PnL = 0.

## Deferred / pending resolutions

`pendingResolutions` counter (`engine.ts:116`) tracks slots waiting for the official oracle to publish. The settlement verifier and repair modules (see Reports 09 and 15) cross-check and can rewrite historical rows if the oracle later contradicts the initial call.

## Persistence

Settlement writes to the `trades` table (`db.ts:87-102`) with columns including `result`, `pnl`, `balance_after`, `dust_saved`, `mode`, and a JSON `explanation`. Status transitions: `OPEN` → `SETTLED` (see the migration in `db.ts:141-155`).

## Boot-time SCRATCH sweep

Any row still `OPEN` at boot (crash during a live position) is SCRATCHed **with cost refunded** to the bankroll — `db.ts:scratchOrphanedOpenRows` (`db.ts:174-206`). This exists because closing them with `pnl=0` but WITHOUT the refund silently destroyed money on every restart with an open position — comment in `db.ts:160-166` documents the historical bug.

## Settlement verification and repair

- `settlement-verifier.ts` (291 LOC) — cross-checks the recorded winner against oracle truth for recently-settled rows.
- `settlement-repair.ts` (219 LOC) — retroactively corrects mis-settled rows: reverses the wrong credit/debit and books the correct one, all through the bankroll so the ledger sum stays consistent.

## Historical data fix

One-time patch in `db.ts:169-172`: clears `unrealized_pnl` on old `SETTLED` rows written by an earlier version that copied realized PnL into `unrealized_pnl`.
