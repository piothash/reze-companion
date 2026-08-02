# ARC — Implementation Tracker

**Status:** ACTIVE · **Owner:** ARC engineering session loop
**Authority:** bound by `docs/ARC_PROJECT_CHARTER.md`, ADR-0001, ADR-0002.

This file is the **single source of truth for engineering progress**. Every session
updates it. A milestone or engine is never described as complete anywhere else
(chat, report, PR) unless it is marked complete here.

Legend: `⬜` not started · `🟨` in progress · `✅` complete · `N/A` not applicable
· `🚫` blocked

> Scope reminder: the companion is the control plane. Engines listed below are
> tracked for **companion-side surfaces** (read, display, annotate, and — once
> authorised — issue documented control commands). Trading logic itself is never
> implemented here; the VPS remains the sole trading authority.

---

## 1. Milestones

### M0 — Foundation

| Field | Value |
|---|---|
| Status | 🟨 In progress (P0 foundation landed) |
| Dependencies | Session 0 (discovery), Session 0.5 (this baseline) |
| Exit Criteria | Configuration engine surface, event/log ingestion contract, typed engine client, auth + roles enforced end to end, build/lint/typecheck green |
| Acceptance Status | ⬜ |
| Replay Status | N/A |
| Production Status | ⬜ |

### M1 — Market State

| Field | Value |
|---|---|
| Status | ✅ Complete (domain landed) |
| Dependencies | M0 |
| Exit Criteria | Market lifecycle + feed telemetry mirrored and displayed; staleness surfaced; no derived market values |
| Acceptance Status | ✅ 30 market-domain unit tests green (83 total) |
| Replay Status | ✅ Deterministic replay verified (`tests/unit/market-state.test.ts`) |
| Production Status | 🟨 Awaiting live testnet feed wiring |

**M1 evidence log**

- Domain modules: `src/core/market/{types,configuration,events,discovery,lifecycle,feed-engine,twap-engine,ptb-engine,signal-conditioning,market-state,domain,index}.ts`
- Canonical events: `ObservationReceived`, `TWAPUpdated`, `PTBUpdated`, `SignalConditioned`, `MarketLifecycleUpdated`, `AuthoritativeMarketStateUpdated` (frozen envelope, `source=market-state`).
- Configuration-driven only: discovery base URL, slug template, `TWAP_FEED_PROVIDER`, `TWAP_FEED_ID`, `TWAP_NETWORK`, `TWAP_OBSERVATION_INTERVAL`, `TWAP_MAX_STALENESS`, `TWAP_PRECISION`, `TWAP_WINDOW_SECONDS`, `TWAP_MIN_OBSERVATIONS`, `PTB_*`, `SIGNAL_*`. Mainnet switch is `.env`-only.
- Tests: `tests/unit/market-discovery.test.ts`, `tests/unit/market-feed-twap.test.ts`, `tests/unit/market-state.test.ts`.
- Compliance: no decision, risk, order, window-manager or settlement logic; PTB sourced from official market metadata only.


### M2 — Decision Domain

| Field | Value |
|---|---|
| Status | ✅ Complete (domain landed) |
| Dependencies | M1 |
| Exit Criteria | TWAP-native decision engine, execution context, dynamic windows, window FSM, trade quota and immutable execution intents |
| Acceptance Status | ✅ 23 decision-domain unit tests green (106 total) |
| Replay Status | ✅ Byte-identical events, intent ids, quota progression (`tests/unit/decision-domain.test.ts`) |
| Production Status | 🟨 Awaiting M3 execution domain to consume intents |

**M2 evidence log**

- Domain modules: `src/core/decision/{types,configuration,trade-quota,window-fsm,window-instance,decision-engine,events,execution-context,window-manager,index}.ts`
- Decision Engine is a pure function `f(AuthoritativeMarketState, WindowInstance, ConfigurationSnapshot)`: no I/O, no randomness, no timers, no caches.
- Strategy: `Effective TWAP ± Window Buffer` compared against official-metadata PTB → `BUY_UP | BUY_DOWN | NO_SIGNAL`. No majority, confidence, crowd sentiment or Binance direction anywhere.
- Canonical events: `WindowOpened`, `WindowActivated`, `WindowEvaluated`, `WindowCompleted`, `ExecutionIntentCreated`, `TradeQuotaConsumed` (frozen envelope, `source=decision`).
- Dynamic windows: `EXECUTION_WINDOWS` DSL/JSON; priority derived from offset; `15m,10m,7m,5m,3m` → `20m,12m,8m,4m,2m` requires no code change.
- Invariants: one window → at most one ExecutionIntent; every window completes exactly once; quota is monotonically decreasing, never negative, never replenished, and checked before the engine is invoked.


### M3 — Trade Domain

| Field | Value |
|---|---|
| Status | ✅ Complete (domain landed) |
| Dependencies | M2 |
| Exit Criteria | Risk Engine, exposure reservations, execution adapter and Standing Limit Order Engine turning intents into orders with zero strategy logic |
| Acceptance Status | ✅ 27 trade-domain unit tests green (133 total) |
| Replay Status | ✅ Byte-identical session snapshots; restore never duplicates orders or quota (`tests/unit/trade-domain.test.ts`) |
| Production Status | 🟨 Awaiting a real venue gateway adapter (M4/M5) |

