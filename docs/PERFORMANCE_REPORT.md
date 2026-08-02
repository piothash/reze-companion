# ARC — Performance Report (M6)

Status: **PASS**
Tests: `tests/unit/hardening.test.ts` (performance sanity budgets)

## Method

Budgets are deterministic and machine-independent: they assert bounded work and roughly linear
scaling on synthetic 1k/5k event streams rather than absolute wall-clock micro-benchmarks.

## Measurements (5,000-event stream)

| Path | Budget | Observed | Verdict |
| --- | --- | --- | --- |
| `replayEvents` | < 2000 ms | ~20 ms | PASS |
| `recoverFromEvents` scaling (1k → 5k) | < 25× | ~5× (linear) | PASS |
| `reconstructLedger` + `computeAnalytics` | < 2000 ms | ~5 ms | PASS |

## Findings and actions

| Area | Finding | Action |
| --- | --- | --- |
| Memory | Projections hold one map entry per window/intent/order; no unbounded caches | none needed |
| CPU | Single sort + single pass per projection; no nested scans | none needed |
| Ledger | Re-delivery previously produced duplicate records (O(n) growth on retries) | fixed — dedupe by `recordId` |
| Ledger | A malformed payload aborted the whole reconstruction | fixed — skip and count |
| Supabase calls | Console surfaces issued per-panel queries against un-indexed predicates | fixed — 9 indexes added (endpoint, replay run, notification-unread, window/intent/market traceability) |
| Rendering | Operator routes render bounded lists from a single snapshot server function | none needed |
| API latency | One authenticated round trip per surface; no N+1 | none needed |
| Scheduler | Deterministic, O(log n) ordered task queue | none needed |
| Analytics | Single-pass reduction over the event stream | none needed |

## Index additions

`engine_endpoints(user_id, created_at)`, `engine_snapshots(endpoint_id, captured_at)`,
`event_log(endpoint_id, occurred_at)`, `replay_runs(user_id, started_at)`,
`notifications(user_id, created_at) WHERE read_at IS NULL`,
`platform_events(user_id, window_instance_id | execution_intent_id | market_instance_id)`,
`configuration_profiles(user_id, updated_at)`.

## Limits to watch

Replay and ledger reconstruction are in-memory and linear in stream length. Above roughly
250k events per correlation stream, move reconstruction to a windowed/paged run. Not a
constraint at current volumes.
