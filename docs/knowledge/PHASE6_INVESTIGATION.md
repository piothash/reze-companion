# Phase 6A — Root Cause Investigation

**Status:** Investigation only. No code modified.
**Scope:** All runtime evidence enumerated in the Phase 6 charter (PM2 status, startup logs, HEALTH/STATUS/PREFLIGHT/ANALYTICS/TRADES endpoints, error logs, LIVE_V2 credential validation failures, HTTP 400 account sync failures, pipeline transitions, CLOB feed, watchdog, DB, risk, WS).
**Evidence sources:** repository under `reference/p4/` (frozen, read-only) cross-referenced with the runtime symptoms named in the user brief. Every claim below is anchored to a `path:line` in the repository. Where a symptom description is quoted from the brief without a paired log line, the anchor identifies the code path that produces the log verbatim.

---

## 0. Executive Verdict

| # | Reported symptom | Classification | Anchor |
|---|---|---|---|
| 1 | `Engine initialized in LIVE_V2` at every boot even when running PAPER | **Expected** (default class field + persisted-mode restore) | `engine.ts:79`, `engine.ts:177-188`, `engine.ts:237` |
| 2 | Pipeline hot-swapped to PAPER_V1 → Ignition ON → Ignition OFF → hot-swap back to LIVE_V2 → OFFLINE | **Expected operator flow**, but end-state is **defect-adjacent** — the last swap logs success while `start()` will silently fail on the next ignition attempt | `engine.ts:319-327`, `engine.ts:459-475`, `live.ts:76-88` |
| 3 | LIVE_V2 credential validation repeats | **Logging defect (excess)** — validation itself only runs inside `LiveExecutor` constructor and only when `start()` is called; the *repetition* comes from repeated ignition attempts, not a validation loop | `live.ts:76-88`, `engine.ts:322-327` |
| 4 | HTTP 400 on `positions` / `value` account sync | **Configuration + defensive-coding defect** — `AccountSync` fires a Data-API request whenever `getFunderAddress()` returns a non-null string, including an all-zeros or malformed address, and treats a 400 as a transient error instead of pausing the poll | `account-sync.ts:135-150`, `account-sync.ts:39-49`, `live.ts:398-399` |
| 5 | Engine remains OFFLINE after the LIVE_V2 hot-swap | **Correct behaviour of `start()` when creds are absent**, but the operator-facing signal is weak — the failure is a single `logEvent("error", …)` and the returned string is passed through the API without a structured status | `engine.ts:322-327`, `live.ts:83-88` |
| 6 | Duplicate startup work suspected | **Not confirmed** — the constructor is a singleton path; `spotFeed.start()` / `clobPriceFeed.start()` / `watchdog.start()` run exactly once per process; only `AccountSync` and the reconciler start/stop with ignition (correct) | `engine.ts:189-238`, `engine.ts:345-375`, `engine.ts:394-400` |

Two genuine defects, one logging defect, one operator-UX defect. All others are expected behaviour that should be documented rather than "fixed".

---

## 1. Startup Lifecycle — Intended vs Observed

### 1.1 Intended lifecycle (from code)

Boot (constructor `Edge5Engine`, `engine.ts:171-239`):
1. `mode` defaults to `LIVE_V2` at the class-field level (`engine.ts:79`).
2. KV read for `v2:pipeline-mode`; legacy `SHADOW_V2` migrated to `PAPER_V1` (`engine.ts:177-181`).
3. If the saved value is `LIVE_V2` or `PAPER_V1`, `this.mode` is overwritten (`engine.ts:182-188`).
4. Feeds + watchdog + standing-order manager start unconditionally (`engine.ts:189-230`).
5. `logEvent("info", "Edge 5 engine initialized in ${this.mode} (bot stopped, awaiting ignition)")` (`engine.ts:237`).
6. `maybeAutoResume()` re-ignites only if the previous session was running (`engine.ts:257-260`).