**M3 evidence log**

- Domain modules: `src/core/trade/{types,configuration,order-fsm,exposure,risk-engine,order,venue-gateway,standing-order-engine,execution-adapter,events,trade-coordinator,index}.ts`
- Reference audit (REUSE / REFACTOR / REMOVE): `docs/architecture/M3_REFERENCE_AUDIT.md`
- Risk Engine is a pure ALLOW/DENY function over a closed check set (kill switch, market validity, feed freshness, exposure, position limit, liquidity, policy); every check always evaluated for a complete audit trace.
- Exposure ledger enforces `live + reserved <= limit` after every mutation; reservations are idempotent per execution intent and settle exactly once.
- Order FSM: `CREATED → SUBMITTED → WORKING → PARTIALLY_FILLED → FILLED | CANCELLED | REJECTED | EXPIRED`; fills idempotent on the venue fill id.
- Standing Limit Order Engine: passive maker pricing, cancel/replace repricing with a bounded budget, configured retry count/delay, session deadline, IOC fallback, partial-fill accounting across replacements, settlement hook fired exactly once.
- Trade quota is committed exactly once, at the first cumulative fill reaching `minMeaningfulQuantity`; a restart restores the committed flag and cannot re-consume it.
- Canonical events (`source=trade`): risk approved/denied, exposure reserved/released, order submitted/updated/filled/cancelled, quota consumed, execution completed/failed.
- Compliance: no TWAP, PTB, buffer, window, execution-profile or majority concept anywhere behind `src/core/trade`; the engine only ever sees `ExecutionConstraints`.


### M4 — Platform Services

| Field | Value |
|---|---|
| Status | ✅ Complete (platform services landed) |
| Dependencies | M0–M3 |
| Exit Criteria | Append-only event store, deterministic replay, ledger, analytics, notifications, audit trail, read-only API and Cloud synchronization policy |
| Acceptance Status | ✅ 21 platform unit tests green (154 total) |
| Replay Status | ✅ Deterministic: identical events produce an identical projection digest, order-insensitive (`tests/unit/platform-services.test.ts`) |
| Production Status | 🟨 Awaiting a live engine feed to populate the stores |

**M4 evidence log**

- Platform modules: `src/core/platform/{event-catalog,event-store,events,ledger,replay,analytics,notifications,audit,sync,index}.ts`
- Persistence adapters: `src/core/platform/supabase-platform.server.ts` over `platform_events`, `ledger_records`, `analytics_summaries`, `replay_runs` (SELECT/INSERT only on events — immutability enforced by the database).
- Event store: append-only, idempotent on `idempotencyKey`, rejects retroactive insertion, rejects reuse of an `eventId` with different content, deep-freezes every stored envelope.
- Event catalog classifies every canonical event as BUSINESS (ledger-bearing) or OPERATIONAL (telemetry).
- Ledger is a pure reconstruction from BUSINESS events only — TRADE, FEE, EXECUTION_SUMMARY, SETTLEMENT, PNL records; no balance is ever mutated in place.
- Replay is read-only and pure: no clock, no randomness, no IO; validates event ordering, market-state version monotonicity, order FSM legality, correlation ids, execution ids and quota monotonicity, and emits a stable digest.
- Analytics derives fill rate, partial-fill rate, retry rate, fill latency, slippage vs reference effective TWAP, buffer efficiency, quota/window utilization and peak exposure — observation only, never fed back into any engine.
- Notifications: severity derived from reason codes, category routing, dedup per notification id, in-process channels only (no Telegram/email in this milestone).
- Audit trail records configuration, profile, replay, auth and platform actions immutably.
- Synchronization policy mirrors durable records only; Execution Context, active orders, runtime state, open reservations and venue credentials are never synchronized (ADR-0001).
- Read API: `src/lib/platform.functions.ts` — authenticated, read-only server functions (events, ledger, analytics, replay runs, replay execution). No control or trading path exists.


### M5 — Operations Platform

| Field | Value |
|---|---|
| Status | ✅ Complete |
| Dependencies | M3, M4 |
| Exit Criteria | Complete operator platform: 13 surfaces, execution profile editing, audit trail; no trading control path exists |
| Acceptance Status | ✅ Build, lint, typecheck clean; all 13 routes resolve behind the auth gate |
| Replay Status | ✅ Replay surface drives the M4 deterministic replay runner |
| Production Status | 🟨 Awaiting live event mirroring from the VPS engine |

Implementation notes:

- Operator projection: `src/core/platform/operations-view.ts` reduces canonical events into market, window, execution, signal and quota views. No strategy or trading logic.
- Operations API: `src/lib/operations.functions.ts` — authenticated reads plus companion-owned writes only (execution profile, notification acknowledgement). Profile writes are audited.
- UI shell: `src/components/arc/operator-shell.tsx` + `navigation.ts` (13 surfaces: Dashboard, Markets, Execution Profiles, Active Windows, Trade Monitor, Signal Tank, Replay, Analytics, Health, Notifications, Configuration, System, Audit).
- Legacy trading vocabulary (majority, confidence, crowd sentiment, votes) is absent from the UI; the platform is TWAP-native by construction.
- The legacy `/console` route was removed; `/auth` now lands on `/dashboard`.


