# ARC — Replay Validation Report (M6)

Status: **PASS**
Implementation: `src/core/platform/replay.ts`
Tests: `tests/unit/replay-validation.test.ts` (7 tests) + `tests/unit/platform-services.test.ts`

## Determinism guarantee

`replayEvents(events, options)` is pure: same events, same options → byte-identical projection
and digest. Ordering is total and stable via `compareEnvelopes` (occurredAt, then sequence,
then eventId), so input order does not affect the outcome.

| Property | Result |
| --- | --- |
| Identical digest across runs | PASS |
| Identical digest with shuffled input | PASS |
| Byte-identical ordered event sequence (JSON) | PASS |
| Idempotent under re-delivered events | PASS |
| Correlation-scoped replay isolates a stream | PASS |
| Malformed payload records a mismatch instead of throwing | PASS |

## Subsystems reproduced

| Subsystem | Reproduced value |
| --- | --- |
| Authoritative Market State | latest `marketStateVersion`, market instance identity |
| Window FSM | per-window state through `COMPLETED`, completion reason |
| ExecutionIntent | intent ids, window linkage |
| Risk | approved/denied counts and verdict reason codes |
| Orders | order FSM state, filled quantity, terminality |
| Settlement | settlement count, settled intent ids |
| Ledger | TRADE / FEE / EXECUTION_SUMMARY / SETTLEMENT / PNL records, byte-identical |
| Trade Quota | `initial`, `remaining`, `consumed` |

## Original vs replay comparison

`replayEvents` compares reconstructed FSM transitions and quota against the values carried in
the stream and records divergences as `mismatches` with a reason code, marking
`deterministic: false`. A clean stream yields `mismatches: []` and `deterministic: true`.
Non-deterministic inputs (wall-clock timestamps, venue latency) are excluded from comparison
by design — only stream-derived values are asserted.

## Persistence

Replay runs are recorded in `replay_runs` (append + own-row update only) with `run_id`,
`deterministic`, `event_count` and `mismatches`, so operators can audit past reconstructions.