Ignition (`start`, `engine.ts:319-382`):
1. Build executor (`buildExecutor` → `new LiveExecutor()` or `new PaperExecutor(…)`, `engine.ts:322`, `engine.ts:650-657`).
2. `LiveExecutor` constructor throws if any of `POLY_PRIVATE_KEY`, `POLY_PROXY_ADDRESS`, `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE` is empty (`live.ts:76-88`).
3. On throw, `start()` catches, logs `error`, and returns the message string; **`running` stays `false`** (`engine.ts:322-327`).
4. On success: `running=true`, `AccountSync` instantiated and started (`engine.ts:345-360`), reconciler started (`engine.ts:363`), tick loop scheduled (`engine.ts:376`), `Ignition ON` logged (`engine.ts:379`).

Hot-swap (`setMode`, `engine.ts:459-475`):
1. Rejected if `running` (`engine.ts:460`).
2. KV write `v2:pipeline-mode = <mode>` (`engine.ts:465`).
3. `this.mode = mode`; PAPER seeding if needed (`engine.ts:466-470`).
4. `logEvent("info", "Pipeline hot-swapped to ${mode}")` (`engine.ts:473`).

### 1.2 Observed sequence explained

Symptom log line → source:

- `Engine initialized in LIVE_V2` → `engine.ts:237`. Emitted once per process. Value is `this.mode` **after** KV restore, so it reflects the persisted mode, not just the class-field default.
- `Pipeline hot-swapped to PAPER_V1` → `engine.ts:473`, reached only via `setMode('PAPER_V1')`. This is an **operator action** (dashboard control or admin API), not autonomous.
- `Ignition ON — PAPER_V1 pipeline armed` → `engine.ts:379`. `PaperExecutor` never throws (no cred check, `execution/paper.ts`).
- `Ignition OFF — all resting orders dropped` → `engine.ts:402`. Operator action.
- `Pipeline hot-swapped to LIVE_V2` → `engine.ts:473`. Operator action; permitted because `running` is false.
- `Engine remains OFFLINE` → next `start()` call attempts `new LiveExecutor()`, that throws at `live.ts:83-88`, `start()` catches and returns without setting `running` (`engine.ts:322-327`). No `Ignition ON` is emitted, hence "remains OFFLINE".

**Verdict:** the sequence is the *correct* behaviour of an operator toggling modes on a box where LIVE credentials are missing. It is not a state-machine bug. The weak point is the operator UX: the failed ignition surfaces only as a single error log line, and the persisted mode is now `LIVE_V2`, so the *next* auto-resume (if `engine:running` were still `"1"`) would also fail. See §8 fix item **F-4**.

---

## 2. LIVE Credential Validation

### 2.1 Where validation runs

- Single site: `LiveExecutor` constructor, `live.ts:76-88`. Presence check on five env vars, throws with a fixed message on any miss.
- No standalone "validator" module, no periodic retry, no polling.

### 2.2 Why the log appears to "repeat"

- Every call to `engine.start()` with `mode = LIVE_V2` and missing creds throws and logs once at `engine.ts:325` (`logEvent("error", msg)`).
- The message includes the full sentence at `live.ts:84-87`.
- Repetition therefore equals the number of ignition attempts (dashboard `Start` clicks, `maybeAutoResume` retries, or a wrapper script polling `/api/v2/bot/control`). It is **not** a loop inside the validator.

### 2.3 Classification

- **Validation logic:** correct and idempotent.
- **Logging:** each attempt logs the same 200-character line at `error` severity. On PM2 this is legitimate — every failed ignition attempt deserves a record — but it is **misleading** because it looks like a background retry loop.

### 2.4 Recommendation (Phase 6B candidate)

- Emit the credential-miss error at `warn` if the previous emission was within N seconds, or annotate the message with an attempt counter (`attempt #3`).
- Reject `setMode('LIVE_V2')` when creds are absent so the mode never gets persisted on a mis-provisioned box — see §8 fix item **F-4**.

Do **not** change the throw itself: it is the single source of truth that prevents `LIVE_V2` from executing without credentials.

---

## 3. HTTP 400 on Account Sync (`positions`, `value`)

### 3.1 Request path

`AccountSync.refresh` (`account-sync.ts:128-214`) issues five parallel calls:

- `executor.getAvailableBalanceUsd()` — CLOB SDK.
- `executor.getOpenOrdersLive()` — CLOB SDK.
- `executor.getRecentTradesLive()` — CLOB SDK.
- `fetch(<DATA_API_HOST>/positions?user=<address>&sizeThreshold=0.1&limit=100&sortBy=CURRENT&sortDirection=DESC)` — `account-sync.ts:141-146`.
- `fetch(<DATA_API_HOST>/value?user=<address>)` — `account-sync.ts:147-149`.

`address` is `this.executor.getFunderAddress?.() ?? null` (`account-sync.ts:135`). In `LiveExecutor` this is `env.POLY_PROXY_ADDRESS || null` (`live.ts:398-399`). `DATA_API_HOST` defaults to `https://data-api.polymarket.com` (`config.ts:36`).

### 3.2 Why HTTP 400 occurs

`fetchJson` throws on any non-2xx (`account-sync.ts:44`, `throw new Error(\`HTTP ${res.status}\`)`), and the failure is recorded in `errors[]` and logged as `warn` at `account-sync.ts:216-222`. Polymarket's public Data API is known to return **HTTP 400** for the following, all of which are reachable from this code path:

1. `user=` empty or missing — impossible here (`address` gates the call at `account-sync.ts:141-149`).
2. `user=<addr>` where `<addr>` is syntactically an address but has never held a position/value on Polymarket — the `/positions` endpoint returns 400 rather than an empty array for uninitialised addresses.
3. `user=<addr>` where the address casing / checksum is not accepted by the endpoint.
4. Rate-limit / query-param drift on the Data API (out-of-band change on Polymarket's side).

The likely production cause on the current VPS is (2) or (3): `POLY_PROXY_ADDRESS` is set (so `AccountSync` starts), but that address either has no history or is not accepted verbatim by the Data API.

### 3.3 Failure mode

- 400 is caught, logged with `Trading impact: NONE` (`account-sync.ts:216-222`) because balance + open orders came from the CLOB SDK and succeeded.
- `positions` and `portfolioValueUsd` end up empty / `null` in the cache (`account-sync.ts:161-192`).
- The dashboard shows "0 positions / value unknown" while trading is unaffected.
- The fallback timer keeps re-issuing the same request every `FALLBACK_POLL_MS = 30_000` ms (`account-sync.ts:33`, `account-sync.ts:90-93`), so the same 400 recurs indefinitely.

### 3.4 Classification

- **`positions` / `value` 400 with no positions:** expected behaviour of the upstream API; the client should **suppress the repeat** rather than fix the URL. Genuine defect: no backoff / no distinction between "wallet has nothing" and "endpoint is broken". Log noise scales linearly with uptime.
- **`positions` / `value` 400 with malformed address:** configuration issue on the VPS, not a code defect, but the client should surface it clearly instead of hiding it inside a multi-line warn.

### 3.5 Recommendation (Phase 6B candidate)

- In `AccountSync.refresh` (`account-sync.ts:137-192`), on a 400 from `/positions` or `/value`:
  - classify as "empty account" and cache `positions=[]`, `portfolioValueUsd=0`;
  - back off the Data-API portion of the sync to a slower cadence (e.g. 5 min) until the next non-400 response;
  - emit the warn line **once** per state transition, not every 30 s.
- Validate `POLY_PROXY_ADDRESS` shape (`^0x[0-9a-fA-F]{40}$`) at boot and refuse to start `AccountSync` if it fails, logging the specific reason.

See §8 fix item **F-1**.

---

## 4. Startup Performance Audit

### 4.1 Initialization order (from constructor + `start`)

Constructor (`engine.ts:171-239`), runs exactly once per process:

| Order | Work | Site | Duplicate? |
|---|---|---|---|
| 1 | KV read `v2:pipeline-mode` | `engine.ts:177-188` | No |
| 2 | `startClockSync()` | `engine.ts:189` | No |
| 3 | `closeOrphanedOpenTrades()` | `engine.ts:194` | No |
| 4 | `spotFeed.start()` | `engine.ts:195` | No |
| 5 | `clobPriceFeed.start()` | `engine.ts:196` | No |
| 6 | `new StandingOrderManager(...)` | `engine.ts:198-205` | No |
| 7 | `restoreConfig()` | `engine.ts:209` | No |
| 8 | `getTelegram(this)` | `engine.ts:213` | No (module singleton) |
| 9 | `initNotifier()` | `engine.ts:216` | No |
| 10 | `new Watchdog(...); watchdog.start()` | `engine.ts:220-230` | No |
| 11 | DB maintenance timers | `engine.ts:233,236` | No |
| 12 | `logEvent("info", …initialized…)` | `engine.ts:237` | No |
| 13 | `maybeAutoResume()` | `engine.ts:238` | Conditional (only if previous run was ignited) |

`start()` (`engine.ts:319-382`), runs on each ignition:

| Order | Work | Site | Notes |
|---|---|---|---|
| 1 | `buildExecutor()` | `engine.ts:322` | Throws on missing LIVE creds |
| 2 | `armMarket(this.slotEndMs)` | `engine.ts:340` | Idempotent per slot |
| 3 | `syncLiveBalance()` | `engine.ts:346` | Fire-and-forget |
| 4 | `getOrderEventListener().setMarkets(...)` | `engine.ts:350` | Opens/updates User WS |
| 5 | `new AccountSync(this.executor); start()` | `engine.ts:355-360` | Kicks first REST pass immediately (`account-sync.ts:88`) |
| 6 | `reconciler.start()` | `engine.ts:363` | 60 s loop |
| 7 | `startAccountingVerifier(...)` | `engine.ts:367-374` | 5 min loop |
| 8 | `setInterval(tick, 50 ms)` | `engine.ts:376` | Main strategy loop |
| 9 | KV writes + `logEvent Ignition ON` + `notify` | `engine.ts:377-380` | |

### 4.2 Duplicates / redundancy

- **Duplicate initialization on ignition:** none. All singletons are constructed in the constructor; `start()` only instantiates request-scoped objects (`AccountSync`) and starts loops.
- **Duplicate timers:** none detected. `setInterval` occurrences (`engine.ts:233`, `engine.ts:376`, `account-sync.ts:90`, plus the reconciler / verifier / watchdog / SLO loops) are each guarded (`if (!this.fallbackTimer)` at `account-sync.ts:89`, `if (this.loop) clearInterval(this.loop)` at `engine.ts:387-388`).
- **Duplicate WS subscriptions:** the User WS is centralised in `getOrderEventListener()` and re-pointed via `setMarkets` (`engine.ts:350`); the CLOB price feed is a single `ClobPriceFeed` singleton (`engine.ts:92`).
- **Duplicate polling:** the only overlapping timers are `AccountSync`'s 30 s fallback and the reconciler's 60 s loop — different concerns, no work overlap.
- **Repeated configuration loading:** `restoreConfig()` runs once (`engine.ts:209`). `env` is a frozen object imported from `config.ts`.
- **Repeated engine initialization:** the engine class is a single-tenant singleton per process. There is **no evidence in the source** of a second `new Edge5Engine()` being constructed anywhere; PM2 restart implies a fresh process, which is the intended reset.

### 4.3 Measurable startup opportunities

- The first `AccountSync.refresh("start", true)` (`account-sync.ts:88`) runs **before** the first tick and issues five parallel network calls, two of which can 400 (see §3). Moving it behind a short defer (e.g. after the first successful CLOB quote) would smooth the first-second CPU/network burst on boot without changing correctness.
- `syncLiveBalance()` (`engine.ts:346`) is fire-and-forget but adds another concurrent SDK call at ignition. It could piggyback on the first `AccountSync` result.

Neither is required. Both are candidate Phase 6B improvements.

---

## 5. Runtime Performance Audit

| Subsystem | Cadence | Site | Notes |
|---|---|---|---|
| Strategy tick | 50 ms | `engine.ts:376` | Guarded by `busy` flag |
| SLO tick | independent | `standing-order.ts` | Watchdog kicks if wedged (`engine.ts:227-228`) |
| Reconciler | 60 s | `reconciler.ts` | Started only while ignited (`engine.ts:363`, `engine.ts:397`) |
| Accounting verifier | 5 min | `accounting-verifier.ts` | Started only while ignited |
| DB maintenance | 24 h + 60 s kickoff | `engine.ts:233,236` | Idempotent |
| CLOB price feed | continuous WS | `clob-price-feed` | Single instance |
| Spot feed | Chainlink polled | `spotFeed` | Single instance |
| Watchdog | process-life | `engine.ts:230` | Single instance |
| AccountSync fallback | 30 s | `account-sync.ts:33,90-93` | Only while ignited; **repeats 400s** — see §3 |
| Order-event WS | continuous | `getOrderEventListener()` | Repointed via `setMarkets` |

No stray high-frequency timers, no `setInterval(fn, 0)` polling, no per-tick network calls. The one visible inefficiency is the repeating 400 in §3.

---

## 6. Logging Audit

| Log line | Emitter | Frequency | Classification |
|---|---|---|---|
| `Edge 5 engine initialized in <mode>` | `engine.ts:237` | Once/process | Required |
| `Pipeline hot-swapped to <mode>` | `engine.ts:473` | Per operator action | Required |
| `Ignition ON — <mode> pipeline armed` | `engine.ts:379` | Per successful start | Required |
| `Ignition OFF — all resting orders dropped` | `engine.ts:402` | Per stop | Required |
| `LIVE_V2 requires a signing key …` | `live.ts:83-87` via `engine.ts:325` | Per failed ignition | **Excessive when the operator retries** — dedupe (see §2) |
| `[LIVE_V2] account sync (<reason>) recovered with N source error(s)` | `account-sync.ts:219-222` | Every 30 s while 400 persists | **Excessive** — see §3 |
| `[LIVE_V2] account synced (<reason>): $X avail, N pos, M open` | `account-sync.ts:224` | Every refresh | Required (info level) |
| `Previous session was running — auto-resuming ignition in 5s` | `engine.ts:259` | Once/boot conditional | Required |
| `Standing limit order RESTORED after restart …` | `standing-order.ts:449` | Once/boot conditional | Required |
| `[DB] maintenance: …` | `engine.ts:246` | Once + daily | Required |

No misleading log lines detected. Two categories flagged as excessive; both are covered by the fix plan.

---

## 7. Architecture Audit

Searched for the following patterns in `reference/p4/lib/v2/engine/` and `reference/p4/app/api/v2/`:

- **Dead code / unreachable branches:** the `SHADOW_V2` legacy branch at `engine.ts:178-181` is intentionally live (migration path). No other unreachable branches surfaced.
- **Duplicated logic:** `restoreConfig`'s "clear forced edge5" one-time migration (`engine.ts:295-310`) is intentional and gated by a KV flag — not duplication.
- **Race conditions:**
  - `AccountSync.refresh` is guarded by `syncing` (`account-sync.ts:130,132,214`) and a `MIN_REST_INTERVAL_MS` throttle (`account-sync.ts:131`) — safe.
  - `engine.start()` guards `running` (`engine.ts:320`) but does **not** null out `this.executor` on failure — if a subsequent `setMode` swaps back to PAPER, a stale `LiveExecutor` reference cannot linger because `buildExecutor()` runs on every `start()` (`engine.ts:322`). Safe.
  - `Watchdog` calls `kickSlo` from a separate timer; `StandingOrderManager.kickLoop` is documented as repair-only and does not mutate order state.
- **Memory leaks:** no unbounded caches in the audited scope. `AccountSync.cache` is a bounded snapshot. Bankroll history and ledger writes are DB-backed with retention pruning (`db.ts:667`).
- **Timer leaks:** `stop()` clears the tick loop (`engine.ts:387-388`), stops account sync (`engine.ts:396`), reconciler (`engine.ts:397`), and accounting verifier (`engine.ts:398`). DB maintenance timers persist for the process lifetime (correct). `AccountSync.debounceTimer` and `fallbackTimer` are both cleared in `stop()` (`account-sync.ts:100-107`).
- **WebSocket leaks:** `closeOrderEventListener()` is called on `stop()` (`engine.ts:400`). CLOB price feed is process-lifetime by design.
- **Stale caches:** `AccountSync` retains its cache after `stop()` (`account-sync.ts:97` "Cache is retained for display") — intentional, matches dashboard behaviour.
- **Repeated API calls:** the only concerning one is the recurring Data-API 400 (§3).
- **Repeated DB queries:** none surfaced. Writes go through the write queue (`db.ts`); reads are point queries.

No new architectural defects surfaced beyond those already captured in §3–§4.

---

## 8. Prioritised Fix Plan (Phase 6B input)

Ordered by production impact, gated by "only fix genuine defects; do not modify accepted limitations from Phase 3".

| ID | Priority | Fix | Anchor | Justification |
|---|---|---|---|---|
| **F-1** | HIGH | Suppress recurring 400s from the Data-API portion of `AccountSync`: classify 400 as "empty/unknown account", cache empty positions + `portfolioValueUsd=0`, back the Data-API calls off to ≥5 min until a non-400 response arrives, and log the state transition once. | `account-sync.ts:137-192, 216-222` | Removes the primary noise source and stops a permanent 30-s failure loop. Zero risk to trading (Data API is display-only per `account-sync.ts:14-15`). |
| **F-2** | HIGH | Validate `POLY_PROXY_ADDRESS` format at `AccountSync` startup (regex `^0x[0-9a-fA-F]{40}$`); if it fails, skip the Data-API polling entirely and log the reason once. | `account-sync.ts:75-95`, `live.ts:398-399` | Distinguishes "misconfigured address" from "upstream 400", which today are collapsed. |
| **F-3** | MEDIUM | Dedupe repeat credential-error logs: if the same "LIVE_V2 requires …" error was emitted in the last 60 s, downgrade to `warn` with an attempt counter. | `engine.ts:322-327`, `live.ts:83-88` | Kills log-spam while preserving the first failure at `error`. |
| **F-4** | MEDIUM | Reject `setMode('LIVE_V2')` when the five LIVE env vars are missing; return a structured error the dashboard can display, and stop persisting an unreachable mode into KV. | `engine.ts:459-475`, `live.ts:76-88` | Prevents the observed dead-end where the KV is `LIVE_V2` on a box that can never ignite. |
| **F-5** | LOW | Move the first `AccountSync.refresh("start", true)` behind a short defer (e.g. next tick after first CLOB quote) to smooth the ignition-time network burst. | `account-sync.ts:86-95`, `engine.ts:355-360` | Optional perf polish. |
| **F-6** | LOW | Fold `syncLiveBalance()` into the first `AccountSync` pass to avoid a redundant CLOB call at ignition. | `engine.ts:346`, `account-sync.ts:137-138` | Optional perf polish. |

Not fixing (documented, not defects):
- Default mode `LIVE_V2` at `engine.ts:79` — persisted-mode restore overrides it; changing the default would be a behavioural change with no evidence of harm.
- `LiveExecutor` throwing on missing creds — this is the core guarantee that PAPER cannot silently become LIVE.
- Cache retention in `AccountSync` after `stop()` — explicit design decision.

Nothing in this plan modifies the accepted limitations T-1..T-6 from `PHASE3_FINAL_CERTIFICATION.md`.

---

## 9. Evidence Gaps (still requires live logs)

The following claims in this document are code-derived and would be strengthened by matching runtime log lines. None of them affect the classification above:

- Exact ordering and timestamps of the `LIVE_V2 → PAPER_V1 → LIVE_V2` transitions (only the code paths that emit each log are proven; the sequence itself is asserted from the brief).
- Confirmation that the observed HTTP 400 originates from `positions` / `value` specifically (both endpoints share the same error handler; a log excerpt would disambiguate).
- Which of the two `AccountSync` 400 causes (empty wallet vs malformed address) is present on the target VPS. F-1 handles both; F-2 disambiguates for future operators.

If the operator can paste a 60-second window of PM2 stdout that covers a boot + one ignition attempt + one account-sync cycle, every remaining gap closes without additional investigation.

---

## 10. Stop

Phase 6A investigation complete. **No source under `reference/p4/` was modified.** Awaiting approval to begin Phase 6B implementation of F-1..F-4 (F-5, F-6 optional).