### M6 — Production Hardening

| Field | Value |
|---|---|
| Status | ✅ Complete |
| Dependencies | M5 |
| Exit Criteria | `docs/PRODUCTION_CHECKLIST.md` fully satisfied for every shipped engine surface |
| Acceptance Status | ⬜ |
| Replay Status | ⬜ |
| Production Status | ⬜ |

### M6.5 — Operational Excellence & Deployment Readiness

| Field | Value |
|---|---|
| Status | ✅ Complete |
| Dependencies | M6 |
| Exit Criteria | Startup validator, probes, watchdogs, boot/env validators, secret scanner, log contract, graceful shutdown/restart, runbook |
| Acceptance Status | ✅ |
| Replay Status | ✅ deterministic restore verified |
| Production Status | ✅ |

### M7.0 — Testnet Qualification & Live Engine Integration

| Field | Value |
|---|---|
| Status | 🟨 Companion side complete — awaiting live VPS engine |
| Dependencies | M6.8 |
| Exit Criteria | Feed provider abstraction (ADR-0005), `/authority/telemetry` contract, live-wired operator surfaces, qualification procedure, 14 observed gates against a live testnet engine |
| Acceptance Status | 🟨 Gates 1–14 documented in `docs/TESTNET_QUALIFICATION.md`; observation pending engine availability |
| Replay Status | ✅ determinism suite green (271 tests) |
| Production Status | ⬜ testnet only — mainnet blocked until the ADR-0005 V2 migration |

Delivered this milestone:

- `src/core/market/feed-provider.ts` — semantic provider registry, V1/V2
  generation guards, environment-only migration (`describeFeedMigration`).
- `src/core/platform/runtime-telemetry.ts` — validated `/authority/telemetry`
  wire contract, freshness classification, window countdown selection.
- `src/lib/runtime-telemetry.server.ts` — live fetch with mirrored fallback.
- Live-wired surfaces: Dashboard, Markets, Active Windows, Signal Tank, Trade
  Monitor, Health — each badged `LIVE` / `MIRRORED` / `AWAITING AUTHORITY`.
- Docs: `docs/TESTNET_QUALIFICATION.md`, `docs/AUTHORITY_API_CONTRACT.md`,
  ADR-0005.

### M7.3 — Production Integration Qualification

| Field | Value |
|---|---|
| Status | 🚫 Blocked — workspace backend does not match the required production project |
| Dependencies | M7.2 ownership bootstrap and live production backend binding |
| Exit Criteria | Authoritative auth-state resolver, intentional first-owner bootstrap, immediate session, automatic registration closure, auth health surfaces, live VPS gates |
| Acceptance Status | 🟨 Resolver and fail-closed UI implemented; real production bootstrap unverified |
| Replay Status | ✅ contracts unchanged |
| Production Status | 🚫 required backend binding and live VPS are unavailable in this workspace |

Observed on 2026-08-02: the connected backend is healthy but is not the required
production backend. It contains one provisional owner, ownership is not finalized,
and authentication has public signup disabled. ARC therefore reports
`AUTH_CONFIGURATION_ERROR` and does not render a broken Create Account action.



### M8 — Mainnet Qualification

| Field | Value |
|---|---|
| Status | ⬜ Not started |
| Dependencies | M7 |
| Exit Criteria | Read-only mainnet observation soak, then explicitly authorised control-command enablement |
| Acceptance Status | ⬜ |
| Replay Status | ⬜ |
| Production Status | ⬜ |

---

## 2. Engine Tracker

| Engine | Discovery | Build | Unit | Integration | Replay | Security | Production |
|---|---|---|---|---|---|---|---|
| Configuration Engine | ✅ | ✅ | ✅ | ⬜ | N/A | 🟨 | ⬜ |
| Event Bus | ✅ | 🟨 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| Scheduler | ✅ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ⬜ |
| Health Engine | ✅ | ✅ | ✅ | ⬜ | N/A | ⬜ | ⬜ |
| Metrics Engine | ✅ | ✅ | ✅ | ⬜ | N/A | ⬜ | ⬜ |
| Persistence Layer | ✅ | 🟨 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Market Lifecycle Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Feed Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| PTB Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| TWAP Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Signal Conditioning Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Execution Window Manager | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Decision Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Risk Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Execution Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Settlement Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Ledger | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Replay Engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Analytics | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Notification Engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| API Layer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Signal Tank | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trade Inspector | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ops Deck | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Column meaning:

- **Discovery** — behaviour traced in `docs/reference/p4/` + `docs/knowledge/`, written up.
- **Build** — companion-side surface implemented in `src/`.
- **Unit** — unit tests pass.
- **Integration** — integration tests pass against a stubbed or real engine endpoint.
- **Replay** — deterministic replay verified (or `N/A` for stateless subsystems).
- **Security** — RLS, secret handling and authz reviewed for that surface.
- **Production** — every item in `docs/PRODUCTION_CHECKLIST.md` satisfied.

