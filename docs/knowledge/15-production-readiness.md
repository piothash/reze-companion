# 15 — Production Readiness Assessment

**Scope of this report.** Phase 0 observations only. Every item below is backed by evidence from `reference/p4/`. Nothing in this document is a request to change the source — items are labeled **STRENGTH**, **WATCH**, or **GAP** so downstream phases can prioritize.

## Strengths

- **Single mandatory risk gate.** Both order-producing paths must pass `RiskManager.checkOrder` before `executor.placeOrder` (`risk.ts:1-20`). Kill switch is KV-persisted and survives restarts.
- **Duplicate-order safety in cancel-replace.** Cancel failure forces a `getOrderState` verification; a `LIVE` or `UNKNOWN` result aborts replacement (`live.ts:154-190`, `paper.ts:257-268`).
- **Partial-fill safety with race handling.** Remainder is cancelled and post-cancel `getOrder` is re-read to catch fills during the cancel race (`live.ts:210-246`).
- **Idempotent fill reporting.** `fillReported` flag prevents `checkFill` from double-booking (`paper.ts:74-76`).
- **Boot-time crash recovery is money-correct.** `scratchOrphanedOpenRows` refunds `cost` to the bankroll for any `OPEN` position at restart (`db.ts:174-206`), with a comment recording the historical bug that motivated it.
- **Read-only reconciler.** By construction cannot make drift worse — only reports (`reconciler.ts:15-20`).
- **Untracked orders are ERROR-severity every cycle.** No possibility of silent drift accumulation (`reconciler.ts:14-20`).
- **Paper executor is structurally incapable of real orders.** No signer, no client, no credentials — comment at `paper.ts:19-25`.
- **Authority seam for the sim wallet.** `setWalletUsd` prevents the historical "stale mirror overwriting the true bankroll" bug (`paper.ts:186-201`).
- **Non-blocking DB writes.** `queueWrite` guarantees the tick loop never waits on SQLite (`db.ts:16-45`).
- **Fill-detection outage is impossible to miss.** After 5 consecutive `checkFill` failures a throttled WARN fires every 30s (`live.ts:253-263`).
- **`maxDailyOrders=2000`** is documented as a runaway-loop guard with rationale — a lower value silently vetoed healthy trading in the past (`risk.ts:58-68`).

## Watch items

- **Two coexisting strategy layers.** Legacy `strategy/sniper.ts` alongside the `strategy-registry/`. Verify only one is active in any given configuration and that the legacy one cannot be inadvertently selected.
- **10s spot staleness threshold.** `SPOT_STALE_MS = 10_000` (`engine.ts:837`). Adequate under nominal feed conditions; worth measuring 99p feed gap in production before assuming this is conservative.
- **Reconciler drift tolerance $1.** `DRIFT_TOLERANCE_USD = 1` (`reconciler.ts:30`) — appropriate for informational status; anything larger than this should raise scrutiny at scale.
- **PM2 memory ceiling / restart backoff.** Configured in `ecosystem.config.js`; verify the ceiling is high enough that legitimate warm-cache growth doesn't cause daily restarts.
- **Notifier fanout.** `notifier.ts` uses `telegram.ts`. Single external dependency for alerting — outages there mute alerts entirely.
- **KV as config store.** Fast and simple, but there is no schema for KV values — a typo in a key name silently reverts to defaults.

## Gaps to close before an unattended production posture

- **Test coverage matrix not captured in Phase 0.** Report 14 lists the high-risk modules (`live.ts` cancel-replace, `settlement-repair.ts`, `db.ts:scratchOrphanedOpenRows`, `risk.ts`) that should be enumerated first in Phase 1.
- **No documented runbook for "reconciler is reporting UNTRACKED orders."** The severity is right; the operator response is not codified in-tree.
- **No documented runbook for kill-switch disengagement.** `disengageKillSwitch()` (`engine.ts:610`) is gated on health, but the exact health criteria and the correct human procedure are not written down.
- **Settlement repair rewrites history.** `settlement-repair.ts` (219 LOC) can modify prior settled rows; needs an operator playbook that describes when it is safe to enable and how to audit its actions.
- **Dashboard auth.** Session/CSRF exist (`proxy.ts`, `dashboard-auth.ts`, `api-auth.ts`), but Phase 0 did not audit token rotation, secret storage, or rate limiting. Flag for Phase 2 security review.
- **No live/paper comparison verdict yet.** `comparison.ts` exists (249 LOC) and captures data; the acceptance criteria for "safe to promote paper strategy to live" are not documented in the source.

## Phase 0 conclusion

The system shows evidence of a mature production posture: money-moving edges have explicit safety comments citing historical bugs that motivated the current code, and defensive invariants (single risk gate, read-only reconciler, idempotent fills, boot-time SCRATCH sweep) are in the right places. The largest unknowns are (a) actual test coverage and (b) operator runbooks — both are documentation gaps rather than architectural ones.

**Awaiting instructions before beginning any implementation phase.**
