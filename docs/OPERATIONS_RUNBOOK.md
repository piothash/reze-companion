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

---

## 9. Authority handshake and PM2 integration (M7.6)

The engine authenticates itself to the control plane. Wire this into the PM2
lifecycle so an engine that cannot register never starts trading.

### Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `ARC_AUTHORITY_SIGNING_KEY` | companion **and** VPS | Shared HMAC key (≥32 chars). Identical on both sides. |
| `ARC_AUTHORITY_ID` | VPS | Stable authority id, e.g. `arc-vps-authority-01` |
| `ARC_COMPANION_URL` | VPS | Control-plane base URL |
| `ARC_HEARTBEAT_INTERVAL_MS` | VPS | Heartbeat cadence (default `15000`) |

The signing key is a shared secret: generate one strong random value
(`openssl rand -hex 32`), store it in the companion's secrets and in the VPS
environment. It is never written to the database and never returned by an API.
Rotate by setting the new value on the companion first, then the VPS; requests
signed with the old key are refused, so rotate during a maintenance window.

### Startup sequence

```
pm2 start ecosystem.config.cjs --only arc
  1. startup validator gates (section 1)
  2. POST /api/public/authority/register
       accepted → continue
       403 / 503 / non-2xx → SYSTEM_START_BLOCKED, do not trade
  3. GET  /api/public/authority/configuration
       pending → validate → POST verdict → run the accepted version
       none    → run the last accepted version
  4. heartbeat loop every ARC_HEARTBEAT_INTERVAL_MS
```

`runtimeIdentity` must be regenerated on every process start (for example
`${PM2_INSTANCE_ID}-${startedAtIso}`) so the control plane can distinguish a
restart from a continuous run.

### Restart and recovery

- On restart the engine re-registers. The registry row is reused —
  `registration_count` increments, the row is never duplicated.
- A revoked authority stays revoked across re-registration. The operator must
  clear the revocation; the engine cannot restore itself.
- After a restart the engine re-pulls configuration before resuming. It does
  not assume the last version it held is still current.
- If heartbeats stop, the registry shows `stale` after
  `max(90s, 3 × heartbeat interval)`. Stale means "unknown", not "safe":
  investigate the engine before publishing configuration.

### Verification

```bash
# Registration (signature computed by the engine client)
curl -sS -X POST "$ARC_COMPANION_URL/api/public/authority/register" \
  -H 'content-type: application/json' --data @registration.json

# Pending configuration
curl -sS "$ARC_COMPANION_URL/api/public/authority/configuration?authorityId=$ARC_AUTHORITY_ID"
```

Then confirm in the console at **Engine Registry → Trading Authority Registry**:
status `active`, a recent heartbeat, the expected engine version, and the
configuration version matching **Configuration → Active Runtime Configuration**.

### Incident additions

| Symptom | First check | Likely cause |
|---------|-------------|--------------|
| `503 KEY_UNCONFIGURED` | companion secret set? | signing key missing — fail-closed, as designed |
| `401 SIGNATURE_INVALID` | keys identical on both sides? | key mismatch or non-canonical payload |
| `401 TIMESTAMP_EXPIRED` | VPS clock (`timedatectl`) | clock drift beyond ±60s |
| `409 SIGNATURE_REPLAYED` | duplicate retry of the same signed body | re-sign each retry with a fresh timestamp |
| `409 CFG_HASH_MISMATCH` | published vs validated payload | engine validated a different version — republish |
| Registry stuck at `registered` | heartbeat loop running? | registration succeeded, heartbeats never started |
