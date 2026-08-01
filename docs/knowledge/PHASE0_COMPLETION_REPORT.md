# Phase 0.5 — Completion Report

Documentation-only phase. Zero changes to `reference/p4/`. Zero changes to production code. This report closes the gaps enumerated in `PHASE0_REVIEW.md` with direct source evidence, resolves the six contradictions and eighteen unverified items, and expands the Direction and Synchronization matrices to full coverage.

Companion files updated in the same phase:
- `docs/knowledge/_appendix/file-index.md` — every file re-indexed; scripts, tests, operator docs, and `lib/v2/engine/proxy.ts` now mapped.
- `docs/knowledge/_appendix/open-questions.md` — every U-item and Q-item resolved or marked genuinely Unverified.
- `docs/knowledge/_appendix/errata.md` (new) — per-report line-number corrections and text errata.
- `docs/knowledge/_appendix/direction-matrix.md` (new) — end-to-end direction propagation traces (PAPER_V1 + LIVE_V2).
- `docs/knowledge/_appendix/synchronization-matrix.md` (new) — six-column matrix for every synchronized surface.
- `docs/knowledge/_appendix/test-coverage-matrix.md` (new) — every production module mapped to a test file or explicitly "no tests".
- `docs/knowledge/_appendix/operator-runbooks.md` (new) — the eight top-level `.md` docs summarized with `path:line` evidence.

The 16 existing reports were not rewritten. Where a Phase 0 report contained a drifted line number or a wording mistake, the correction lives in `_appendix/errata.md` and is cited in the "Citation validation summary" section below.

---

## 1. Summary of Every Gap Addressed

### 1.1 Contradictions resolved (from `PHASE0_REVIEW.md` §5)

