# ARC — reze → companion migration audit (P0/M0)

**Scope.** Classification of every subsystem in the read-only reference tree
(`docs/reference/p4/`, mirror of `piothash/reze`) against the frozen ARC
architecture. This audit is analysis only: nothing under `docs/reference/p4/`
was read into the build graph, imported, copied, or modified (ADR-0002).

**Classification key**

| Tag | Meaning |
|---|---|
| REUSE | Concept and contract carry over unchanged; companion mirrors it read-only |
| REFACTOR | Concept carries over but must be re-expressed for the Worker runtime |
| REIMPLEMENT | Companion needs its own surface; engine logic stays on the VPS |
| REMOVE | Does not belong in the companion at all |

## 1. Engine core (`lib/v2/engine/`)

| Component | Class | Rationale |
|---|---|---|
| `engine.ts` (tick loop, phases) | REMOVE | Trading authority. Charter §2: never implemented in the companion |
| `phase.ts` | REMOVE | Tick-phase state belongs to the VPS; companion mirrors reported phase only |
| `market-model.ts` | REMOVE | Market state generation is engine-owned |
| `risk.ts` | REMOVE | Risk evaluation is engine-owned; companion displays engine verdicts |
| `standing-order.ts` | REMOVE | Order management is engine-owned |
| `execution/{executor,live,paper}.ts` | REMOVE | Order execution is engine-owned |
| `bankroll.ts`, `analytics.ts` | REMOVE | Money derivation is engine-owned (ADR-0001 consequence 2) |
| `reconciler.ts` | REIMPLEMENT | Companion needs *mirror* reconciliation (cache vs engine report), not ledger reconciliation |
| `config.ts` | REFACTOR | Superseded by `src/core/configuration/*`: Zod schema, env catalog, profiles, fail-fast |
| `events.ts` | REFACTOR | Superseded by `src/core/contracts/event-envelope.ts` with correlation/causation and idempotency |
| `clock.ts` | REFACTOR | Superseded by `src/core/shared/time.ts` (`Clock`, `SystemClock`, `FixedClock`, skew reporting) |
| `types.ts` | REFACTOR | Domain identifiers re-expressed as branded, deterministic ids in `src/core/shared/ids.ts` |
| `db.ts` (`better-sqlite3`) | REMOVE | Native module; unavailable on Workers. Companion uses Lovable Cloud Postgres |
| `http-agent.ts`, `proxy.ts` | REMOVE | Node `http.Agent`/socket tuning has no Worker equivalent; `fetch` is used instead |
| `feeds/*` (WebSocket clients) | REMOVE | Long-lived sockets are impossible on Workers; feed telemetry arrives via engine polling |
| `watchdog.ts`, `system-monitor.ts` | REIMPLEMENT | Companion equivalent is `src/core/infrastructure/health.ts` (dependency + staleness health) |
| `notifier.ts`, `telegram*.ts` | REIMPLEMENT | Companion notifications use the `notifications` table; no third-party transport at M0 |
| `preflight.ts` | REFACTOR | Fail-fast startup validation now lives in `loadEnv` + `parseConfigOrThrow` + `createRuntime` |
| `report.ts`, `comparison.ts` | REUSE (contract) | Shape of engine reports is the read contract the companion mirrors |
| `trade-replay.ts` | REIMPLEMENT | Replay boundary is reserved for ADR-0006; framework hooks exist (`FixedClock`, FSM replay) |
| `strategy-profiles.ts` | REFACTOR | Re-expressed as validated execution profiles in the configuration schema |
| `api-auth.ts` | REIMPLEMENT | Companion auth is Lovable Cloud auth + roles; engine transport auth is ADR-0003 |
| `settlement-*.ts`, `accounting-verifier.ts` | REMOVE | Settlement and accounting truth is engine-owned |
| `diag/direction-trace.ts`, `latency-trace.ts` | REFACTOR | Superseded by structured logging + metrics with reason codes |

## 2. Dashboard (`app/`, `components/v2/`)

| Component | Class | Rationale |
|---|---|---|
| Panel/deck layout concepts | REUSE (design) | Instrument-panel information architecture carries over |
| `use-bot.ts` polling hook | REFACTOR | Becomes route loaders + server functions; no client-side engine credentials |
| Next.js route handlers (`app/api/v2/bot/*`) | REFACTOR | Become `createServerFn` and `/api/public/*` server routes |
| Direct engine calls from components | REMOVE | Secrets must never reach the browser (Roadmap R-5) |

## 3. Operations (`scripts/`, `ecosystem.config.js`, `deploy/`)

| Component | Class | Rationale |
|---|---|---|
| PM2 config, nginx conf, shell monitors | REMOVE | VPS operational concerns; outside the companion |
| `scripts/verify-all.mjs` | REFACTOR | Companion equivalent is `lint` + `tsgo` + `vitest` in CI |

## 4. Legacy strategy vocabulary

The reference tree contains legacy naming (e.g. majority/crowd-derived direction
heuristics). **None of it is carried over.** A repository scan of `src/`
confirms zero occurrences: the companion has no strategy vocabulary because it
holds no strategy.

## 5. Net result at P0/M0

Nothing was migrated as code. What carried over is **understanding**, expressed
as new companion-native foundation modules:

| Foundation concern | Module |
|---|---|
| Configuration + environment | `src/core/configuration/{schema,environment}.ts` |
| Versioning | `src/core/contracts/versions.ts` |
| Canonical events | `src/core/contracts/event-envelope.ts` |
| Reason codes | `src/core/contracts/reason-codes.ts` |
| Time + identifiers | `src/core/shared/{time,ids}.ts` |
| Logging / metrics / health | `src/core/infrastructure/{logging,metrics,health}.ts` |
| Scheduler | `src/core/infrastructure/scheduler.ts` |
| State machine framework | `src/core/infrastructure/fsm.ts` |
| Persistence contracts | `src/core/infrastructure/persistence.ts` + `supabase-persistence.server.ts` |
| Composition root | `src/core/runtime.ts` |
