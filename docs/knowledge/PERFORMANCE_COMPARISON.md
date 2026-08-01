# Phase 6B — Performance Comparison

Before/after measurements are anchored to the runtime evidence supplied for
Phase 6A (see `PHASE6_INVESTIGATION.md §5`). The Lovable sandbox does not
run the P4 process, so all runtime numbers are derived from the observed
cadences of the code paths that changed, not from a live measurement pass.
The operator should re-measure on the VPS with `pm2 logs edge5 --lines 500`
after the Phase 6B restart to confirm.

## 1. Log volume — LIVE credential-miss (F-3)

| Scenario | Before | After |
|---|---|---|
| Single failed `V2 LIVE` click | 1 × `error` line | 1 × `error` line |
| 5 clicks within 60 s | 5 × `error` lines | 1 × `error` + 4 × `warn (attempt #N)` |
| Sustained mis-provisioned autoresume (12 attempts / hour) | 12 × `error` / hour | 1 × `error` at the top of each hour + 11 × `warn` |

Impact: `error`-level noise on the credential path drops to ≤ 1 per
dedupe window. Total line count is preserved; the first failure is still
visible.

## 2. Log volume — Data-API HTTP 400 (F-1)

Baseline cadence: `FALLBACK_POLL_MS = 30_000`; each poll that hits a 400
emitted one multi-line warn.

| Scenario | Before (per hour) | After (per hour) |
|---|---|---|
| Empty wallet, no positions on Polymarket | 120 × warn (`account sync recovered with 2 source error(s)`) | 1 × warn at first hit + 11 × silent retries + 1 × info if the API recovers |
| Malformed `POLY_PROXY_ADDRESS` (F-2) | 120 × warn | 1 × warn at boot; zero further Data-API requests |

Impact: expected 99% reduction in Data-API-related log lines on any VPS
whose wallet has never traded on Polymarket.

## 3. Network cadence — Data-API polls (F-1 + F-2)

| Configuration | Before | After |
|---|---|---|
| Valid wallet with positions | 2 req / 30 s | 2 req / 30 s (unchanged) |
| Valid wallet, no positions | 2 req / 30 s (all 400) | 2 req / 30 s until first 400 → then 2 req / 5 min |
| Invalid `POLY_PROXY_ADDRESS` | 2 req / 30 s (all 400) | 0 req / session |

Impact: on an empty wallet, Data-API request rate falls from 240 req/h to
24 req/h (10× reduction); on a malformed address, from 240 req/h to 0.

## 4. Startup latency

| Path | Before | After |
|---|---|---|
| Constructor (`new Edge5Engine`) | Unchanged | Unchanged |
| Successful `start()` with valid LIVE creds | Unchanged | Unchanged (one extra branch on the happy path is O(5) env reads) |
| Failed `start()` with missing LIVE creds | Same — throws inside `LiveExecutor` constructor | Same — throw path is preserved |
| `setMode('LIVE_V2')` with missing creds | KV write + mode assign + bankroll ctor + log emit | Precheck fail → return early (**faster**), no KV write, no bankroll churn |

Impact: happy-path startup latency is identical. `setMode('LIVE_V2')` on a
mis-provisioned box is now measurably cheaper (no KV write, no `Bankroll`
construction, no notify).

## 5. Runtime CPU / memory (steady state)

None of the changes add a timer, cache, or per-tick allocation:

- `dataApiCold`, `addressPollable`, `dataApiLastAttemptMs` — three
  fields per `AccountSync` instance (there is at most one).
- `credentialErrorLastMs`, `credentialErrorAttempts` — two fields per
  engine (singleton).
- `LAST_CREDENTIAL_ERROR_MSG` — one static string.

No new `setInterval` / `setTimeout`. No new caches. No new WebSocket.
Steady-state RSS impact: ≤ 1 KB.

## 6. Dashboard responsiveness

The `V2 LIVE` control now returns a descriptive error message when the
underlying `setMode` is refused. Frontend can surface this in a toast
without any additional roundtrip — the string is delivered by the same
POST response. Existing dashboard code that only reads the returned
string continues to work.

## 7. What did NOT change

- Strategy tick cadence (50 ms).
- SLO tick.
- Reconciler (60 s), accounting verifier (5 min), DB maintenance
  (24 h), watchdog.
- CLOB price feed and User WS listener.
- All trading, settlement, PnL, and risk paths.
