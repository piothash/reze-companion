# ARC — Engineering Discovery Report

**Session:** 0 (Initialization) · **Mode:** read-only inspection + workspace setup
**Scope:** everything present in this workspace and in the ARC source archive.

---

## 1. GitHub

| Field | Value |
|---|---|
| Intended workspace repository | `https://github.com/piothash/reze-companion` |
| Intended source repository | `https://github.com/piothash/reze` |
| Git remote observed in this sandbox | Lovable-internal storage remote (`origin`) + an S3 `secondary` remote |
| GitHub remote observed | **none** |
| Connection verified | **NO** |

**Finding.** This workspace's git remotes point at Lovable's internal project
storage, not at `github.com/piothash/reze-companion`. There is no GitHub remote
configured. GitHub sync in Lovable is a UI-level integration (chat **+** menu →
GitHub → Connect project) and is not exposed to the build sandbox, so it cannot be
established or authorised from inside a session. Push/pull permission, default
branch, and sync status against GitHub are therefore **unverifiable from here** —
they are not assumed.

**Action required from the operator:** connect the project to
`piothash/reze-companion` via the **+** menu → GitHub. Once connected, Lovable
commits sync to that repository automatically.

**Source repository** was supplied as an archive (`arc-main`) rather than by clone;
its contents are mirrored read-only at `docs/reference/p4/` and `docs/knowledge/`.

---

## 2. Project Summary

### This workspace (the companion)

| Aspect | Value |
|---|---|
| Framework | TanStack Start v1 (React 19, file-based routing) |
| Language | TypeScript 5.8, `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` |
| Package manager | bun |
| Build system | Vite 8 via `@lovable.dev/vite-tanstack-config`, Nitro → Cloudflare Workers |
| Database | Lovable Cloud (Postgres) — enabled in Session 0 |
| Authentication | Lovable Cloud auth (email/password + Google) |
| Deployment | Lovable hosting, edge/serverless Worker runtime |
| State management | TanStack Query + TanStack Router loaders |
| Styling | Tailwind v4 via `src/styles.css`, shadcn/ui primitives |

### The ARC engine (reference, runs on the VPS)

| Aspect | Value |
|---|---|
| Purpose | Autonomous maker/directional bot for Polymarket rolling 5-minute BTC UP/DOWN markets |
| Framework | Next.js 16 (App Router) hosting both dashboard and engine |
| Process model | Single long-lived Node process under PM2 (`ecosystem.config.js`), engine as `globalThis` singleton created from `instrumentation.ts` |
| Package manager | pnpm |
| Persistence | `better-sqlite3`, WAL, `synchronous=NORMAL`, at `DB_PATH`; tables `trades`, `order_log`, `audit_log`, `kv` |
| Exchange | Polymarket CLOB V2 (`@polymarket/clob-client-v2`), EIP-712 signing via `ethers`, HMAC API auth, post-only maker orders |
| Modes | `PAPER_V1` (simulated exchange with chaos injection) and `LIVE_V2`, behind one `Executor` contract |
| Testing | Vitest — 30+ unit and integration suites incl. soak and chaos |
| Auth | Dashboard session cookie + CSRF in `proxy.ts`; `BOT_CONTROL_TOKEN` for API control |

---

## 3. Repository Structure

```
src/                       companion implementation (the only writable code)
  routes/                  file-based routes (public + _authenticated subtree)
  lib/                     *.functions.ts server functions, client-safe helpers
  components/ui/           shadcn primitives
  integrations/supabase/   generated Cloud clients (never edited by hand)
docs/
  ARC_PROJECT_CHARTER.md   constitution: frozen architecture, hybrid rule, ADR process
  ARC_DISCOVERY_REPORT.md  this document
  architecture/            ADR-0001 hybrid control plane, ADR-0002 reference read-only
  governance/              two-repo rule, do-not-touch, session workflow, DoD
  knowledge/               40+ ARC engineering reports (verbatim, read-only)
  reference/p4/            ARC engine source (verbatim, read-only, never bundled)
```

### Reference module map (`docs/reference/p4/lib/v2/engine/`)

| Module | Responsibility |
|---|---|
| `engine.ts` (~1551 LOC) | Master state machine, tick loop, phase transitions, rollover, snapshot |
| `standing-order.ts` (~2489 LOC) | SLO manager: `ARMED` → `TRIGGERED` → `RESTING` → `FILLED` |
| `execution/executor.ts` | Common executor contract shared by live and paper |
| `execution/live.ts` | CLOB V2 adapter, EIP-712 signing, post-only, cancel/replace verification |
| `execution/paper.ts` | Simulated exchange; structurally incapable of real orders |
| `feeds/*` | BTC reference feed, CLOB price feed, WS client, market discovery, account sync, order events |
| `handlers/*` | Dust compounding, oracle sync guard, orphan cleaner, protocol validator, cancel-replace pipeline, accounting invariant |
| `risk.ts` | Kill switch + daily loss / order-count / notional / share caps |
| `reconciler.ts` | 60s read-only comparison of tracked vs on-exchange state |
| `settlement-verifier.ts`, `settlement-repair.ts`, `accounting-verifier.ts` | Settlement and ledger integrity |
| `db.ts` (~769 LOC) | SQLite handle, migrations, KV, write queue, orphan scratch on boot |
| `analytics.ts`, `report.ts`, `trade-replay.ts` | Dashboard aggregation and explanation |
| `notifier.ts`, `telegram*.ts` | Alerting and operator console |
| `watchdog.ts`, `system-monitor.ts`, `preflight.ts`, `latency-trace.ts` | Liveness, resources, startup gates, latency |
| `events.ts` | The single logging entry point |

