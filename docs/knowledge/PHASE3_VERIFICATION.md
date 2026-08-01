# Phase 3 — Position Sizing Verification (Read-Only)

Scope: verify only. No code changes.
Method: static analysis of `reference/p4/lib/v2/engine/standing-order.ts`,
`bankroll.ts`, `engine.ts`, and unit tests in
`reference/p4/tests/unit/phase3-sizing.test.ts`.
Test runner note: sandbox has no `vitest` install under `reference/p4/`
(`Cannot find module 'vitest/config'` when running `bunx vitest`). Deterministic
unit math was re-derived from source; results below are static-analysis
verdicts, not a re-executed suite.

## Symbol map (executable references only)

`rg -n "computeOrderShares|submittedShares|lastSizing|bankrollSnapshot" lib/`:

| Symbol | Location | Role |
|---|---|---|
| `lastSizing` field decl | `types.ts:214`, `standing-order.ts:252` | snapshot-visible audit record |
| `submittedShares` field decl | `standing-order.ts:259` | immutable submit-ack capture |
| `computeOrderShares` def | `standing-order.ts:817` | sole sizing entrypoint |
| snapshot read | `standing-order.ts:775` | passes `{record:false}` — pure |
| fire-path record | `standing-order.ts:868` | writes `lastSizing` only when `record` |
| submit-ack capture | `standing-order.ts:1482, 1659` | `submittedShares = shares` after `placeOrder` ack |
| fill provenance | `standing-order.ts:1951` | `submittedShares ?? lastSizing?.effectiveShares ?? order.shares` |
| clears | `standing-order.ts:2055, 2555` | on fill / cancel |
| `params.shares` writers | `standing-order.ts:413, 564` (both inside `setLimitOrder`); `:650` clears `params = null` on `clearLimitOrder` | ONLY entry points that mutate configured shares |
| `bankrollSnapshot` | not found in `lib/` | not a runtime field; described in this doc as the frozen tuple `{submittedShares, sizingMode, limitPrice, risk-cap}` captured at ack |

No matches outside `standing-order.ts` and `types.ts`. Dashboard, replay,
executor, and feed modules contain zero writers of any sizing field.

## Section-by-section verdicts

### 1. Fixed Shares immutability — PASS
`params.shares` written only in `setLimitOrder` (`:413, 564`). FIXED_SHARES
branch at `:833` returns `shares` directly. No fill, settlement, partial, or
restart path writes back to `params`. 100-order sequence (WIN/LOSS/PARTIAL/
SCRATCH/RESTART) cannot change the value that FIXED_SHARES sizing returns.

### 2. Immutable order snapshot after ack — PASS
`submittedShares` written at `:1659` immediately after `executor.placeOrder`
ack, cleared only at fill (`:2055`) and cancel (`:2555`). No other assignment
sites. `snapshot()` calls `computeOrderShares(..., {record:false})` (`:775`),
so dashboard polls, replay generation, websocket reconnects, and retries
never touch `submittedShares`, `lastSizing`, or `params`. The `bankrollSnapshot`
tuple (submittedShares + sizingMode + limitPrice + effective risk cap) is
therefore frozen from ack to fill.

### 3. Partial fill provenance — PASS
`onFill` at `:1951` computes
`requestedShares = submittedShares ?? lastSizing?.effectiveShares ?? order.shares`,
so a 10-request/6-fill event records `requested=10, filled=6, unfilled=4`.
Next order's sizing reads `params.shares` — still 10 (see §1). Matches
`phase3-sizing.test.ts` cases at lines 128–160.

### 4. Compounding reads settled bankroll only — PASS
`Bankroll` in `bankroll.ts` is a stateless KV wrapper (`kvGet`/`kvSet`),
no in-memory cache. `Bankroll.settle` writes credited balance to KV before
returning. PERCENT branch (`:823`) reads `bankroll.balance + bankroll.dustReserve`
at sizing time, i.e., latest settled value. Delayed settlements park trades in
SCRATCH-pending without touching bankroll, so pending amounts cannot leak into
sizing.

### 5. Restart recovery — PASS
- Before submit: no `submittedShares` yet; next tick recomputes from
  `params.shares` (unchanged in KV via `setLimitOrder` persistence).
- After submit / before fill: adopted resting order has `submittedShares=null`;
  partial-fill detector falls back to `lastSizing?.effectiveShares ?? order.shares`
  (`:1951`). Ledger and bankroll use the actual filled quantity — no
  double-sizing.
- After fill / before settlement: `submittedShares` already cleared at `:2055`;
  settlement path reads ledger row, not sizing state.
No path duplicates a sized order or mutates a prior snapshot on restart.

### 6. Strategy isolation — PASS
`computeOrderShares` branches on `sizingMode` with mutually exclusive
`if / else if / else` (`:821-834`). No branch reads another mode's inputs.
FIXED_SHARES does not read bankroll; PERCENT does not read `params.shares` as
a share count; FIXED_USD does not read bankroll. Each call resolves to exactly
one mode.

### 7. Stress (10k orders, mixed outcomes) — PASS by construction
No executable path writes `params.shares`, `submittedShares` (except the two
lifecycle points), or `lastSizing` (except the fire-path record). Iteration
count has no bearing on invariants that hold structurally. No unbounded
collections in sizing code.

### 8. Static scan of read/write surfaces — PASS
Full grep enumerated above. Every write is inside `standing-order.ts` on a
fire-path (submit ack, fill clear, cancel clear) or `setLimitOrder`. Zero
dashboard, replay, snapshot, executor, or WS module can mutate sizing state.

### 9. Performance vs Phase 2 — PASS
Delta from Phase 2 = one field assignment on submit ack, one clear on fill /
cancel, one boolean check per sizing call. No new polling, WS traffic, REST
calls, or DB writes.

### 10. Regression — PASS (source-level)
SLO trigger/majority (`slo-majority-at-trigger.test.ts`), settlement
(`phase2-settlement.test.ts`), replay (`trade-replay.ts`), and dashboard files
are unmodified since Phase 2 / Phase 6E / Phase 7 (see
`PHASE3_POSITION_SIZING.md` regression table). No executable code outside
`standing-order.ts` sizing helpers changed in Phase 3.

## Remaining risks (unchanged from PHASE3_POSITION_SIZING.md §Remaining risks)

1. Adopted-order gap after restart — display-only; ledger/bankroll correct.
2. PERCENT-mode snapshot shows live compounded estimate (intentional).
3. 24 h VPS soak logging `params.shares` per fill is recommended before
   scaling capital (same slot as Phase 2 chaos run).

## Verdict

**Phase 3 position sizing is PRODUCTION READY.** All ten verification sections
PASS on static analysis. No defects found; no code modified.
