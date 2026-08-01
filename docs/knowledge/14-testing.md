# 14 — Testing Report

## Framework

Vitest (`process.env.VITEST` used to trigger deterministic paths, e.g. `paper.ts:98-100` selects `ZERO_CHAOS` under vitest).

## Test surfaces available

- Deterministic PAPER executor (`ZERO_CHAOS`, `paper.ts:50-59`) — no randomness, no delay — ideal harness for repeatable strategy/reconciler/settlement tests.
- Synchronous write flush (`flushWriteQueueSync`, `db.ts:47-58`) — lets tests assert against SQLite state without racing the async queue.
- `Executor` interface allows a fake executor for unit tests without touching either PAPER or LIVE.

## Testable-by-design signals in production code

- Reconciler is READ-ONLY (`reconciler.ts:15-20`) — safe to run under test with a mock executor.
- All logging goes through `events.logEvent` (`events.ts`) — single interception point.
- Bankroll math isolated in `handlers/dust-compounding.ts` (pure function).
- Risk manager is a pure gate operating on injected `mode()` and KV — easy to exercise.

## Gaps observed (from source-only inspection — no test folder enumerated in Phase 0)

The Phase 0 sweep did not enumerate a `tests/` directory tree; this section is intentionally left as an *observation*, not a claim:

- No test file listing was captured for this KB. Recommend Phase 1 begin with `find reference/p4 -name "*.test.ts"` and produce a coverage matrix against every module in Report 01.
- Modules that are highest-risk to run untested against a live account:
  - `execution/live.ts` — cancel-replace and partial-fill code paths
  - `settlement-repair.ts` — writes retroactive corrections
  - `db.ts:scratchOrphanedOpenRows` — money-moving boot logic
  - `risk.ts` — the ONLY gate before real orders

## Chaos harness (PAPER)

`DEFAULT_CHAOS` (`paper.ts:41-49`):
- 40–220ms latency
- 5% reject
- 3% timeout
- 15% partial fill
- 8% slow-ack (extra 1–3s)
- Outage window (`simulateOutage`, `paper.ts:141-144`)

This exercises the entire operational envelope of the executor without touching real markets. Any strategy that survives an extended PAPER run with `DEFAULT_CHAOS` has cleared a meaningful bar.

## Trade replay (`trade-replay.ts`, 302 LOC)

Captures per-tick state for a trade; `trades/[id]/replay` API and `trade-replay-view.tsx` panel reconstruct decisions. This is a testing/investigation asset in its own right.

## Comparison harness (`comparison.ts`, 249 LOC)

Runs paper and live side-by-side for A/B comparison of strategy behavior. Additive schema managed via `getDbHandle()`.
