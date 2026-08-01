# P4 · Direction & PnL Runtime Instrumentation

Additive, env-gated tracer used during Phase 1 · Stage 1A to prove/disprove direction and PnL divergence in the running bot without modifying trading behavior.

## Enable

```bash
export P4_DIAG_DIRECTION=1
pnpm start   # or pm2 restart p4
```

## Disable

Unset the variable and restart. Every trace call becomes a cheap no-op — no allocation, no log lines, no ring-buffer growth.

## What it captures

Every trade is tagged with a `traceId` (the trade UID). One structured JSON log line is emitted per hop, greppable via `[dtrace]`.

| Hop | Emitter | Payload |
|---|---|---|
| `live-place-order-request` | `LiveExecutor.placeOrder` before `createAndPostOrder` | `{engineSide, tokenID, marketId, price, size, orderType, expiration}` |
| `live-place-order-ack` | `LiveExecutor.placeOrder` after ack | `{engineSide, tokenID, exchangeOrderId, success}` |
| `live-check-fill` | `LiveExecutor.checkFill` on any fill | `{engineSide, engineTokenId, exchangeAssetId, tokenMatches, filledPrice, filledShares}` |
| `live-token-mismatch` | `LiveExecutor.checkFill` when `asset_id ≠ tokenId` | Same as above; also emits an ERROR log line |
| `slo-fill` | `StandingOrderManager.onFill` | `{orderSide, orderTokenId, lockedDirection, shares, filledPrice, cost, tradeId}` |
| `slo-settlement-input` | `StandingOrderManager.recordSettlement` before ledger write | `{betSide, winner, source, shares, cost, payout, pnl}` |
| `engine-fill` | `Edge5Engine.onFill` | `{orderSide, orderTokenId, shares, filledPrice, cost, poolBefore, dustAfter, poolShortfall, tradeId}` |
| `engine-settlement-input` | `Edge5Engine.recordSettlement` before ledger write | `{betSide, winner, winningTokenId, upTokenId, downTokenId, source}` |
| `engine-settlement-result` | `Edge5Engine.recordSettlement` after credit | `{result, winner, payout, pnl, openingTotal, balanceAfter, credited}` |

## Divergence heuristics

Read the emitted lines top-to-bottom in `traceId` order.

1. **Direction inversion at exchange** — `live-check-fill.tokenMatches === false` OR a `live-token-mismatch` line exists.
2. **Winning-side mismatch** — `engine-settlement-input.betSide` mapped to (`upTokenId`/`downTokenId`) ≠ `winningTokenId` while `winner` says otherwise.
3. **Fill overspend / phantom dust** — `engine-fill.poolShortfall > 0` (previously silently masked by `Math.max(dust,0)`).
4. **Missed / double credit** — `engine-settlement-result.balanceAfter ≠ openingTotal + payout` (accounting invariant also logs a CRITICAL line via `checkAccountingInvariant`).
5. **SLO race outcome** — `slo-fill.lockedDirection` shows which side won the trigger race.

## Programmatic access

```ts
import { getRecentTraces } from "@/lib/v2/engine/diag/direction-trace"
const last200 = getRecentTraces(200) // TraceRecord[]
```

Suitable for a dashboard-side "recent diagnostics" panel. Returns `[]` when the tracer is disabled.

## Safety guarantees

- Never throws — every call is wrapped in `try/catch` inside the module.
- Never blocks — writes to an in-process ring buffer (`RING_MAX = 1024`).
- Zero cost when disabled — the fast path is `if (!ENABLED) return`.
- No mutation of trading state.
- No new dependencies.

## Removal checklist (post-investigation)

1. Remove imports of `./diag/direction-trace` from:
   - `lib/v2/engine/standing-order.ts`
   - `lib/v2/engine/engine.ts`
   - `lib/v2/engine/execution/live.ts`
2. Delete the `dtrace.trace(...)` call sites (`rg "dtrace\." lib/v2/engine/`).
3. Delete `lib/v2/engine/diag/direction-trace.ts` and `tests/unit/direction-trace.test.ts`.

The module has no other production dependencies.
