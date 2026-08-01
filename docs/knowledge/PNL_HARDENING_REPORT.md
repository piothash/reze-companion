# PnL / Accounting Hardening Report — Phase 6D

## 1. Scope

Audited every code path that reads, writes, or verifies:

- realized PnL, unrealized PnL, mark price
- position sizing, partial / multiple fills, scaling in / out
- settlement (WIN, LOSS, SCRATCH, official / spot-fallback / scratch)
- bankroll, dust reserve, compounding
- reconciler drift, exchange truth vs local truth
- ledger persistence, ledger idempotency
- restart / crash recovery
- accounting invariants A / B / C / D

Files reviewed:

- `reference/p4/lib/v2/engine/bankroll.ts`
- `reference/p4/lib/v2/engine/accounting-verifier.ts`
- `reference/p4/lib/v2/engine/settlement-repair.ts`
- `reference/p4/lib/v2/engine/settlement-verifier.ts`
- `reference/p4/lib/v2/engine/engine.ts` (`onFill`, `recordSettlement`)
- `reference/p4/lib/v2/engine/standing-order.ts` (fill → debit → settle)
- `reference/p4/lib/v2/engine/reconciler.ts`
- `reference/p4/lib/v2/engine/db.ts` (`insertTrade`, `settleTrade`,
  `updateSettledBalance`, `exportTrades`)
- `reference/p4/lib/v2/engine/handlers/*` (dust-compounding,
  accounting-invariant)

## 2. Findings

### 2.1 Cumulative rounding drift — **no defect**
Every mutator on `Bankroll` (`balance`, `dustReserve`, `settle`,
`debitFixed`) rounds to 4 dp before persisting to KV. Identity C
(bankroll pool == last settled balance − open costs) is auto-reconciled
against the ledger every 5 minutes.

### 2.2 Idempotent settlement — **no defect**
`settleTrade` in `db.ts` guards `AND status='OPEN'`, so a second
settlement attempt (boot-time orphan sweep, retry after crash, exchange
reconciliation) can never double-credit. `recordSettlement` only calls
`bankroll.settle(payout)` when the UPDATE returned 1 row.

### 2.3 Read-your-writes on fill — **no defect** (Phase 1 Stage 1A P-3)
`onFill` writes an OPEN ledger row **before** returning, so a crash
between fill and settlement can be recovered from the ledger.

### 2.4 Accounting invariant on both paths — **no defect** (Phase 1 P-2)
`checkAccountingInvariant({ opening, payout, closing })` is wired into
both the strategy engine's `recordSettlement` and the SLO's
`recordSettlement`. Violations write a CRITICAL audit row.

### 2.5 Long-running verifier cost — **DEFECT: unbounded per-sweep read**
`accounting-verifier.ts` previously called `exportTrades(mode)` on every
5-minute sweep, loading **every settled trade for all time** into memory
and re-checking identities A/B/D. This is O(all-trades) per sweep and
grows without bound over VPS operation:

- 5 000 trades → 5 000 rows checked every 5 min → 1.44 M row-checks/day.
- 50 000 trades → 14.4 M row-checks/day.

Settled rows are terminal (SETTLED is a permanent status) and their
identities were already verified in earlier sweeps, so the re-work is
pure waste and eventually becomes a CPU/GC pressure source.

### 2.6 Reconciler cadence, RESTING guard, KV bankroll — **no defect**
- Reconciler: 60 s cadence, read-only, structured logging, correct
  handling of missing / untracked orders.
- SLO stuck-RESTING guard (existing) covers external cancels.
- KV bankroll persisted per mode; `PipelineMode` in the key prevents
  cross-mode contamination.

### 2.7 Duplicate-fill protection — **no defect**
- Strategy path: single `openOrder` + `position` at a time; the fill
  handler nulls `openOrder` before the ledger write.
- SLO path: `readyForTrigger` false-latch + `triggerLock` + persisted
  `restingOrder` id + `handlePlacementFailure` guard.

### 2.8 Realized vs unrealized consistency — **no defect**
`recordSettlement` sets `markPrice` to `1` on WIN, `0` on LOSS, `pos.price`
on SCRATCH. The dashboard reads directly from the ledger (`exportTrades`)
so realized/unrealized cannot drift from settlement outcomes.

### 2.9 Restart / crash recovery — **no defect**
- KV: bankroll, dust, pipeline mode, SLO state (persisted before every
  network I/O).
- SQLite: ledger, order log, events, watermarks.
- Boot sequence in `Edge5Engine` re-hydrates positions from OPEN rows
  and runs `maybeAutoResume()` under the persisted mode.

### 2.10 Stale dashboard values — **no defect**
Snapshot poll is 1 s (Phase 6C EngineStatusPanel). The reconciler and
accounting verifier both update `latest` on completion, and the
dashboard reads the same objects the trading loop reads.

## 3. Fix applied

**F-6D-1 — Incremental accounting sweep with KV-persisted watermark.**

- New helper: `exportSettledTradesAfterId(mode, minId)` in `db.ts`
  (bounded `SELECT * FROM trades WHERE mode = ? AND status = 'SETTLED'
  AND id > ? ORDER BY id ASC`).
- `accounting-verifier.ts` now:
  - Reads `acctverify:<mode>:watermark_id` and
    `acctverify:<mode>:prev_balance` from KV.
  - Loads only rows added since the watermark (falls back to the full
    sweep when the watermark is absent, i.e. first run after boot).
  - Seeds `prevBalance` from KV so Identity B (balance-chain
    continuity) still holds across sweeps.
  - Advances the watermark and stores the last `balance_after` in KV
    after a successful sweep.

Sweep cost is now O(new trades since last sweep) instead of
O(all-time trades). Identity coverage is unchanged.

## 4. Preserved behaviour

- First sweep after boot: full-scan, identical to pre-Phase-6D.
- Identity A: violation on any settled row (same tolerance, same
  formula).
- Identity B: still validates every new row against its predecessor;
  first new row's predecessor is loaded from KV.
- Identity C: unchanged — evaluated against `prevBalance` which is
  either the KV-seeded value or the last row processed this sweep.
- Identity D: unchanged.
- Auto-reconcile: unchanged.
- `getLastAccountingAudit()` result shape: unchanged.
- `summary.settledChecked` semantics: now "settled rows checked **in
  this sweep**". The dashboard already treats this as a cadence signal,
  not a lifetime counter.

## 5. Not fixed / intentionally deferred

None. The audit surfaced no other defects.

Accepted limitations (unchanged from Phase 3):

- T-1..T-6 as documented in `PHASE3_FINAL_CERTIFICATION.md`.
- No structured historical audit log beyond `insertOrderLog(ERROR)`
  rows — the CRITICAL audit rows themselves are the compliance trail.

## 6. Regression tests

See `docs/knowledge/REGRESSION_REPORT.md`. New coverage:

- Incremental sweep is a no-op on an empty delta and populates
  the KV watermark.
- Second sweep after new rows validates Identity B against the
  KV-seeded `prev_balance`.
- Full-sweep fallback engages on a fresh install (no watermark).
- Auto-reconcile still triggers when bankroll drifts from the
  ledger-derived expected pool.
