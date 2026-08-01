# Synchronization Matrix — Phase 0.5

Every synchronized surface with all six required columns. Evidence cited by `path:line`.

## Legend

- **Source of Truth**: authoritative producer of the value.
- **State Owner**: module holding the local mirror consumed by the engine.
- **Update Frequency**: expected refresh cadence.
- **Conflict Resolution**: how the module reconciles Source vs Owner disagreement.
- **Failure Behavior**: what happens when the update fails or is stale.
- **Recovery Behavior**: how the module returns to normal after failure.

## Matrix

### BTC spot (Chainlink reference feed)

| Column | Value |
|---|---|
| Source of Truth | On-chain Chainlink BTC/USD aggregator (Polygon `0xc907E116054Ad103354f2D350FD2514433D57F6f`) |
| State Owner | `feeds/btc-reference-feed.ts` (via `spotFeed`) |
| Update Frequency | Poll via RPC list (`CHAINLINK_RPC_URL` CSV, `config.ts:52-53`); rotates to next on failure |
| Conflict Resolution | Single source — no conflict path |
| Failure Behavior | Tape staleness > 10s → oracle guard holds; no trade placed (`handlers/oracle-sync-guard.ts:24, 30-33`) |
| Recovery Behavior | RPC rotation on error; watchdog covers stuck-feed detection |
| Evidence | `config.ts:47-58`, `handlers/oracle-sync-guard.ts:24, 34-52` |

### CLOB best-bid/ask (Polymarket order book)

| Column | Value |
|---|---|
| Source of Truth | Polymarket CLOB WebSocket + REST fallback |
| State Owner | `feeds/clob-price-feed.ts`, WS client `feeds/clob-ws-client.ts` |
| Update Frequency | WS push + 2s poll fallback (per `watchdog.ts:32` comment) |
| Conflict Resolution | WS message overrides poll snapshot (last-write-wins on timestamp) |
| Failure Behavior | `QUOTE_STALE_MS = 45_000` → watchdog kicks the feed (`watchdog.ts:32, 159`); `WS_STALE_MS = 90_000` → market WS reconnect (`watchdog.ts:30, 131`) |
| Recovery Behavior | Watchdog repair: reconnect WS, re-arm 2s poll |
| Evidence | `watchdog.ts:29-32, 131, 159` |

### Wallet balance (Live only)

| Column | Value |
|---|---|
| Source of Truth | Polymarket exchange (USDC balance for `POLY_PROXY_ADDRESS`) |
| State Owner | Executor + reconciler mirror |
| Update Frequency | On slot rollover + reconciler 60s (`reconciler.ts:27`) |
| Conflict Resolution | Reconciler enforces $1 tolerance (`DRIFT_TOLERANCE_USD = 1`, `reconciler.ts:28`) |
| Failure Behavior | Soft-fail: null balance; reconciler logs |
| Recovery Behavior | Paper: `setWalletUsd` seam; Live: on-chain re-read next tick |
| Evidence | `reconciler.ts:27-28` |

### Bankroll (KV-backed pool per mode)

| Column | Value |
|---|---|
| Source of Truth | `kv[bankroll:<mode>:balance]` (SQLite) |
| State Owner | `Bankroll` class |
| Update Frequency | On every fill + on every settle |
| Conflict Resolution | Ledger is the authority — accounting verifier Identity C may re-stamp bankroll from ledger (`accounting-verifier.ts:12-21`) |
| Failure Behavior | Write queue is async; write failures log to stderr |
| Recovery Behavior | Boot-time SCRATCH sweep refunds `cost` for every OPEN row on last shutdown (`db.ts:185+`) |
| Evidence | `accounting-verifier.ts:1-32`, `db.ts:155-166, 185+` |

### Open orders (engine belief vs exchange reality)

| Column | Value |
|---|---|
| Source of Truth | Polymarket CLOB open-orders endpoint |
| State Owner | Executor local state + engine mirror |
| Update Frequency | 60s reconciler sweep (`RECONCILE_MS = 60_000`) |
| Conflict Resolution | UNTRACKED exchange order = ERROR every cycle; orphan cleaner builds counter-order |
| Failure Behavior | Reconciler continues; alert routed via `notifier.ts` |
| Recovery Behavior | Orphan cleaner emits FOK_MARKET counter on the opposite side (`handlers/orphan-cleaner.ts:32-46`) |
| Evidence | `reconciler.ts:27`, `handlers/orphan-cleaner.ts:26-46` |

### Ledger rows (SQLite `trades`)

