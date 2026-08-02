# ARC — Operations Runbook (M6.5)

Scope: operating the **companion control plane**. The VPS remains the sole
trading authority (Charter, frozen architecture). Nothing here starts, stops or
influences trading decisions.

---

## 1. Startup sequence

`validateStartup()` (`src/core/platform/startup-validator.ts`) runs 14 gates in
a fixed order. A failing gate returns `SYSTEM_START_BLOCKED` and the process
must not serve traffic.

| # | Gate | Blocks startup when |
|---|------|---------------------|
| 1 | environment-variables | any required variable is missing or malformed |
| 2 | configuration-validity | the config schema rejects the environment |
| 3 | database-connectivity | the control-plane Data API does not answer |
| 4 | database-schema-version | the applied schema differs from the expected version |
| 5 | feed-configuration | discovery/feed identifiers are absent or invalid |
| 6 | twap-configuration | provider or window length is missing/out of range |
| 7 | execution-profile | the active profile cannot be resolved |
| 8 | window-definitions | `EXECUTION_WINDOWS` is empty, malformed or overlapping |
| 9 | risk-profile | exposure, kill-switch or liquidity limits are incoherent |
| 10 | trade-quota | quota contradicts the execution mode |
| 11 | feature-flags | an unknown or contradictory flag is declared |
| 12 | scheduler-initialization | tick interval is unusable |
| 13 | network-environment | mainnet is selected without explicit authorisation |
| 14 | secret-material | credential-shaped literals exist in source |

**No silent defaults.** Business values (windows, buffers, quota, TWAP) are
never defaulted; absence is a startup failure.

---

## 2. Probes

| Endpoint | Meaning | Healthy | Unhealthy |
|----------|---------|---------|-----------|
| `GET /api/public/health/live` | process is running; no dependencies touched | `200` | never fails while the process answers |
| `GET /api/public/health/ready` | dependencies answer, all gates passed, no critical watchdog | `200` | `503` |
| `GET /api/public/health/startup` | full gate matrix | `200` | `503` + `SYSTEM_START_BLOCKED` |
| `GET /api/public/health/details` | per-engine health, watchdogs, gate detail | `200` | `503` |

Supervisor wiring:

- **Restart policy** → `live` only. Never restart on `ready` failures; a slow
  database must not cause a restart storm.
- **Traffic/promotion** → `ready`.
- **Deployment gate** → `startup`.

---

## 3. Watchdogs

`src/core/infrastructure/watchdogs.ts` grades every critical subsystem
(scheduler, feed ingestion, TWAP, market discovery, decision, execution, risk,
event store, persistence sync, API, metrics).

- No heartbeat within the warn budget → `warning` (`WDG_WARNING`).
- No heartbeat within the critical budget → `critical` (`WDG_SILENT`).
- Consecutive failures escalate `warning` → `critical` (`WDG_CRITICAL`).

Budgets derive from configuration (tick interval, feed staleness) — never
hardcoded. A `critical` required subsystem makes readiness fail.

---

## 4. Structured logging

Every record is JSON and carries `timestamp`, `level`, `engine`, `reasonCode`,
`correlationId`, `marketInstanceId`, `windowInstanceId`, `executionIntentId`,
`orderId` (nulled when not applicable). `OperationalLogger` rejects a record
without a catalogued reason code, and secret-looking fields are redacted before
the transport sees them.

Search patterns:

```bash
# everything for one operator action
grep '"correlationId":"<id>"' arc.log

# everything a single intent produced
grep '"executionIntentId":"<id>"' arc.log
```

---

## 5. Graceful shutdown

`GracefulShutdown` runs a fixed order, each step with its own budget:

1. `stop-scheduler` — stop producing ticks
2. `stop-feed` — stop ingesting
3. `finish-current-event` — let in-flight work complete
4. `flush-event-store`
5. `flush-notifications`
6. `persist-snapshots`
7. `flush-logs`

Repeated signals are idempotent — the first report is returned. A failing step
is reported (`LIF_STEP_FAILED` / `LIF_STEP_TIMEOUT`), later steps still run, and
the process exits `1` with `LIF_SHUTDOWN_DEGRADED`. A clean run exits `0` with
`LIF_SHUTDOWN_COMPLETED`.

```bash
pm2 stop arc            # SIGINT → graceful sequence
pm2 reload arc          # rolling restart
```

---

## 6. Graceful restart

`restoreAfterRestart(events)` rebuilds resumable context from the event stream:
execution contexts, trade quota, active windows, open intents and orders,
exposure reservations, and the next safe sequence.

The returned `RecoveryGuard` plus `suppressDuplicateEmissions()` drop any
business event the stream already contains, so a restart mid-window never
double-emits an intent or double-consumes quota. Restoration is deterministic:
the same stream always yields the same digest.

---

## 7. Deployment checklist

**Pre-deploy**

- [ ] `bunx vitest run` — all suites pass
- [ ] `bun run build` — clean
- [ ] `GET /health/startup` on the candidate returns `200`
- [ ] Secret scan clean (gate 14)
- [ ] Schema version matches the expected version
- [ ] `ARC_NETWORK` is correct; mainnet is explicitly authorised

**Deploy**

- [ ] Deploy with the supervisor pointed at `live` for restarts
- [ ] Wait for `ready` → `200` before shifting traffic
- [ ] Confirm `details` shows every required watchdog at `healthy`

**Post-deploy**

- [ ] Logs show `LIF_STARTUP_COMPLETED` and no `SYS_CHECK_FAILED`
- [ ] Event sequence continues without a gap or duplicate
- [ ] Exposure reservations reconciled (`reservedTotal` matches the ledger)

**Rollback**

1. `pm2 stop arc` (graceful; wait for exit code `0`)
2. Redeploy the previous release
3. Verify `startup` → `200`, then `ready` → `200`
4. Confirm restart restored the prior digest without duplicate events

---

## 8. Incident quick reference

| Symptom | First check | Likely cause |
|---------|-------------|--------------|
| `ready` = 503, `live` = 200 | `details` → failing gate or watchdog | dependency down or config drift |
| `SYSTEM_START_BLOCKED` | `startup` gate list | missing env var or schema mismatch |
| `WDG_SILENT` on feed | feed provider status | upstream feed outage |
| Duplicate events after restart | restore digest and `resumeSequence` | guard bypassed — stop and investigate |
| Shutdown exit code `1` | shutdown report steps | a sink failed to flush; verify durability |