**Entry points.** Engine: `instrumentation.ts` → `instrumentation-node.ts` → engine
singleton → `maybeAutoResume()` → `restoreConfig()` → lazy `getDb()`.
Companion: `src/router.tsx` → `src/routes/__root.tsx` → route tree; server side
`src/server.ts` + `src/start.ts`.

**Engine API surface** (13 routes under `app/api/v2/bot/`): `status`, `control`,
`analytics`, `audit`, `database`, `diagnostics/credentials`, `health`,
`notifications`, `preflight`, `profiles`, `system`, `trades`, `trades/[id]/replay`.
These are the canonical integration points for the companion.

---

## 4. Lovable Cloud (database, auth)

| Item | Status |
|---|---|
| Backend | **Enabled in Session 0** |
| Client initialisation | Generated clients present under `src/integrations/supabase/` |
| Bearer attachment | `functionMiddleware` registered in `src/start.ts` |
| Authentication | Email/password + Google, operator-gated `_authenticated` subtree |
| Database connectivity | Verified — migrations applied successfully |
| Migrations | 2 applied: foundational schema, then function-execute hardening |

### Tables created (structure only, no trading behaviour)

| Table | Purpose | Access |
|---|---|---|
| `profiles` | Operator profile, auto-created on signup | own row |
| `user_roles` + `app_role` enum + `has_role()` | Roles held separately from profile | own rows; admins manage |
| `engine_endpoints` | VPS base URL / environment per operator | own rows; admin read |
| `engine_snapshots` | Mirrored engine state (**cache only**) | own rows; admin read |
| `event_log` | Mirrored canonical engine events | own rows; admin read |
| `notifications` | Operator-facing alerts | own rows |
| `feature_flags` | Companion-side flags | all signed-in read; admin write |
| `configuration_profiles` | Named companion config presets | own rows |
| `audit_log` | Companion-side action trail | insert/read own; admin read |

RLS is enabled on all nine with explicit GRANTs; every policy is scoped to
`auth.uid()` except the admin paths, which go through the security-definer
`has_role()`. No table is readable by anonymous visitors.

**Known accepted linter warning:** `has_role(uuid, app_role)` is executable by
signed-in users. That is required — RLS policies evaluate it as the querying role.
`handle_new_user()` and `update_updated_at_column()` have had EXECUTE revoked from
`public`, `anon`, and `authenticated`.

---

## 5. Environment

### Companion (present, injected by Lovable Cloud)

`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID`,
`SUPABASE_SERVICE_ROLE_KEY` (server-only), and the `VITE_`-prefixed browser
equivalents.

### Companion (required later, **not yet set** — no values invented)