---

## 3. Update Protocol

1. A cell only moves forward on **observed** evidence — never on "should work".
2. The session that changes a cell states the evidence in its report or PR.
3. Regressions move cells backwards; they are never left stale.
4. Milestone status is derived from its engines, not asserted independently.

---

## 4. P0/M0 Evidence Log

| Claim | Evidence |
|---|---|
| Foundation modules implemented | `src/core/{shared,contracts,configuration,infrastructure}/*`, `src/core/runtime.ts` |
| Unit suite green | `bunx vitest run` — 53 tests / 5 files passing |
| Lint + typecheck green | `bun run lint` exit 0, `bunx tsgo --noEmit` exit 0 |
| Health surface observable | `GET /api/public/health` returns status, dependencies and version manifest |
| Migration audit written | `docs/migration/reze-audit.md` |
| No trading logic added | Audit §1 classifies every engine trading component as REMOVE |

---

## 5. M6 Evidence Log — Production Hardening

| Claim | Evidence |
|---|---|
| Architecture conformance automated | `tests/unit/architecture.test.ts` — layer direction, charter, no reference imports, no TODO markers |
| Security conformance automated | `tests/unit/security.test.ts` — secrets, authn on every server fn, input validation, public-route hygiene |
| Recovery validated at every restart boundary | `src/core/platform/recovery.ts`, `tests/unit/recovery.test.ts` (13 tests); `docs/RECOVERY_VALIDATION_REPORT.md` |
| Replay deterministic and idempotent | `tests/unit/replay-validation.test.ts` (7 tests); `docs/REPLAY_VALIDATION_REPORT.md` |
| Configuration fully externalised | `tests/unit/hardening.test.ts` — fails if a business default is hardcoded |
| Performance budgets met | `tests/unit/hardening.test.ts`; `docs/PERFORMANCE_REPORT.md` |
| Supabase indexed for console paths | migration adding 9 indexes; `docs/PERFORMANCE_REPORT.md` §Index additions |
| Duplicate suppression fixed | ledger dedupes by `recordId`; recovery dedupes by `eventId`; malformed payloads skipped, not fatal |
| Full suite green | `bunx vitest run` — 209 tests / 16 files passing; lint + typecheck + build clean |
| VPS deployment documented | `docs/VPS_DEPLOYMENT.md` |
| Production gate | `docs/PRODUCTION_READINESS_REPORT.md` — all subsystems Production Ready |

**M6 status: complete. Companion control plane is production ready and awaiting qualification.**

---

## 6. M6.5 Evidence Log — Operational Excellence

| Claim | Evidence |
|---|---|
| Startup validator with 14 blocking gates | `src/core/platform/startup-validator.ts`; blocked runs return `SYSTEM_START_BLOCKED` |
| Environment validator, no silent defaults | `src/core/configuration/env-validator.ts`; test asserts business vars declare no default |
| Boot configuration validator | `src/core/platform/boot-validator.ts` — windows, buffers, quota, risk limits |
| Liveness / readiness / startup / details probes | `src/routes/api/public/health/{live,ready,startup,details}.ts`; verified 200 / 503 live |
| Runtime watchdogs on 11 subsystems | `src/core/infrastructure/watchdogs.ts`; budgets derived from configuration |
| Secret scanner | `src/core/infrastructure/secret-scanner.ts`; startup gate 14 |
| Structured production logging contract | `src/core/infrastructure/log-contract.ts` — reason code + operational ids mandatory, secrets redacted |
| Graceful shutdown, ordered and idempotent | `src/core/platform/lifecycle.ts`; degraded runs exit 1 with `LIF_SHUTDOWN_DEGRADED` |
| Graceful restart without duplicate events | `restoreAfterRestart` + `suppressDuplicateEmissions`; deterministic digest |
| Deployment and incident documentation | `docs/OPERATIONS_RUNBOOK.md`, `docs/VPS_DEPLOYMENT.md` |
| Full suite green | `bunx vitest run` — 232 tests / 17 files passing |

**M6.5 status: complete.**

## 7. M6.6 Evidence Log — Operator Dashboard Finalization & UX Validation

| Surface | Capability exposed | Status |
| --- | --- | --- |
| Dashboard | System status, environment, platform/engine/schema versions, resolution countdown, market lifecycle, feed + TWAP health, current/effective TWAP, PTB, market state version, active window, trade quota, exposure, open orders, replay status, notifications, scheduler, VPS authority | complete |
| Execution Profiles | Multi-window table (enabled, priority, offset, unit, TWAP buffer, position size, retry count, timeout, override status, config version) with SINGLE/MULTI mode semantics and configuration digest | complete |
| Active Windows | Live activation and expiry countdowns, execution intent linkage | complete |
| Trade Monitor | Reconstructed ledger entries per execution intent alongside the execution timeline | complete |
| Signal Tank | Effective TWAP, PTB, applied buffer, decision outcome, market state version, feed freshness | complete |
| Analytics | Structured ledger summary (records, trades, settlements, quantity, notional, fees, realized PnL, first/last record), execution latency | complete |
| Configuration | TWAP feed provider + feed ID, execution defaults, per-window inheritance/override table, configuration digest | complete |
| System | Platform identity (platform/engine/configuration/replay/event-schema versions) and build information (network, runtime, git commit, deployment timestamp) | complete |

