# Regression Report — Phase 6D

## Scope

Every fix in Phase 6D is additive. Existing trade, PnL, settlement,
risk, reconciliation, and restart paths are unchanged in behaviour.
This report catalogues the tests that cover the new paths and the
existing tests that must continue to pass.

## New tests (added in Phase 6D)

### Standing Limit Order — majority-side selection

`reference/p4/tests/unit/phase6d-majority-side.test.ts`

- `majority side matches trigger side` — Override is a no-op; the
  resulting `side` and lock are the same as before Phase 6D.
- `majority side differs from trigger side` — Override redirects
  `side` to `computeMajority(tickSnapshot).side`; the DIRECTION LOCK
  reflects the majority.
- `null snapshot at trigger` — Override is skipped; pre-Phase-6D
  fallback side is used (no regression).
- `post-lock majority flip` — Once locked, the majority override
  does not fire (guarded by `this.lockedDirection === null`).
- `pre-lock majority flip before trigger` — Existing resting-order
  cancel-on-flip behaviour re-verified.
- `trigger in final entry-window seconds` — Majority is evaluated at
  the trigger instant, not at window open.

### PnL / accounting — incremental sweep

`reference/p4/tests/unit/phase6d-accounting-sweep.test.ts`

- `first sweep after boot uses full scan` — No watermark in KV →
  `exportTrades(mode).filter(status='SETTLED')` path exercised.
- `second sweep uses incremental scan` — Watermark and
  `prev_balance` present → `exportSettledTradesAfterId` path
  exercised; only new rows are checked.
- `Identity B chain continuity across sweeps` — First new row in the
  second sweep is validated against the KV-seeded prev balance;
  correct pass and correct fail on injected drift.
- `no new rows` — Sweep completes without touching the watermark;
  Identity C still evaluates against the KV-seeded prev balance.
- `auto-reconcile still fires on bankroll drift` — Existing Identity C
  behaviour preserved on the incremental path.

## Existing tests (must continue to pass)

- `phase6b-account-sync.test.ts` — Data-API cold state + funder
  validation.
- `phase6b-credentials.test.ts` — LIVE_V2 credential precheck.
- Accounting invariant P-2 tests — `recordSettlement` on both engine
  and SLO paths.
- P-3 read-your-writes tests — OPEN row written on fill.
- Direction trace tests — 9-hop tracer under `DIAG=1`.
- All standing-order lifecycle tests — trigger detection, direction
  lock, restart recovery, stuck-RESTING guard.

## Long-running soak (recommended, operator-runnable)

The sandbox cannot run a real soak, so a runbook is included instead.
`docs/knowledge/OPERATOR_RUNTIME_CHECKLIST.md` §7 already covers
account-sync soak; PnL soak steps:

1. Run PAPER_V1 for 24 h with a compressed 60 s slot clock.
2. After the run, dump `SELECT id, balance_after, pnl FROM trades
   WHERE mode='PAPER_V1' ORDER BY id ASC` and verify Identity B by
   spreadsheet.
3. Confirm the KV watermark advances monotonically (query
   `acctverify:PAPER_V1:watermark_id` after each sweep interval).
4. Confirm `summary.settledChecked` stabilises around the number of
   trades per 5 min instead of the lifetime total.

## Verification results

- Static: all touched files typecheck under the existing TS config
  (verified by inspection — sandbox has no `node_modules` for the
  reference project). No new imports resolve to missing modules.
- Runtime: to be executed on the VPS by the operator per
  `OPERATOR_RUNTIME_CHECKLIST.md`; expect all suites green including
  the two new Phase 6D suites.

## Accepted limitations

- T-1..T-6 unchanged (see `PHASE3_FINAL_CERTIFICATION.md`).
- F-5, F-6 from Phase 6A remain deferred as documented.
- The historical CRITICAL audit rows are still the compliance trail;
  no separate structured audit-log table introduced this phase.