| Variable | Purpose |
|---|---|
| `ARC_ENGINE_BASE_URL` | Default VPS base URL when an operator has no `engine_endpoints` row |
| `ARC_ENGINE_CONTROL_TOKEN` | Bearer/token for authenticated engine calls (maps to the engine's `BOT_CONTROL_TOKEN`) |

Both must be stored as runtime secrets when the first authenticated engine call is
wired. Neither is required for Session 0.

### Engine environment referenced by `docs/reference/p4` (VPS-side, informational)

Exchange/auth: `CLOB_API_KEY`, `CLOB_SECRET`, `CLOB_PASS_PHRASE`, `CLOB_HTTP_HOST`,
`CLOB_WS_HOST`, `DATA_API_HOST`, `GAMMA_HTTP_HOST`, `POLYMARKET_CLOB_URL`,
`POLYMARKET_CHAIN_ID`, `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE`,
`POLY_PRIVATE_KEY`, `POLY_PROXY_ADDRESS`, `WALLET_PRIVATE_KEY`, `FUNDER_ADDRESS`,
`EXCHANGE_CONTRACT`, `SIGNATURE_TYPE`, `CHAIN_ID`.
Price reference: `BTC_REFERENCE_SOURCE`, `CHAINLINK_BTC_USD_FEED`,
`CHAINLINK_RPC_URL`, `CHAINLINK_DATASTREAMS_API_KEY`,
`CHAINLINK_DATASTREAMS_API_SECRET`.
Ops: `DB_PATH`, `ENVIRONMENT`, `NODE_ENV`, `PAPER_STARTING_BALANCE`,
`BOT_CONTROL_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`TELEGRAM_ADMIN_CHAT_IDS`, `HTTP_PROXY`/`HTTPS_PROXY`/`SOCKS5_PROXY`,
`P4_DIAG_DIRECTION`, `P4_RESOLUTION_ATTEMPTS`, `P4_RESOLUTION_POLL_MS`, `PM2_HOME`.

**Audit findings.**

- Missing here: `ARC_ENGINE_BASE_URL`, `ARC_ENGINE_CONTROL_TOKEN` (expected — not yet needed).
- Duplicated concepts in the reference: two overlapping credential families
  (`CLOB_*` and `POLY_*`) and two wallet-key names (`POLY_PRIVATE_KEY`,
  `WALLET_PRIVATE_KEY`). Informational only — VPS-side, out of scope here.
- Hardcoded secrets in this repository: **none found**.
- No `.env` with real values is committed; `.env` is git-ignored.
- No live database, WAL, or SHM file was copied into this repository.

---

## 6. Dependency Audit

### Companion

Current, coherent, no deprecated packages: React 19.2, TanStack Router 1.170 /
Start 1.168 / Query 5.101, Vite 8, Tailwind 4.2, Zod 3.24 (Zod 4 is available but
migration is not free — leave until needed), `@supabase/supabase-js` 2.111.
Unused today: most Radix primitives and `recharts`, `embla`, `vaul`, `cmdk` etc.
ship with the template. Not a problem — they are tree-shaken — but they should not
be treated as endorsed choices.

### Reference (`docs/reference/p4`) — informational, never installed here

| Package | Note |
|---|---|
| `better-sqlite3` | Native addon — **cannot run on Cloudflare Workers** |
| `ws`, `socks-proxy-agent`, `https-proxy-agent`, `undici` | Long-lived sockets / Node http agents — not Worker-viable |
| `ethers` 6 | Would work in a Worker, but signing belongs on the VPS only |
| `@polymarket/clob-client-v2` | Exchange SDK — VPS only, by charter |
| `next` 16, `eslint-config-next`, `postcss` | Different framework; excluded from this build |
| pnpm `overrides` | Pins `hono`, `ws ≥8.21.0`, `postcss ≥8.5.10` — security-motivated pins already in place |

**Security concerns.** The reference tree contains credential-derivation tooling
(`gen-creds.js`, `scripts/derive-clob-credentials.mjs`) and documentation naming
wallet keys. No key material itself is present. Because the tree is committed as
reference, treat `docs/reference/**` as public-readable and never add real values
to it.

**Nothing was installed, upgraded, or removed in this session.**

---

## 7. Architecture Understanding

**Current architecture (engine).** One process, one engine singleton, two
independent trading subsystems (Strategy Engine and Standing Limit Order manager),
one executor contract with live/paper implementations, feeds pushing into a tick
loop, all money movement through the SQLite ledger, all mutation of engine state
through typed control methods, all logging through a single `logEvent` entry point.
Recovery is money-correct at boot: orphaned `OPEN` rows are scratched and refunded.

**Data flow.**

```text
BTC ref feed ─┐
              ├─► Engine.tick() ─ strategy.decide() ─ Executor.place/cancelReplace ─ CLOB | SimBook
CLOB feed ────┘        │                                        │
                       ▼                                        ▼
                   Bankroll                              order_log / audit_log
                       │                                        │
                       └──► settleSlot() ─ ledger ─ Bankroll credit ─ Reconciler cross-check
```

**Reusable for the companion (shape, not code):** the `snapshot()` payload
contract, engine phase and SLO state enums, the analytics aggregation shape, the
trade-replay format, and the API route contracts under `app/api/v2/bot/`.

**Business logic — stays on the VPS, permanently:** sizing and dust compounding,
fair-price/EV computation, phase timing, risk caps and kill switch, cancel/replace
safety, settlement verification and repair, accounting invariants.

**Technical debt observed in the reference (recorded, not actioned):** two
credential families for the same exchange; `standing-order.ts` and `engine.ts` are
very large single modules; a legacy `strategy/sniper.ts` living alongside the
strategy registry. All are VPS-side and out of this project's scope.

**Refactor opportunities — none proposed.** The architecture is frozen.

---

## 8. Technical Issues

| Area | Status |
|---|---|
| Install | Clean (bun) |
| Build | Verified this session |
| Lint | Verified this session; `docs/**` excluded |
| TypeScript | Companion typechecks; `docs/**` outside `include` by design |
| Configuration | Coherent; reference tree fully isolated from the build graph |
| Runtime incompatibility | **Structural, expected:** the reference stack cannot run on Workers. Mitigated by ADR-0001, not by code |
| Potential bugs | None in companion code (surface is intentionally minimal this session) |
| Security warning | One accepted: `has_role` executable by signed-in users (required by RLS) |

---

## 9. Readiness Assessment

| Criterion | Status |
|---|---|
| Repository understood | **YES** |
| Reference ingested (docs + p4, no live data) | **YES** |
| Workspace repository confirmed as implementation target | **YES** (by charter) |
| GitHub connected and verified | **NO** — no GitHub remote visible from the build sandbox; connect via the **+** menu → GitHub |
| Lovable Cloud connected | **YES** |
| Architecture understood | **YES** |
| Environment audited | **YES** |
| Build and dependency status reviewed | **YES** |
| Ready for engine-by-engine implementation | **YES**, with the GitHub link as the one outstanding operator action |