Unconfigured-state handling: surfaces that depend on an execution profile now render an explicit
"Execution Profile Unavailable" state (configuration is never hardcoded) instead of an indefinite
loading state.

Visual validation: authenticated walkthrough captured for dashboard, execution profiles, active
windows, trade monitor, signal tank, analytics, configuration, system and health with zero console
errors. 232 unit tests pass; typecheck clean.

**M6.6 status: complete.** No backend or trading-engine behaviour was modified.

## M6.7 — Operator UX refinements (control plane only)

- Execution Profiles is now fully operable when unconfigured: `getExecutionProfileConfig`
  returns `unconfigured` instead of throwing, and the console offers
  "Create execution profile" seeding a schema-default draft (no business values
  hardcoded in UI or engine code). Mode, quota, offsets, buffers and per-window
  overrides are all editable; save is blocked until at least one window exists.
- Global operator status strip (`src/components/arc/status-bar.tsx`) shows
  network, environment, market lifecycle, market countdown, feed freshness and
  the VPS badge (connected / no heartbeat / unregistered, latency, last sync).
  Read-only mirror — no authority asserted (ADR-0001).
- Trade Monitor renders the canonical vertical lifecycle timeline:
  Execution Intent → Risk → Standing Order → Reprice → Partial Fill →
  Settlement → Ledger.
