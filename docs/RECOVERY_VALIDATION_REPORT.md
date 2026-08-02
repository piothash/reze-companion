# ARC — Recovery Validation Report (M6)

Status: **PASS**
Implementation: `src/core/platform/recovery.ts`
Tests: `tests/unit/recovery.test.ts` (13 tests)

## Model

Recovery is a pure, deterministic rebuild of resumable runtime state from the append-only
canonical event stream. It performs no IO, reads no clock and makes no trading decision.
A restarted process asks `RecoveryGuard` before emitting anything that must exist at most once.

```text
events → recoverFromEvents() → RecoveryState → createRecoveryGuard() → duplicate suppression
```

## Restart points validated

| Restart during | Restored | Duplicates suppressed |
| --- | --- | --- |
| Feed ingestion | market state version, correlation | n/a (idempotent projection) |
| Window lifecycle | active windows, window FSM state, execution context | window re-open |
| Decision | execution intents, trade quota | duplicate `ExecutionIntent` |
| Execution | orders, order FSM state, filled quantity, exposure reservations | duplicate `Order` |
| Settlement | settled intents | duplicate `Settlement` |
| Replay | replay projection is recomputed, never resumed | n/a |
| Recovery itself | idempotent — recovery of a recovery converges | yes |

## Invariants verified by test

1. Truncating the stream at every lifecycle boundary and resuming converges to the same
   final `RecoveryState` digest as the uninterrupted run (`compareRecovery` returns `[]`).
2. Re-delivered events (restart replays the tail) produce **no** duplicate intents, orders,
   settlements or ledger records. Events are deduplicated by `eventId`; ledger records by
   their deterministic `recordId`.
3. Trade quota (`initial`/`remaining`/`consumed`) is restored exactly.
4. Execution context ids and active window ids are restored exactly.
5. Exposure reservations are restored with `Reserved + Live ≤ Limit` preserved; released
   reservations recover with `reserved = 0`.
6. `nextSequence()` is strictly greater than the highest observed sequence, so a resumed
   process can never re-issue a sequence number.

## Hardening applied this milestone

- `reconstructLedger` no longer throws on a malformed business payload: the partial records
  for that event are discarded and counted in `malformedEventCount`. The ledger is read on
  every dashboard load and during recovery, so a single bad payload must not blank the console.
- `reconstructLedger` deduplicates by `recordId`, making it safe under re-delivery.
- `recoverFromEvents` deduplicates by `eventId` before projecting.

## Known limitations

- Recovery reconstructs **resumable** state only. Live venue state (open orders at the venue)
  is owned by the VPS and is reconciled there, not in the companion (ADR-0001).