| Column | Value |
|---|---|
| Source of Truth | SQLite `trades` table |
| State Owner | `db.ts` (write queue + prepared statements) |
| Update Frequency | Per event (fill, settle, repair) |
| Conflict Resolution | Idempotent migrations; repair path is atomic per trade uid with kv marker |
| Failure Behavior | Async write failure → stderr; historical facts never rewritten by verifier alone |
| Recovery Behavior | Boot-time SCRATCH sweep (`db.ts:185`); accounting verifier Identity A/B/D report-only |
| Evidence | `db.ts:155-210`; `accounting-verifier.ts:12-21` |

### KV state (SQLite `kv`)

| Column | Value |
|---|---|
| Source of Truth | SQLite `kv` table |
| State Owner | `db.ts` (`kvGet`/`kvSet`) |
| Update Frequency | Per write (config change, risk change, engine flag) |
| Conflict Resolution | Last-write-wins (single-instance PM2 fork) |
| Failure Behavior | Read of missing key returns default silently |
| Recovery Behavior | Values persist across restart (survives PM2 reload) |
| Evidence | `db.ts` kv statements; `risk.ts:80-82` `KV_LIMITS`, `KV_KILL`, `KV_ORDER_CAP_MIGRATION` |

### Kill switch

| Column | Value |
|---|---|
| Source of Truth | `kv[risk:killswitch]` |
| State Owner | `RiskManager` |
| Update Frequency | On operator or breaker action |
| Conflict Resolution | Two sources tagged (OPERATOR vs BREAKER) preserved in state payload |
| Failure Behavior | On any read failure, defaults to safest (engaged) — conservative bias |
| Recovery Behavior | Persists across restart |
| Evidence | `risk.ts:80-82` |

### Oracle sync guard

| Column | Value |
|---|---|
| Source of Truth | Spot feed timestamp + strike + `driftPaddingUsd` |
| State Owner | Pure function `evaluateOracleGuard(spot, strike, paddingUsd, spotTsMs, nowMs)` (`handlers/oracle-sync-guard.ts:34-52`) |
| Update Frequency | Called on every strategy evaluation |
| Conflict Resolution | Pure math: `spot >= strike + paddingUsd` → UP; `spot <= strike - paddingUsd` → DOWN; else hold |
| Failure Behavior | Missing spot/strike → `{ side: null, cleared: false, reason: "awaiting spot/strike data" }`. Tape stale > 10s → `{ side: null, reason: "spot tape stale — guard holding" }` |
| Recovery Behavior | Automatic — next fresh spot tick clears the hold |
| Evidence | `handlers/oracle-sync-guard.ts:24, 34-52`; padding default `$12` at `config.ts:73` |

### Standing Limit Order (SLO)

| Column | Value |
|---|---|
| Source of Truth | Operator-configured SLO parameters + own clock (in KV + in-memory) |
| State Owner | `StandingOrderManager` (`standing-order.ts`) |
| Update Frequency | Own clock (not driven by main engine tick) |
| Conflict Resolution | SLO re-arms itself; guarded against duplicate placement |
| Failure Behavior | Watchdog detects stall: `SLO_STALL_MS = 30_000` (`watchdog.ts:37, 189`) |
| Recovery Behavior | Watchdog "kicks the loop (epoch bump)" per `watchdog.ts:176`; SLO-internal detection is R4 (Unverified) |
| Evidence | `watchdog.ts:37, 176, 189` |

### Settlement verification & auto-repair

| Column | Value |
|---|---|
| Source of Truth | Polymarket official resolution via `fetchOfficialResolution` |
| State Owner | `settlement-verifier.ts` (sweep every 60s) + `settlement-repair.ts` (per-trade repair) |
| Update Frequency | `VERIFY_INTERVAL_MS = 60_000`; only trades ≥ `MIN_AGE_MS = 90_000` old; sweep limit 100, gamma lookups 10 |
| Conflict Resolution | Official evidence is the ONLY driver of repair (spot / heuristics can never rewrite) |
| Failure Behavior | Sweep skipped on API error; mismatches without evidence → pending count |
| Recovery Behavior | Atomic + idempotent repair per trade uid (kv marker prevents double-credit) |
| Evidence | `settlement-verifier.ts:1-32, 43-49`; `settlement-repair.ts:1-30` |

### Accounting verifier

| Column | Value |
|---|---|
| Source of Truth | Ledger `trades` + kv `bankroll` |
| State Owner | `accounting-verifier.ts` |
| Update Frequency | `SWEEP_INTERVAL_MS = 5 * 60_000` (5 min) |
| Conflict Resolution | Identities A/B/D report-only; Identity C (bankroll agreement) may auto-reconcile (re-stamp bankroll from ledger) |
| Failure Behavior | Violations logged, notified; ledger never mutated by this module |
| Recovery Behavior | Bankroll auto-restamp restores agreement with ledger |
| Evidence | `accounting-verifier.ts:1-33` |
