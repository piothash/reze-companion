# M8 — Production Monitoring Checklist

The operator watches; the VPS reports. Every metric below is produced by the
trading authority and mirrored into the control plane. The companion computes
none of them from trading state, and it never acts on them.

## Metrics

| Metric | Source | Healthy | Investigate |
| --- | --- | --- | --- |
| Heartbeat latency | Registry `latency_millis` | < 500 ms | > 2× the heartbeat interval, or not reported |
| Event processing latency | Engine telemetry, per canonical event | < 250 ms p95 | rising p95, or a growing gap between emitted and recorded sequence |
| Replay duration | `replay_runs.started_at → completed_at` | stable run over run | a jump with an unchanged event count |
| Recovery duration | Restart → authority `ACTIVE` | < 2 heartbeat intervals | slower, or repeated re-registration |
| Memory usage | `pm2 describe` / engine telemetry | flat over a session | monotonic growth between restarts |
| Error rate | `event_log` at `error` level | 0 sustained | any repeating reason code |

Heartbeat age, latency and registration count are visible on **Engine
Registry**; replay duration and mismatches on **Replay**; error rate on
**Events**.

## Mandatory log fields

Every operational log line the engine emits — and every canonical event the
control plane records — must carry all five:

| Field | Why |
| --- | --- |
| `correlationId` | Ties one operator action to every downstream effect |
| `authorityId` | Which trading authority produced it |
| `runtimeIdentity` | Which running process, across restarts |
| `eventId` | The canonical event, for replay and idempotency |
| `reasonCode` | Why it happened, from the frozen reason-code catalogue |

A log line missing any of these is not operationally usable: it cannot be
correlated during a replay or an incident review. The canonical event envelope
enforces all five at the schema level, so events cannot be recorded without
them.

## Alerting thresholds

| Condition | Meaning | Action |
| --- | --- | --- |
| No heartbeat for 2 intervals | Authority `STALE` | Check PM2, then the network path |
| Authority `REVOKED` | Key rotated or authority retired | Re-register with the new key |
| Configuration `DRIFTED` | Runtime hash ≠ published hash | Republish; never edit runtime directly |
| Event sequence regressed | Possible duplicate events after a restart | Stop, inspect the ledger, replay before resuming |
| Error rate sustained > 0 | Engine-side fault | Read the reason code, then the runbook |

## What monitoring never does

It never pauses, resumes, cancels or places anything. All of that belongs to
the VPS trading authority. The control plane's only write path is publishing a
configuration version, which the authority is free to reject.