- Indefinite "Loading…" text removed platform-wide: `LoadingState` for bounded
  reads, `EmptyState` with an operator next-action hint ("Waiting for VPS
  connection.") for empty data.
- Live value density (dashboard/markets/signal tank) and analytics charts remain
  deferred to M7 when a real feed and VPS endpoint exist.

## M6.8 — Execution Profile finalization (configuration surface only)

- Console seed (`DEFAULT_PROFILE_SEED`, configuration module — the engine never
  reads it) creates 15s / 10s / 7s / 5s / 3s windows with +0.20% / +0.15% /
  +0.12% / +0.08% / +0.05% buffers. Window unit default is now seconds.
  Everything stays add/remove/reorder/edit-able.
- Page split into GLOBAL EXECUTION PROFILE and WINDOW DEFINITIONS, plus a
  Profile Summary side panel (mode, trades per market, windows enabled, buffers).
- "Max Trades" renamed to Trades Per Market; execution mode shows Single Trade /
  Multi Window while the persisted enum is unchanged.
- Window table columns: Enabled, Priority, Offset, Unit, TWAP Buffer, Position,
  Retry, Timeout, Max Spread, Inheritance, Quota Cost, Remove. Overrides are
  Global/Override switches; timeouts are operator-facing seconds (milliseconds
  stay internal); buffers render as percentages when buffer mode is PERCENT.
- New per-window `timeoutMillisOverride` and `maxSpreadOverride` resolve through
  the existing global → window inheritance in `resolveWindowConfiguration`, with
  matching `timeout=` / `spread=` DSL modifiers.
- Priority is derived from offset order (furthest first); manual ordering is
  opt-in via an explicit switch.
- Validation blocks save on duplicate offsets, negative buffers, invalid
  timeouts/overrides, empty profiles, all-windows-disabled and an unreachable
  trade quota. Every field carries operator help text.
- No strategy leakage: no majority, crowd, confidence, vote, sentiment, venue
  direction or legacy compatibility concepts anywhere in the surface.

## M6.9 — Configuration synchronization & active runtime configuration (ADR-0003)

- **Persistence.** `configuration_versions` (immutable, numbered, content-hashed,
  mutation-blocked by trigger) and `runtime_configuration_state` (mirror of what
  the engine reports it runs). Both RLS-scoped to the operator; versions can
  never be deleted, only `SUPERSEDED` / `REJECTED` / `ARCHIVED`.
- **Sync core** (`src/core/platform/configuration-sync.ts`): canonical
  `cfgh_` hashing (windows sorted by offset), pre-dispatch validation, authority
  request/reply contract, verdict interpretation, drift detection and the
  canonical configuration event factory.
- **Authority client** (`src/lib/configuration-authority.server.ts`): timeout- and
  error-bounded `POST /configuration/apply` and `GET /configuration/active`
  against the registered engine endpoint. No reply is never treated as success.
- **Server functions** (`src/lib/configuration.functions.ts`):
  `publishConfigurationVersion`, `activateConfigurationVersion` (rollback /
  re-dispatch), `archiveConfigurationVersion`, `getConfigurationRuntimeView`.
- **Console.** Execution Profiles now publishes instead of saving: the operator
  waits for the authority verdict and sees APPLIED / REJECTED / PENDING. New
  "Active Runtime Configuration" panel (running vs saved version, hashes,
  snapshot id, runtime status, activation time, last sync, latency, drift) and
  "Configuration Versions" ledger with Activate (rollback) and Archive.
- **Events.** `ConfigurationVersionCreated`, `ConfigurationChanged`,
  `ConfigurationValidated`, `ConfigurationApplied`, `ConfigurationRejected`,
  `ConfigurationActivated`, `ConfigurationRolledBack`, `ConfigurationArchived`
  — all canonical, replayable and audit-logged.
- **Unchanged by design.** Window instances keep their frozen configuration
  snapshot; new configuration applies only to windows created after activation.
  Infrastructure settings stay in environment variables. No trading logic exists
  in the companion (ADR-0001).
- Verification: 246 unit tests green (8 new synchronization tests), typecheck
  clean, architecture conformance test enforces the layering of the new module.

## M6.10 — VPS authority registration & runtime handshake (ADR-0004)

- **Persistence.** `engine_endpoints` expanded with API/engine/platform version,
  handshake + health endpoints, public identifier, sync interval and last-seen.
  New `engine_runtime_identity` mirrors the last successful handshake (engine id,
  environment, network, versions, configuration version/hash/snapshot, scheduler
  and feed status, current market, health grid, capabilities, uptime). RLS scoped
  to the operator; writes limited to operator/admin.
- **Handshake core** (`src/core/platform/authority-handshake.ts`): registration
  schema with credential-material rejection, `handshakeResponseSchema`, dashboard
  runtime-state vocabulary, health merge/worst-status, and saved-vs-running
  verification with per-field drift reasons.
- **Transport** (`src/lib/authority-handshake.server.ts`): timeout-bounded
  handshake classified as OK / UNREACHABLE / UNAUTHORIZED / PROTOCOL_MISMATCH /
  NOT_REGISTERED, mirror upsert on success, mirrored fallback marked not-live.
- **Server functions** (`src/lib/engine.functions.ts`): list/save/activate/delete
  registrations, `probeEngineHandshake` (test before registering) and
  `getAuthorityRuntime` (the polling read).
- **Console.** New Engine Registry route (register, edit, test handshake,
  activate, remove; viewers read-only) and the expanded Active Runtime
  Configuration panel on Execution Profiles. Status strip VPS/Engine cells now
  read live handshake state. Polling uses the registered per-engine interval and
  refetches on focus and reconnect.
- **Security.** No credential is stored in the database or sent to the browser;
  registration rejects pasted secret material; all mutations are audited.
- 258 unit tests pass; typecheck clean; authenticated console verified with zero
  console errors.

**M6.10 status: complete.** No trading logic was implemented; the VPS remains the
sole trading authority.

## M7.1 — Live VPS Authority Integration & Single Operator Authentication

| Item | Status |
| --- | --- |
| Live authority handshake + telemetry polling (`/authority/handshake`, `/authority/telemetry`) | Implemented (M7.0) |
| Configuration publish → Supabase immutable version → authority activation | Implemented (M6.7) |
| Runtime state vocabulary LIVE / MIRRORED / PENDING / REJECTED / DRIFT | Implemented |
| Feed provider abstraction, V1 testnet → V2 mainnet by `.env` only | Implemented (ADR-0005) |
| **Single operator authentication** | **Implemented (M7.1)** |
| — `owner` role added to `app_role`; earliest account promoted to OWNER | Done |
| — First registration on a fresh deployment becomes OWNER automatically | Done (`handle_new_user`) |
| — Email confirmation disabled (auto-confirm), no activation emails | Done |
| — Public registration closed after bootstrap (provider-level `disable_signup`) | Done |
| — Sign-in screen: email + password only; shows "Operator already configured" | Done |
| — Public bootstrap probe returns a single boolean, no identity data | Done (`operator_bootstrapped()`) |
| Live PM2 engine observation of the 14 startup gates | **Pending operator run** — see `docs/TESTNET_QUALIFICATION.md` |

Security posture unchanged: the browser never receives the service role key, database
credentials, wallet/trading keys or authority secrets. The VPS remains the sole trading
authority (ADR-0001).

## M7.2 — Live VPS Qualification & Operator Ownership Finalization

| Item | Status |
| --- | --- |
| Explicit ownership record (`operator_ownership`) | Done |
| Provisional bootstrap owner (never permanent) | Done |
| Owner migration tool (`/ownership`, bootstrap-only) | Done |
| Previous owner demoted + sessions revoked | Done |
| Ownership finalization closes public registration | Done |
| No hardcoded operator email anywhere | Done |
| Trusted operator session restores automatically | Done (Supabase persisted session) |
| Live VPS qualification gates | Pending operator run against PM2 engine |

## M7.4 — Supabase Provider Abstraction & Migration Readiness

| Item | Status |
| --- | --- |
| Provider layer (`src/lib/supabase/`: config, provider, client, backend.server) | Done |
| All browser Supabase access routed through `@/lib/supabase/client` | Done |
| Backend selected only through environment (`SUPABASE_URL` / `SUPABASE_ANON_KEY`) | Done |
| No compiled backend URL, project ref or key (enforced by test) | Done |
| Optional deployment guard `ARC_REQUIRED_SUPABASE_URL` | Done |
| System → Backend Connection diagnostics (masked URL, DB/auth health) | Done |
| Service-role material never reaches the browser (filename-enforced) | Done |
| Auth + ownership behaviour unchanged | Done |
| Cutover to a dedicated Supabase project | Pending: set `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` for that project and apply the ARC migrations there |

Note: `src/lib/supabase/backend.server.ts` carries the `.server.ts` suffix rather than
the plain `server.ts` name so the bundler refuses any client-side import of it.

## M7.5 — Production Cutover Preparation & Authority Registration Framework

| Item | Status |
| --- | --- |
| Cutover guard `assertCutoverSafe()` wired into every mutating server function | Done |
| Guarded actions: sign-in, ownership change, configuration publish, authority registration | Done |
| Backend match surfaced on System → Backend Connection (`Expected Backend` / `Match`) | Done |
| Control-plane migration checklist via `arc_schema_report()` (reports, never recreates) | Done |
| `authority_registry` table + trigger rejecting secret material | Done |
| Registration contract (`/authority/register`, `/authority/heartbeat`) with mandatory timestamp + signature | Done |
| Derived liveness (`registered` → `active` → `stale`, `revoked`) from heartbeats only | Done |
| Engine Registry → Trading Authority Registry read-only panel | Done |
| `docs/deployment/supabase-cutover.md` (env, migration order, verification, rollback) | Done |
| Configuration publish flow unchanged (ADR-0003) | Done |
| Tests: cutover guard, target validation, migration readiness, registration contract | Done (301 total) |
| Execute the production cutover | Pending operator run |
| VPS calls `/authority/register` against production | Pending M7.6 |

## M7.6 — VPS Trading Authority Registration & PM2 Engine Handshake

| Item | Status |
| --- | --- |
| HMAC-SHA256 authority message authentication (canonical payload, constant-time compare) | Done |
| Fail-closed: unconfigured signing key rejects every message (`503 KEY_UNCONFIGURED`) | Done |
| Timestamp skew window (±60s) and replay guard (`authority_replay_guard`, 15 min) | Done |
| `POST /api/public/authority/register` — engine-initiated, public identity only | Done |
| `POST /api/public/authority/heartbeat` — runtime status, uptime, active market/windows, event sequence | Done |
| `GET /api/public/authority/configuration` — engine pulls the pending version (no inbound port on the VPS) | Done |
| `POST /api/public/authority/configuration` — signed `ACCEPTED` / `REJECTED` verdict; hash-drift guard | Done |
| Nothing becomes ACTIVE without a verified engine verdict | Done |
| Revoked authority stays revoked across re-registration | Done |
| PM2 restart detection via `runtimeIdentity`, audited as `authority.restarted` | Done |
| Registry panel: runtime status, uptime, latency, active market, config version, registrations | Done |
| `docs/AUTHORITY_API_CONTRACT.md` control-plane section; `docs/OPERATIONS_RUNBOOK.md` §9 PM2 integration | Done |
| Tests: signature/timestamp/replay, registration, heartbeat lifecycle, liveness, dispatch, security | Done (330 total) |
| Live VPS engine registers against the deployed control plane | Pending operator run |

## M7.7 — Testnet Qualification Harness

| Item | Status |
| --- | --- |
| Deterministic full-lifecycle scenario (`src/core/qualification/scenario.ts`) | Done |
| Pure gate evaluator: lifecycle, multi-window, replay, recovery, configuration, observability | Done |
| `/qualification` operator console with gate checklist and window activation order | Done |
| Replay determinism: harness clock enforces 1ms event separation | Done |
| `docs/qualification/M7_7_TESTNET_QUALIFICATION_REPORT.md` | Done |
| Live gates remain PENDING until VPS evidence exists | Done |

## M7.8 — Live Authority Qualification & Production Audit Preparation

| Item | Status |
| --- | --- |
| Pure live evidence model + evaluator (`src/core/qualification/live-gates.ts`) | Done |
| Gate: authority ACTIVE — runtime identity, fresh heartbeat (2× interval), measured latency | Done |
| Gate: engine startup chain — configuration → feed → discovery → PTB → TWAP → signal → market state → windows armed | Done |
| Startup chain derived only from authority-reported telemetry; unreported step is never inferred | Done |
| Companion startup problems recorded as notes, never as a VPS verdict | Done |
| Gate: configuration activation round-trip — LIVE, hash match, snapshot id, version match, no drift | Done |
| Gate: telemetry complete and current — LIVE source, within sync budget, all 8 mandated fields | Done |
| Gate: security posture — signed handshakes, ownership finalized, registry rejects secret material | Done |
| Authenticated evidence collector (`src/lib/qualification.functions.ts`) | Done |
| "Live Authority Gates — M7.8" panel on `/qualification`; combined verdict with the deterministic gates | Done |
| `docs/qualification/M7_8_LIVE_AUTHORITY_REPORT.md` | Done |
| Tests: evaluator, staleness, drift, telemetry completeness, startup chain derivation | Done (368 total) |
| Signing key configured, ownership finalized, VPS registered and publishing telemetry | Pending operator run |

## M7.9 — Security Finalization, Authority Activation & Live Gate Completion

| Item | Status |
| --- | --- |
| Signed registration required; unsigned, forged, stale and replayed messages rejected | Done (M7.6 gateway, re-verified) |
| Fail-closed when `ARC_AUTHORITY_SIGNING_KEY` is absent (`503 KEY_UNCONFIGURED`) | Done |
| Ownership lifecycle: bootstrap → owner → finalize → registration permanently disabled | Done |
| `ownership.finalized` audit entry written by `finalize_ownership()` | Done |
| Pure activation checklist (`src/core/qualification/activation.ts`) — 7 steps, owner-attributed | Done |
| Step states derived from evidence only: DONE / READY / WAITING / BLOCKED, never a tick-box | Done |
| "Activation Checklist — M7.9" panel on `/qualification` with DONE count | Done |
| Tests: prerequisite ordering, blocking, drift/staleness reopening, missing telemetry fields | Done (383 total) |
| `docs/qualification/M7_9_SECURITY_ACTIVATION_REPORT.md` | Done |
| Signing key set on both sides · ownership finalized · VPS ACTIVE · live gates green | Pending operator run |

## M7.10 — Production Activation Readiness & Operator Finalization Hardening

| Item | Status |
| --- | --- |
| `handle_new_user()` hardened: owner claimed once, nothing granted after finalization | Done |
| No seeds, no hidden owners, no email verification for the bootstrap operator | Done |
| Signing key metadata only (`getAuthoritySigningStatus`) — value never displayed, stored or logged | Done |
| "Authority Signing" panel on `/system` (configured, strength, last verified, ownership) | Done |
| Activation diagnostics: reason / missing evidence / required action / expected transition | Done |
| Engine registry statuses ACTIVE · STALE · REVOKED · UNREGISTERED, derived from verified evidence | Done |
| Registry shows authority id, runtime identity, version, heartbeat age, latency | Done |
| Configuration activation NOT_PUBLISHED → PENDING → ACCEPTED → ACTIVE (+ REJECTED, DRIFTED) | Done |
| ACTIVE only on a live authority confirmation — never from a mirrored or stored value | Done |
| Nine-step VPS startup evidence panel on `/qualification` | Done |
| Security tests: unsigned, wrong key, stale, replayed, ownership locking, activation diagnostics | Done (408 total) |
| Architecture compliance: no trading logic, no forbidden imports, reference tree untouched | Done |
| `docs/qualification/M7_10_ACTIVATION_READINESS_REPORT.md` | Done |
| Signing key configured · ownership finalized · VPS registered and ACTIVE | Pending operator run |

## M8.0 — Final Production Audit & Mainnet Qualification Preparation

| Item | Status |
| --- | --- |
| Architecture audit: dependency direction, engine/strategy/execution isolation, configuration and authority ownership | PASS |
| Mainnet readiness gate (`src/core/qualification/mainnet.ts`) — 8 domains, one verdict, no override path | Done |
| VPS authority validation: registered · identity · signature · heartbeat → ACTIVE / STALE / REVOKED / UNREGISTERED | Done |
| PM2 production validation procedure | Done (`docs/deployment/M8_PM2_VALIDATION.md`) |
| Replay qualification: deterministic replay separated from external execution simulation | PASS |
| Recovery qualification: no duplicate intents, orders, settlements or ledger records | PASS |
| Configuration audit: no drift, no unauthorized change, rollback and archive | PASS |
| Security audit: secrets, HMAC + timestamp window + replay guard, ownership and audit trail | PASS |
| Dashboard audit across all operator surfaces | PASS |
| Production monitoring metrics and mandatory log fields | Done (`docs/operations/M8_MONITORING.md`) |
| "Mainnet Readiness Gate — M8.0" panel on `/qualification` | Done |
| Tests: readiness gate, no-override assertion, secret exposure, legacy purge | Done (429 total) |
| `docs/qualification/M8_PRODUCTION_READINESS_REPORT.md` | Done |
| Mainnet verdict | NOT QUALIFIED — pending live authority evidence |

## M8.2 — Final Production Cutover, Environment Provisioning & Release

| Item | Status |
| --- | --- |
| Signing key provisioned as a server-side environment variable only — never committed, logged, stored or displayed | Done |
| `/system` Authority Signing shows Status · Last Verified · Source: Server Environment (metadata only) | Done |
| `.env.example`, `.env.production.example`, `.env.vps.example` with purpose / default / required / owner comments | Done |
| Environment validation: operator-friendly startup failure, no silent defaults (`formatEnvFailure`, `assertEnvironmentValid`) | Done |
| Repository cleanup: 32 unused UI modules, unused hook, 28 unused dependencies, build metadata, stale lockfile | Done |
| Release preparation: README, production setup guide, documentation link verification | Done |
| `docs/deployment/PRODUCTION_SETUP.md` · `docs/release/M8_2_RELEASE_SUMMARY.md` | Done |
| Verification: build · typecheck · lint · tests (458) · docs · architecture · qualification · security | PASS |
| Frozen domains unchanged (market state, TWAP, PTB, decision, risk, standing orders, replay, recovery, contracts, gates) | Verified |
| Live VPS activation (signing key on VPS, PM2 ARMED) | Pending operator run |