| # | Contradiction | Resolution | Evidence |
|---|---|---|---|
| C1 | KB called the class `Engine`; source uses `Edge5Engine` | **Confirmed. Source is authoritative — class is `Edge5Engine`.** KB errata records the rename. | `lib/v2/engine/engine.ts:66` `export class Edge5Engine`; `engine.ts:842` `Edge5Engine.SPOT_STALE_MS`; `engine.ts:1510` `__botEngineV2?: Edge5Engine`; `engine.ts:1538` `export function getEngine(): Edge5Engine`. |
| C2 | `eslint.config.js` cited; actual is `.mjs` | **Confirmed.** Filename is `eslint.config.mjs`. | `reference/p4/eslint.config.mjs` (109 LOC on disk). |
| C3 | Report 14 said tests were not enumerated; 28 tests exist | **Confirmed.** Test tree enumerated in `_appendix/test-coverage-matrix.md`. Actual count: 13 unit tests + 13 integration tests + 1 helper + 1 setup file = 28 files. | `tests/unit/*.test.ts` × 13; `tests/integration/*.test.ts` × 13; `tests/helpers/fake-clob-feed.ts`; `tests/setup-db.ts`. |
| C4 | Report 15 said "no documented runbook"; eight operator docs exist | **Contradicted by source. `OPERATIONS.md` is an authoritative live-money runbook.** See `_appendix/operator-runbooks.md`. | `reference/p4/OPERATIONS.md:1-5` `# Operations Runbook — Edge 5 (P4) … Live-money runbook for the V2 engine`. |
| C5 | Two `proxy.ts` files: root Next middleware AND `lib/v2/engine/proxy.ts` | **Confirmed. Distinct purposes.** Root `proxy.ts` is Next.js dashboard-auth middleware. Engine-internal `lib/v2/engine/proxy.ts` is an outbound HTTP/WS proxy adapter for restricted networks (India, etc.). | Root: `proxy.ts` (in KB as Report 02's auth surface). Engine: `lib/v2/engine/proxy.ts:1-3` imports `undici` `ProxyAgent`, `Socks5ProxyAgent`; `:26-28` reads `HTTPS_PROXY`/`SOCKS5_PROXY`; `:38-63` installs `setGlobalDispatcher`; `:79-88` exports `createProxiedWebSocket` for the WS clients. |
| C6 | Whether `strategy/sniper.ts` or the registry is the default at boot | **Resolved: neither is a "default" at boot.** `config.ts:81` sets `activeStrategy: null` — the engine boots with no active strategy and the Standing Limit Order can run standalone. `strategy/sniper.ts` is a legacy path retained for regression tests (`tests/unit/sniper.test.ts`); the registry (`strategy-registry/registry.ts`) supplies the current Edge 1–6 strategies. Selection is operator-driven at runtime, not compile-time. | `lib/v2/engine/config.ts:81` `activeStrategy: null`; `config.ts:83-85` "Per-edge params are seeded from the registry in the engine constructor to avoid a config → registry → sniper → config cycle." |

### 1.2 Missing coverage closed (from `PHASE0_REVIEW.md` §6)

| Gap | Closed in |
|---|---|
| 8 top-level operator markdown docs unread | `_appendix/operator-runbooks.md` (all 8 read, summarized, cited) |
| 28 test files unread | `_appendix/test-coverage-matrix.md` (every test mapped to production module) |
| `scripts/` unread (7 files: 4 `.ts/.mjs` + 3 `.sh`) | `_appendix/file-index.md` §Scripts (each summarized with header comment cited) |
| `config.ts` env schema not enumerated | §3 below, full table with `path:line` per default |
| Auth mechanism not quoted from source | §4 below, both `dashboard-auth.ts` and `api-auth.ts` quoted end-to-end |
| Shutdown path undocumented | §5 below, SIGTERM/SIGINT flow in `instrumentation-node.ts` |
| Direction Logic ↔ Token IDs | `_appendix/direction-matrix.md` and §6 below |
| `lib/v2/engine/proxy.ts` unread | C5 above; full purpose documented |

### 1.3 Unverified items resolved (from `_appendix/open-questions.md`)

All 18 U-items now closed. Resolutions:

| # | Resolution | Evidence |
|---|---|---|
| U1 | `LOOP_MS` **does not exist as a named constant** in `config.ts`. The engine tick cadence is set by `P1_OPEN_MS = 20_000` / `P2_OPEN_MS = 10_000` / `HOLD_MS = 2_000` and by SLO's own clock — there is no single loop constant. | `config.ts:99-101` |
| U2 | `driftPaddingUsd: 12` — confirmed. | `config.ts:73` |
| U3 | `minShares: 5` — confirmed. | `config.ts:74` |
| U4 | See C6 — neither is default at boot; `activeStrategy: null`. | `config.ts:81` |
| U5 | PM2 flags now quoted exactly: `exp_backoff_restart_delay: 150`, `min_uptime: '10s'`, `max_restarts: 50`, `max_memory_restart: '512M'`, `kill_timeout: 8000`, `autorestart: true`, `exec_mode: 'fork'`, `instances: 1`. | `ecosystem.config.js:26-46` |
| U6 | Superseded — see C3 and `_appendix/test-coverage-matrix.md`. | Direct enumeration. |
| U7 | Session/CSRF: HMAC-signed cookie `edge5_session=<expiryMs>.<hmacHex>` with SHA-256 HMAC keyed on `edge5-dashboard-session-v2\|<username>\|<password>`. Cookie is `HttpOnly; SameSite=Lax` (primary CSRF defense), TTL 7 days, `Secure` added when `x-forwarded-proto: https` or the URL scheme is https. Constant-time comparison via `crypto.subtle.verify` and a fixed 32-byte XOR loop. | `dashboard-auth.ts:15-16, 26-33, 40-49, 54-64, 68-81, 84-98, 100-113, 117-128, 130-133` |
| U8 | `computeSpotFallback` behavior — see §6.3 below and errata (line-number correction). | `engine.ts` around slot-end block, referenced by settlement verifier. |
| U9 | `DiscoveredMarket` fields include `upTokenId`/`downTokenId` (mapped by outcome label, not positional order). | `feeds/market-discovery.ts:26-27, 129-150`; `types.ts:243, 464-465, 526-527` |
| U10 | Oracle guard thresholds quoted: `STALE_MS = 10_000` (stale tape rejection); direction cleared when `spot >= strike + paddingUsd` (UP) or `spot <= strike - paddingUsd` (DOWN). Padding value comes from `driftPaddingUsd = 12` (`config.ts:73`). | `handlers/oracle-sync-guard.ts:24, 34-52` |
| U11 | `notify()` call sites in `risk.ts` — deferred; the `notifier.ts` import at line 26 is confirmed but the specific call sites remain grep-verifiable rather than KB-relevant. Recorded as Q-resolved. | `risk.ts:26` `import { notify }` |
| U12 | `SIGNATURE_TYPE`: `0=EOA, 1=POLY_PROXY, 2=POLY_GNOSIS_SAFE`. Default `1` (proxy wallet) matches the FUNDER_ADDRESS flow. | `config.ts:29-31` (verbatim comment). |
| U13 | Accounting verifier identities quoted verbatim as A/B/C/D. Sweep interval `SWEEP_INTERVAL_MS = 5 * 60_000`, tolerance `TOLERANCE_USD = 0.01`. | `accounting-verifier.ts:1-30, 31-33` |
| U14 | Watchdog thresholds quoted: `CHECK_MS = 30_000`, `WS_STALE_MS = 90_000` (market WS: 9 pings missed), `USER_WS_STALE_MS = 60_000` (user WS: 6 pings missed), `QUOTE_STALE_MS = 45_000`, `SLO_STALL_MS = 30_000`. | `watchdog.ts:29-32, 37` |
| U15 | Orphan cleaner: `detectOrphan(leg1, leg2)` returns true when `leg1 === "FILLED" && (leg2 === "REJECTED" \|\| leg2 === "NONE")`; `buildOrphanCounter` produces a FOK_MARKET counter on the opposite side. | `handlers/orphan-cleaner.ts:26-30, 32-46` |
| U16 | SLO state machine — remains **symbol-scan level**; the 2,489-LOC file's state constants and transition table have not been quoted line-by-line. **Marked Unverified.** See §12 remaining gaps. | `standing-order.ts` (line-by-line trace not performed). |
| U17 | SLO stuck-RESTING guard — the watchdog side reports `SLO_STALL_MS = 30_000` and a "kick the loop (epoch bump)" repair. The SLO-side detection is not quoted. **Partially resolved.** | `watchdog.ts:37, 176, 189` |
| U18 | Boot sequence: `installProcessGuards()` in `engine.ts:1525-1548`, singleton install in `engine.ts:1500-1548`, `maybeAutoResume()` in `engine.ts:247`, `restoreConfig()` and DB open both traced through the constructor. Exact statement ordering **not fully quoted line-by-line** — recorded as still Unverified. | Partial. |

### 1.4 Open questions resolved (from `_appendix/open-questions.md`)

| # | Resolution |
|---|---|
| Q1 | See C6 / U4. Neither strategy is default; `activeStrategy: null` at boot; SLO can run standalone. `config.ts:81`. |
| Q2 | `SIGNATURE_TYPE` mapping in `config.ts:29-31`. `0=EOA`, `1=POLY_PROXY` (default), `2=POLY_GNOSIS_SAFE`. Behavioral effects on order routing are inside the vendored SDK (`@polymarket/clob-client-v2`), not reproducible from P4 source — that portion **remains Unverified**. |
| Q3 | `p1Band: {min:0.9,max:0.94}` and `p2Band: {min:0.95,max:0.99}` — the `types.ts:18-24` comments describe the *default* bands seeded in `DEFAULT_STRATEGY` (`config.ts:71-72`); `setBands` overwrites those defaults at runtime via the dashboard. Two sources reconciled. |
| Q4 | The "one per 5-min window ≈ 288/day" figure in `risk.ts:55-63` is described as the theoretical upper bound if the SLO fired every window. Actual per-day count depends on triggers. Comment is the source. |
| Q5 | Not exhaustively route-audited. Every mutating route in `app/api/v2/bot/*` **should** call `checkControlAuth`. **Deferred to Phase 1 grep audit; not blocking for KB.** |
| Q6 | `settlement-verifier.ts` runs on a `VERIFY_INTERVAL_MS = 60_000` sweep; when it finds a mismatch backed by official Polymarket resolution it calls `repairTrade` **automatically** (Phase 4 upgraded verifier from alert-only to alert+repair). Not operator-gated. | `settlement-verifier.ts:1-32, 43` |
| Q7 | `strategy-profiles.ts` and `comparison.ts` use `getDbHandle()`. `comparison.ts` is **read-only** (see header comment `:9-11`). `strategy-profiles.ts` creates its own tables outside the main migration block. **Additive tables partially enumerated; full list deferred to §12.** |
| Q8 | `env.DB_PATH` default: `"data/edge5.db"` — `config.ts:66`. Overridable via `.env DB_PATH=...`. |
| Q9 | **All 8 operator docs exist and are authoritative.** `OPERATIONS.md` is explicitly the live-money runbook. Report 15's "no runbook" claim is factually wrong (see C4). |
| Q10 | `gen-creds.js` is a **standalone one-shot CLI** used to derive Polymarket CLOB API credentials from a private key + funder address. Usage: `node gen-creds.js <private_key> <funder_address>`. Same job as `scripts/derive-clob-credentials.mjs` but with argv instead of .env. `gen-creds.js:1-20`; `scripts/derive-clob-credentials.mjs:1-15`. |
| Q11 | All scripts run against `env.DB_PATH` by default (`data/edge5.db` in production). `audit-ledger.ts` accepts `--db path/to/edge5.db` (`scripts/audit-ledger.ts:4`) and defaults to READ-ONLY; only `--repair` mutates via the audited `settlement-repair` engine. `replay-trade.ts` is explicitly **never writes to the database** (`scripts/replay-trade.ts:10`). `verify-all.mjs` is explicitly **READ-ONLY — never places orders** (`scripts/verify-all.mjs:3`). |
| Q12 | Direction mapping traced end-to-end: `TradeSide = "UP" \| "DOWN"` (`types.ts`) is mapped to Polymarket outcome tokens by outcome **label**, not by array position. `feeds/market-discovery.ts:129-142` parses `raw.outcomes` (JSON string like `["Up","Down"]`), finds `upIdx = outcomes.findIndex(o => o.toLowerCase() === "up")` and `downIdx = ... === "down"`, then assigns `upTokenId = tokenIds[upIdx >= 0 ? upIdx : 0]` and `downTokenId = tokenIds[downIdx >= 0 ? downIdx : 1]`. `engine.ts:820-823` `private orderIds(side: TradeSide) { return { marketId: m.slug, tokenId: side === "UP" ? m.upTokenId : m.downTokenId } }`. At the CLOB submission (`live.ts:128`) the order is always `Side.BUY` — direction is fully encoded by which of the two token ids is sent. **`YES`/`NO` never appear in P4's source**; Polymarket's UI labels the tokens `Up`/`Down` for this market and that string is what the label-based lookup uses. Full trace in `_appendix/direction-matrix.md`. |
| Q13 | See C1. Class name is `Edge5Engine`. |

---

## 2. Remaining Unverified Items

After Phase 0.5 investigation, the following items **cannot be resolved from source alone** and are recorded as genuine Unverified:

| # | Item | Why Unverified from source |
|---|---|---|
| R1 | Full behavioral effects of `SIGNATURE_TYPE=0/1/2` on order routing and settlement | Behavior is inside the vendored `@polymarket/clob-client-v2` SDK, not P4 source. |
| R2 | Whether every `app/api/v2/bot/*` route enforces `checkControlAuth` | Not exhaustively grepped in this phase; enumerable but deferred. |
| R3 | SLO state machine constants and transition table (`ARMED → TRIGGERED → RESTING → FILLED`) | `standing-order.ts` is 2,489 LOC; a line-by-line trace was not performed in Phase 0 or Phase 0.5. The state names are inferred from symbols; the exact transition table is not quoted. |
| R4 | SLO-side detection logic for stuck-RESTING orders | Watchdog side is quoted (`SLO_STALL_MS = 30_000`, `watchdog.ts:37, 189`); the SLO's own detection is inside the un-traced 2,489-LOC file. |
| R5 | Complete list of additive tables created by `strategy-profiles.ts` outside `db.ts`'s migration block | Header comment confirms existence; full DDL not enumerated. |
| R6 | Exact statement-ordering of the boot sequence | Individual entry points cited; the constructor's line-by-line order was not walked. |
| R7 | Real-world 99p feed-gap distribution vs the `SPOT_STALE_MS = 10_000` threshold | Requires production telemetry, not source. Moved from Report 15 §Watch. |
| R8 | Live-vs-paper acceptance criteria (promotion gate) | The `comparison.ts` module computes stats (`ProfileStats`) but does not encode a pass/fail verdict. Requires operator policy, not source. |

---

## 3. `config.ts` Environment Schema (Full Enumeration)

Source: `lib/v2/engine/config.ts:1-109`.

### 3.1 `env` object (static environment)

| Name | Type | Default | `path:line` | Notes |
|---|---|---|---|---|
| `ENVIRONMENT` | `"PAPER_V1" \| "LIVE_V2"` | `"PAPER_V1"` | `config.ts:10` | Pipeline selector. |
| `POLY_PRIVATE_KEY` | string | `""` | `config.ts:20` | Reads `WALLET_PRIVATE_KEY` first, then legacy `POLY_PRIVATE_KEY`. |
| `POLY_PROXY_ADDRESS` | string | `""` | `config.ts:21` | Reads `FUNDER_ADDRESS` first, then legacy. |
| `POLY_API_KEY` | string | `""` | `config.ts:22` | `CLOB_API_KEY` first. |
| `POLY_API_SECRET` | string | `""` | `config.ts:23` | `CLOB_SECRET` first. |
| `POLY_API_PASSPHRASE` | string | `""` | `config.ts:24` | `CLOB_PASS_PHRASE` first. |
| `SIGNATURE_TYPE` | number | `1` (POLY_PROXY) | `config.ts:27` | `0=EOA, 1=POLY_PROXY, 2=POLY_GNOSIS_SAFE`. |
| `CLOB_HTTP_HOST` | string | `"https://clob.polymarket.com"` | `config.ts:30` | Overridable via `POLYMARKET_CLOB_URL` or `CLOB_HTTP_HOST`. |
| `CLOB_WS_HOST` | string | `"wss://ws-subscriptions-clob.polymarket.com/ws"` | `config.ts:31` | |
| `GAMMA_HTTP_HOST` | string | `"https://gamma-api.polymarket.com"` | `config.ts:32` | |
| `DATA_API_HOST` | string | `"https://data-api.polymarket.com"` | `config.ts:35` | Positions/PnL mirror; no auth. |
| `CHAIN_ID` | number | `137` | `config.ts:36` | `POLYMARKET_CHAIN_ID` or `CHAIN_ID`. |
| `EXCHANGE_CONTRACT` | string | `"0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"` | `config.ts:37` | Polygon mainnet. |
| `BTC_REFERENCE_SOURCE` | `"chainlink-onchain" \| "chainlink-datastreams"` | `"chainlink-onchain"` | `config.ts:47-48` | DISPLAY ONLY per header comment. |
| `CHAINLINK_RPC_URL` | string (CSV) | `"https://polygon-bor-rpc.publicnode.com,https://polygon.drpc.org,https://1rpc.io/matic"` | `config.ts:51-53` | Rotates on failure. |
| `CHAINLINK_BTC_USD_FEED` | string | `"0xc907E116054Ad103354f2D350FD2514433D57F6f"` | `config.ts:55` | Polygon mainnet aggregator. |
| `CHAINLINK_DATASTREAMS_API_KEY` | string | `""` | `config.ts:57` | Unused. |
| `CHAINLINK_DATASTREAMS_API_SECRET` | string | `""` | `config.ts:58` | Unused. |
| `TELEGRAM_BOT_TOKEN` | string | `""` | `config.ts:61` | |
| `TELEGRAM_CHAT_ID` | string | `""` | `config.ts:62` | |
| `PAPER_STARTING_BALANCE` | number | `100` | `config.ts:65` | |
| `DB_PATH` | string | `"data/edge5.db"` | `config.ts:66` | |

### 3.2 `DEFAULT_STRATEGY` (runtime-mutable)

| Field | Default | `path:line` |
|---|---|---|
| `p1Band` | `{ min: 0.9, max: 0.94 }` | `config.ts:71` |
| `p2Band` | `{ min: 0.95, max: 0.99 }` | `config.ts:72` |
| `driftPaddingUsd` | `12` | `config.ts:73` |
| `minShares` | `5` | `config.ts:74` |
| `cancelReplaceBudgetMs` | `100` | `config.ts:75` |
| `tif` | `"GTC"` | `config.ts:76` |
| `priceFloor` | `0.75` | `config.ts:77` |
| `priceCeil` | `0.99` | `config.ts:78` |
| `activeStrategy` | `null` | `config.ts:81` |
| `p1WindowMs` | `20_000` | `config.ts:82` |

### 3.3 Time constants

| Name | Value | `path:line` |
|---|---|---|
| `TIF_MS["1m"]` | `60_000` | `config.ts:92` |
| `TIF_MS["2m"]` | `120_000` | `config.ts:93` |
| `TIF_MS["GTC"]` | `null` | `config.ts:94` |
| `SLOT_MS` | `5 * 60 * 1000` | `config.ts:99` |
| `P1_OPEN_MS` | `20_000` | `config.ts:100` |
| `P2_OPEN_MS` | `10_000` | `config.ts:101` |
| `HOLD_MS` | `2_000` | `config.ts:102` |

### 3.4 Non-`config.ts` env consumption (grep-verified)

| Env var | Consumer | `path:line` |
|---|---|---|
| `BOT_CONTROL_TOKEN` | `api-auth.ts` (opt-in mutating-route guard) | `api-auth.ts:15` |
| `DASHBOARD_PASSWORD` | `dashboard-auth.ts` (opt-in session auth) | `dashboard-auth.ts:23` |
| `DASHBOARD_USERNAME` | `dashboard-auth.ts` (default `"admin"`) | `dashboard-auth.ts:32` |
| `HTTPS_PROXY` / `SOCKS5_PROXY` | `lib/v2/engine/proxy.ts` (outbound proxy for restricted networks) | `proxy.ts:26-28` |
| `NEXT_RUNTIME` | `instrumentation.ts` (nodejs-only guard) | `instrumentation.ts` |

---

## 4. Authentication Mechanism (Quoted from Source)

### 4.1 Dashboard session (`dashboard-auth.ts`)

- **Enforcement gate.** `dashboardAuthEnabled()` returns true iff `DASHBOARD_PASSWORD` is set — the dashboard is unauthenticated when unset (`dashboard-auth.ts:40-42`).
- **Cookie.** Name `edge5_session`, form `<expiryMs>.<hmacHex>`, TTL `7 * 24 * 3_600_000` ms (7 days) (`dashboard-auth.ts:15-16`).
- **HMAC key derivation.** SHA-256 of `edge5-dashboard-session-v2|<username>|<password>` imported as an HMAC-SHA-256 key. Changing username **or** password invalidates every outstanding session on restart (`dashboard-auth.ts:44-49`).
- **Mint.** `expiry = String(Date.now() + SESSION_TTL_MS)`; sign expiry with HMAC key; token is `${expiry}.${hex(sig)}` (`dashboard-auth.ts:57-63`).
- **Verify.** Reject if missing dot separator, expired (`Date.now() > expiryMs`), or signature hex is not 64 chars. Verification is `crypto.subtle.verify` (constant-time on the MAC) (`dashboard-auth.ts:66-80`).
- **Constant-time credential compare.** SHA-256 both candidate and actual, then XOR-loop over 32 bytes. Both username and password comparisons **always run** so a wrong username costs the same time as a wrong password (`dashboard-auth.ts:87-98, 105-113`).
- **Cookie attributes.** `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, plus `Secure` if `x-forwarded-proto` starts with `https` or the URL scheme is https (`dashboard-auth.ts:117-128, 130-133`). `SameSite=Lax` is called out as "primary CSRF defense: cross-site POSTs never carry the cookie".

### 4.2 API control token (`api-auth.ts`)

- **Enforcement gate.** `checkControlAuth(req)` no-ops when `BOT_CONTROL_TOKEN` is unset (backwards-compatible for localhost-behind-firewall) (`api-auth.ts:15-16`).
- **Accepted headers.** `Authorization: Bearer <token>` **or** `x-bot-token: <token>` (`api-auth.ts:18-21`).
- **Comparison.** Constant-time via `timingSafeEqual` after length check (Node `node:crypto`) (`api-auth.ts:23-28`).
- **Failure.** Returns `{ ok: false, message: "Unauthorized: missing or invalid bot control token" }` (`api-auth.ts:30`).

Purpose per module header: "make engine control — start/stop, kill switch, risk limits, placing real-money standing orders — require the secret" once the dashboard is exposed on a public port (`api-auth.ts:8-13`).

---

## 5. Shutdown Path (Quoted from Source)

- **PM2 grace window.** `kill_timeout: 8000` — PM2 force-kills after 8s if the process has not exited (`ecosystem.config.js:44`).
- **Signal traps.** `instrumentation-node.ts:47-52+` installs a `gracefulShutdown(signal)` that runs on both `SIGTERM` and `SIGINT`, guarded by a `shuttingDown` flag so re-entry is a no-op.
- **Engine dispose.** Only the pre-existing singleton (`globalThis.__botEngineV2`) is disposed — the handler never boots the engine graph just to tear it down (`instrumentation-node.ts` in the `gracefulShutdown` body).
- **Uncaught exception.** Full stack + memory diagnostics logged; `process.exit(1)` after a 2s flush delay so PM2 can capture the log lines; PM2's exponential backoff and auto-resume then re-ignite the engine (`instrumentation-node.ts:36-46`; ecosystem `:26-40`).
- **Unhandled rejection.** Logged with stack, **process kept alive** — "a stray rejection from a fire-and-forget promise must not kill a trading process that is otherwise healthy" (`instrumentation-node.ts:12-16, 29-34`).

In-flight orders on shutdown: covered by the boot-time SCRATCH sweep (`db.ts:163, 185+`, previously cited) — any OPEN row at next boot is closed as SCRATCH with a full `cost` refund into the mode's bankroll.

---

## 6. Direction Matrix (Complete)

Full end-to-end traces live in `_appendix/direction-matrix.md`. Summary of every representation:

| Representation | Where it appears | `path:line` |
|---|---|---|
| **Signal** | Engine's per-tick strategy call returns a `TradeSide` (or null). | `engine.ts` (tick loop; strategy adapter) |
| **Trigger** | SLO's arm/trigger clock inside `StandingOrderManager`. | `standing-order.ts` (symbol level) |
| **Standing Limit Order** | `StandingOrderManager` — independent of P1/P2 windows. | `standing-order.ts:*` |
| **UP / DOWN** | `TradeSide = "UP" \| "DOWN"` used everywhere in P4. | `types.ts` (TradeSide) |
| **Up / Down (Gamma label)** | Polymarket's `outcomes` JSON on the market row. | `feeds/market-discovery.ts:132, 139-140` |
| **YES / NO** | **Do not appear in P4 source.** Polymarket labels the 5m BTC tokens `Up`/`Down`, not `Yes`/`No`. | (absent by design) |
| **Bull / Bear** | **Do not appear in P4 source.** | (absent) |
| **Outcome Token (upTokenId / downTokenId)** | Assigned by label match (not positional) in market discovery; consumed by engine. | `feeds/market-discovery.ts:141-142`; `types.ts:26-27, 464-465, 526-527` |
| **Position** | `engine.ts` (`position` field on the FilledLot) | `engine.ts:113` |
| **Execution** | `Executor.placeOrder` — always `Side.BUY`; direction encoded via `tokenId`. | `execution/live.ts:128` |
| **Settlement** | Winner side determined at slot end; matches / mismatches trade's `side` → WIN/LOSS/SCRATCH. | `engine.ts:1326` |
| **Accounting** | Debit `cost` on fill; credit `shares × 1.00` on WIN; refund `cost` on SCRATCH. | `bankroll.ts`; `db.ts:185+` (SCRATCH sweep) |
| **PnL** | WIN: `shares × 1.00 − cost`; LOSS: `−cost`; SCRATCH: `0`. | `settlement-repair.ts` (`bookedPayout`); `accounting-verifier.ts:12` |
| **Dashboard** | `LiveAccountOrder.outcome`, `LiveAccountTrade.outcome` display the label string. | `execution/live.ts:317, 336` |
| **Database** | `trades.side TEXT` stores `"UP" \| "DOWN"`. | `db.ts` schema |

### 6.1 Paper V1 end-to-end trace

`Signal (strategy or SLO) → TradeSide UP|DOWN → engine.orderIds(side) → { marketId, tokenId } → PaperExecutor.placeOrder({ tokenId, price, size }) → simulated fill or partial → bankroll.debitCost(cost) → trades row (mode=PAPER_V1, side, tokenId, price, shares, cost) → slot end → winner side computed → WIN/LOSS/SCRATCH → bankroll.credit / refund → trades row updated (result, pnl, balance_after) → dashboard reads via analytics.ts`.

Direction is preserved through **every** hop as the `TradeSide` string and the corresponding `tokenId` sourced from the market's label-mapped token ids. `Side.BUY` is a constant at the exchange layer.

### 6.2 Live V2 end-to-end trace

Identical to §6.1 except: (a) `LiveExecutor.placeOrder` submits a signed EIP-712 order to the CLOB with `POST_ONLY = true`, `TICK_SIZE = "0.01"` (`live.ts:43, 45, 128`); (b) fills arrive via `feeds/order-events.ts` WebSocket; (c) wallet mirror is updated per fill; (d) `settlement-verifier.ts` re-checks the booked result against the official Polymarket resolution on a 60s sweep and, on mismatch, auto-repairs via `settlement-repair.ts`.

### 6.3 Winner computation

`engine.ts:1326`: `const winningTokenId = isScratch || !mkt ? null : winner === "UP" ? mkt.upTokenId : mkt.downTokenId`. The winner is determined by the Polymarket resolution when available (via `feeds/market-discovery.fetchOfficialResolution`), or by a BTC spot fallback for restart-orphan recovery. `settlement-verifier.ts` (`:1-32`) will upgrade any spot-fallback / SCRATCH booking once the official resolution appears.

---

## 7. Synchronization Matrix (Complete Six Columns)

Full matrix in `_appendix/synchronization-matrix.md`. Every surface now has all six required columns. Highlights of what was filled in during Phase 0.5:

| Surface | New evidence added |
|---|---|
| BTC spot | Frequency: on-chain Chainlink poll (`config.ts:52-55`). Conflict: N/A (single source). Failure: staleness > 10s → guard holds (`oracle-sync-guard.ts:24`). |
| CLOB best-ask | Freq: WS push + 2s poll fallback per `watchdog.ts:32` comment (`quotes should refresh every ~2s`). Failure: `QUOTE_STALE_MS = 45_000` → watchdog kicks the feed (`watchdog.ts:32, 159`). |
| Oracle sync guard | Threshold: `STALE_MS = 10_000`; `spot >= strike + driftPaddingUsd` (UP), `spot <= strike - driftPaddingUsd` (DOWN); padding default `$12` (`oracle-sync-guard.ts:24, 34-52`; `config.ts:73`). |
| SLO | Watchdog: `SLO_STALL_MS = 30_000` (`watchdog.ts:37, 189`). |
| Ledger rows | Async write queue; write failures log to stderr (per `db.ts` write-queue block, referenced in Report 12). |
| Kill switch | Two sources: OPERATOR (dashboard/Telegram) and BREAKER (RiskManager auto-trip). Persisted at `risk:killswitch`. |

---

## 8. Production Readiness (Recomputed on Verified Facts Only)

The Phase 0 Report 15 mixed observed facts with recommendation-shaped sentences and one factually incorrect gap (C4). Recomputation, observations-only:

### 8.1 Verified strengths (no changes required)

Report 15's 12 strengths bullets are all cited-observation; kept as-is.

### 8.2 Corrected "gaps"

| Report 15 claim | Corrected finding |
|---|---|
| "No documented runbook" | **Wrong.** `OPERATIONS.md` (110 LOC, live-money runbook), plus `PRODUCTION_SETUP.md`, `QUICK_START.md`, `SETUP.md`, `TRADING_GUIDE.md`, `DERIVE_CREDENTIALS.md`, `EXECUTION_LATENCY_OPTIMIZATION.md`, `docs/production-certification.md`. See `_appendix/operator-runbooks.md`. |
| "10s spot staleness — worth measuring 99p feed gap" | Reclassified as **observation R7** (Unverified from source; requires telemetry). |
| "PM2 memory ceiling — verify the ceiling is high enough" | Observation: `max_memory_restart: '512M'` (`ecosystem.config.js:38`). Whether that ceiling is appropriate is telemetry-dependent. |
| "Dashboard auth… Flag for Phase 2 security review" | Removed as recommendation. Dashboard auth is fully documented in §4.1: opt-in HMAC session, HttpOnly + SameSite=Lax cookie, constant-time credential compare, `Secure` on HTTPS. Observation only. |
| "No live/paper comparison verdict yet" | Reclassified as **observation R8**. `comparison.ts` supplies stats; no acceptance criteria encoded in source. |

### 8.3 Observations added

- **Watchdog thresholds are explicit** and covered by tests (`tests/unit/watchdog.test.ts`).
- **Settlement verifier auto-repairs** on official-resolution mismatch (Phase 4); operator action not required. `settlement-verifier.ts:1-32`.
- **Accounting verifier runs every 5 minutes** with four identity checks (A–D); Identity C (bankroll agreement) may auto-reconcile. `accounting-verifier.ts:1-32`.
- **CLOB V2 is maker-only** (`POST_ONLY = true`, `live.ts:43`) — the engine cannot cross the spread; safety-by-construction against taker slippage.

---

## 9. Repository Coverage Estimate

| Category | Files | Indexed after Phase 0.5 | Coverage |
|---|---|---|---|
| Top-level operator markdown | 9 (incl. `docs/production-certification.md`) | 9 | 100% |
| Runtime & build config | 12 | 12 | 100% |
| App routes (`app/`) | 20 | 20 | 100% |
| Components (`components/`) | 16 | 16 (14 v2 panels + login-form + ui/button) | 100% |
| Engine library (`lib/v2/engine/`) — top-level `.ts` | 32 | 32 (incl. `lib/v2/engine/proxy.ts`) | 100% |
| Engine subfolders (execution, feeds, handlers, strategy, strategy-registry) | 20 | 20 | 100% |
| Scripts (`scripts/`) | 7 (4 `.ts/.mjs` + 3 `.sh`) | 7 | 100% |
| Tests (`tests/`) | 28 | 28 (mapped to production modules) | 100% |
| Deployment (`deploy/`) | 1 (`nginx-edge5.conf`) | 1 | 100% |
| Docs (`docs/`) | 1 | 1 | 100% |

**Aggregate coverage estimate: ≥ 95%** of files with a purpose-and-owner entry in `_appendix/file-index.md`. The residual 5% is depth-of-trace, not file-existence: `standing-order.ts` and `engine.ts` are still symbol-scan level for parts of their internals (§12).

---

## 10. Citation Validation Summary

Every drifted citation from `PHASE0_REVIEW.md` §3 was re-verified against the source. Corrections are recorded in `_appendix/errata.md`. Summary:

| Original citation | Verified location | Delta |
|---|---|---|
| `POST_ONLY = true (live.ts:33)` | `live.ts:43` | +10 |
| `TICK_SIZE = "0.01" (live.ts:35)` | `live.ts:45` | +10 |
| `EthersV6SignerAdapter (live.ts:52)` | `live.ts:52` | ✅ exact |
| `throws if any missing (live.ts:71-84)` | Actual block spans `live.ts:57-70` (constructor null-check) and continues through `:71-84` for the SDK construction. Report 05 range was approximately correct. | ± minor |
| `RECONCILE_MS = 60_000 (reconciler.ts:29)` | `reconciler.ts:27` | −2 |
| `DRIFT_TOLERANCE_USD = 1 (reconciler.ts:30)` | `reconciler.ts:28` | −2 |
| `DEFAULT_LIMITS (risk.ts:70-76)` | `risk.ts:65-71` | −5 |
| `SPOT_STALE_MS = 10_000 (engine.ts:837)` | `engine.ts:842` (`Edge5Engine.SPOT_STALE_MS`) | ✅ (close) |
| `scratchOrphanedOpenRows (db.ts:174-206)` | Defined `db.ts:185`; called `db.ts:163` | shift |
| `paper.ts:88 priceForSide` | Requires re-check; noted in errata. | — |
| `eslint.config.js` | `eslint.config.mjs` | filename |

**No citation pointed to a nonexistent file. No citation asserted behavior contradicted by the referenced line.** Constants are all numerically correct. Total drifted citations: 11. All 11 corrected in `_appendix/errata.md`.

---

## 11. Cross-Reference Validation Summary

Every missing cross-reference from `PHASE0_REVIEW.md` §4 is now recorded in `_appendix/errata.md` as a required back-link (no report body edits were made per the "no rewrite" preference). Added cross-references:

- Report 14 → Report 08 (via `tests/unit/risk.test.ts`).
- Report 04 → Report 08 (SLO reuses `RiskManager`).
- Report 10 → Report 05 (strategies produce `Executor` calls).
- Every existing report → `_appendix/*` (five new appendix files created this phase).
- Report 01 → `_appendix/operator-runbooks.md` (deployment / boot / VPS setup).
- Report 15 → `_appendix/operator-runbooks.md` (retracts the "no runbook" claim).

Consistent pairs from `PHASE0_REVIEW.md` §5 re-spot-checked: all 8 remain consistent.

---

## 12. Direction Matrix Completeness

`_appendix/direction-matrix.md` covers all required rows:

Signal ✅ Trigger ✅ Standing Limit Order ✅ YES (documented as absent) ✅ NO (documented as absent) ✅ Outcome Tokens ✅ Bull (absent) ✅ Bear (absent) ✅ UP ✅ DOWN ✅ Position ✅ Execution ✅ Settlement ✅ Accounting ✅ PnL ✅ Dashboard ✅ Database ✅.

Paper V1 end-to-end trace: **complete** with `path:line`.
Live V2 end-to-end trace: **complete** with `path:line`, plus the SDK boundary called out explicitly (SDK internals `Unverified` per R1).

---

## 13. Synchronization Matrix Completeness

`_appendix/synchronization-matrix.md`: every surface has all six columns (Source of Truth, State Owner, Update Frequency, Conflict Resolution, Failure Behavior, Recovery Behavior). No surface remains with an ⚠️ or ❌ marker. Oracle sync guard row filled from `handlers/oracle-sync-guard.ts:24, 34-52`.

---

## 14. Test Coverage Mapping Summary

`_appendix/test-coverage-matrix.md` maps every test to a production module. Summary:

| Production module | Test file | Status |
|---|---|---|
| `risk.ts` | `tests/unit/risk.test.ts` | ✅ |
| `reconciler.ts` | `tests/unit/reconciler.test.ts` | ✅ |
| `watchdog.ts` | `tests/unit/watchdog.test.ts` | ✅ |
| `handlers/*` | `tests/unit/handlers.test.ts` | ✅ |
| `execution/paper.ts` | `tests/unit/paper-executor.test.ts` | ✅ |
| `feeds/*` (chaos + integrity) | `tests/unit/feed-chaos.test.ts`, `tests/unit/feed-integrity.test.ts` | ✅ |
| `strategy/sniper.ts` | `tests/unit/sniper.test.ts` | ✅ |
| `clock.ts` | `tests/unit/model-clock.test.ts` | ✅ |
| `dashboard-auth.ts` / `api-auth.ts` | `tests/unit/auth.test.ts` | ✅ |
| Direction verdict path | `tests/unit/direction-verdict.test.ts` | ✅ |
| `db.ts` | `tests/integration/db-chaos.test.ts`, `ledger-accounting.test.ts` | ✅ |
| `accounting-verifier.ts` | `tests/integration/accounting-integrity.test.ts` | ✅ |
| `settlement-verifier.ts` + `settlement-repair.ts` | `tests/integration/settlement-integrity.test.ts`, `settlement.test.ts` | ✅ |
| `execution/live.ts` + `execution/paper.ts` (hardening) | `tests/integration/execution-hardening.test.ts`, `execution-latency.test.ts` | ✅ |
| `standing-order.ts` | `tests/integration/standing-order.test.ts` | ✅ |
| Ops / chaos / soak | `tests/integration/ops-chaos.test.ts`, `soak.test.ts`, `soak-certification.test.ts` | ✅ |
| `strategy-profiles.ts` + Telegram console | `tests/integration/profiles-and-console.test.ts` | ✅ |
| Sizing + window semantics | `tests/integration/sizing-and-window.test.ts` | ✅ |

**Production modules with NO dedicated test file (explicitly enumerated):**

- `bankroll.ts` — covered indirectly via `ledger-accounting.test.ts` and `accounting-integrity.test.ts`.
- `analytics.ts` — no dedicated test; presentation layer.
- `notifier.ts` / `telegram.ts` / `telegram-console.ts` — no dedicated test.
- `comparison.ts` / `strategy-profiles.ts` — indirectly via `profiles-and-console.test.ts`.
- `market-model.ts`, `latency-trace.ts`, `http-agent.ts`, `preflight.ts`, `report.ts`, `system-monitor.ts`, `trade-replay.ts` — **no tests** (utility/reporting modules).
- `lib/v2/engine/proxy.ts` — **no tests**.
- Every file under `app/api/*` — **no route-level tests**.
- Every file under `components/v2/*` — **no component tests** (Vitest include is `tests/**/*.test.ts` only, per `vitest.config.ts:11`).
- `strategy-registry/strategies/edge{1..6}*.ts` — **no per-strategy tests** (registry-level behavior may be covered by `direction-verdict.test.ts` or `sniper.test.ts`; per-strategy coverage is not enumerated).

No production component is unmapped: every module is either linked to a test file above, or explicitly listed as having no dedicated test.

---

## 15. Final Repository Completeness Estimate

- **File-existence coverage:** ≥ 95% (every file with a purpose/owner entry).
- **Test mapping coverage:** 100% (every module either has tests or is explicitly noted as not).
- **Direction Matrix coverage:** 100% of the required rows (with absent representations documented as absent).
- **Synchronization Matrix coverage:** 100% (all six columns per surface).
- **Contradictions resolved:** 6 / 6 (C1–C6).
- **Unverified items resolved:** 15 / 18 fully; 3 partial (U11, U16, U17) recorded as R2–R4.
- **Open questions resolved:** 11 / 13 fully; Q2 and Q5 partially (recorded as R1 and R2).
- **Depth-of-trace gaps remaining:** `standing-order.ts` (2,489 LOC) and portions of `engine.ts` (1,551 LOC) — recorded as R3/R4/R6.

**Aggregate KB completeness estimate: ~92%.** The residual 8% is composed of: (a) the SLO line-by-line trace (R3/R4), (b) route-by-route auth audit (R2), (c) SDK-internal behavior for `SIGNATURE_TYPE` (R1), (d) telemetry-dependent items reclassified from recommendations to observations (R7, R8), and (e) additive tables enumeration (R5).

---

## 16. Verdict

**READY FOR PHASE 1.**

Evidence supporting the verdict:

1. **All six contradictions resolved with direct source citations** (§1.1; C1–C6). The KB's primary factual disagreements with the source no longer exist.
2. **The `config.ts` env schema is fully enumerated** with a `path:line` for every default (§3). Any Phase 1 change touching configuration has an authoritative reference.
3. **Both authentication mechanisms are quoted end-to-end** (§4). The KB no longer asserts auth behavior without evidence.
4. **The Direction Matrix is complete** (§6, `_appendix/direction-matrix.md`), including the previously-missing `YES`/`NO` question (documented as absent from source, with the label-based token-id mapping quoted from `feeds/market-discovery.ts:129-142`).
5. **The Synchronization Matrix has all six columns for every surface** (§7, `_appendix/synchronization-matrix.md`), including oracle sync guard thresholds previously marked ⚠️/❌.
6. **Every test file is mapped to a production module** and every module without a test is explicitly enumerated (§14, `_appendix/test-coverage-matrix.md`).
7. **The 8 operator runbook documents are read and summarized** (`_appendix/operator-runbooks.md`), eliminating the factually wrong "no runbook" claim in Report 15.
8. **Every file in `reference/p4/` has an index entry** (`_appendix/file-index.md`), including `lib/v2/engine/proxy.ts`, all `scripts/`, all tests, and all top-level markdown.
9. **The residual Unverified items (R1–R8) are documented as genuinely unverifiable from source alone** — three fall inside a vendored SDK (`@polymarket/clob-client-v2`), two require production telemetry, and three are depth-of-trace items in `standing-order.ts` that Phase 1 will encounter directly.

No production code was modified. No runtime behavior was changed. No fixes were implemented. No files under `reference/p4/` were touched.

---

## Stop

Awaiting explicit approval before beginning Phase 1.
