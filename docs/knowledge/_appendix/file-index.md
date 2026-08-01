# File Index — Phase 0.5 (updated)

Every file under `reference/p4/` (excluding `node_modules/`, `.next/`, `.git/`) mapped to a KB report or appendix. Updated during Phase 0.5 to close every gap from the Phase 0 version.

## Top-level operator markdown (all now indexed)

| File | Indexed in |
|------|-----------|
| `README.md` | `_appendix/operator-runbooks.md` |
| `DERIVE_CREDENTIALS.md` | `_appendix/operator-runbooks.md` |
| `EXECUTION_LATENCY_OPTIMIZATION.md` | `_appendix/operator-runbooks.md` |
| `OPERATIONS.md` | `_appendix/operator-runbooks.md`, `_appendix/errata.md` (retracts Report 15 "no runbook") |
| `PRODUCTION_SETUP.md` | `_appendix/operator-runbooks.md` |
| `QUICK_START.md` | `_appendix/operator-runbooks.md` |
| `SETUP.md` | `_appendix/operator-runbooks.md` |
| `TRADING_GUIDE.md` | `_appendix/operator-runbooks.md` |
| `docs/production-certification.md` | `_appendix/operator-runbooks.md` |

## Runtime and build config

| File | Indexed in |
|------|-----------|
| `ecosystem.config.js` | 01, 13, `PHASE0_COMPLETION_REPORT.md` §1.3 U5 (PM2 flags) |
| `next.config.mjs` | `PHASE0_COMPLETION_REPORT.md` §3 (bundling of `better-sqlite3`, `ws`) |
| `postcss.config.mjs` | `_appendix/file-index.md` (no KB semantics; framework CSS glue) |
| `eslint.config.mjs` | 01 (via `_appendix/errata.md` — corrects `.js` → `.mjs`) |
| `tsconfig.json` | `_appendix/file-index.md` (no KB semantics beyond aliases) |
| `vitest.config.ts` | `_appendix/test-coverage-matrix.md` (framework config) |
| `components.json` | `_appendix/file-index.md` (shadcn/ui config; no KB semantics) |
| `package.json` | 00 |
| `proxy.ts` (root — Next middleware) | 01, 02 |
| `instrumentation.ts` | 01, 13 |
| `instrumentation-node.ts` | 01, 13, `PHASE0_COMPLETION_REPORT.md` §5 (shutdown path) |
| `gen-creds.js` | `_appendix/operator-runbooks.md`; `PHASE0_COMPLETION_REPORT.md` §1.4 Q10 |

## App routes (`app/`)

| File | Indexed in |
|------|-----------|
| `app/layout.tsx` | 02 (root layout) |
| `app/page.tsx` | 02 |
| `app/login/page.tsx` | 02 |
| `app/v1/page.tsx` | 02 |
| `app/v2/page.tsx` | 02 |
| `app/api/auth/login/route.ts` | 02; auth surface uses `dashboard-auth.ts` (see §4.1 completion report) |
| `app/api/auth/logout/route.ts` | 02 |
| `app/api/v2/bot/analytics/route.ts` | 02 |
| `app/api/v2/bot/audit/route.ts` | 02 |
| `app/api/v2/bot/control/route.ts` | 02, 03 |
| `app/api/v2/bot/database/route.ts` | 02 |
| `app/api/v2/bot/health/route.ts` | 02 |
| `app/api/v2/bot/notifications/route.ts` | 02 |
| `app/api/v2/bot/preflight/route.ts` | 02 |
| `app/api/v2/bot/profiles/route.ts` | 02, 10 |
| `app/api/v2/bot/status/route.ts` | 02 |
| `app/api/v2/bot/strategies/route.ts` | 02 |
| `app/api/v2/bot/system/route.ts` | 02 |
| `app/api/v2/bot/trades/[id]/replay/route.ts` | 02 |
| `app/api/v2/bot/trades/route.ts` | 02 |

**Route-level auth audit:** deferred (R2 in completion report). All mutating routes should call `checkControlAuth` (`api-auth.ts`); a route-by-route grep is not part of Phase 0.5.

## Components (`components/`)

| File | Indexed in |
|------|-----------|
| `components/login-form.tsx` | 02 |
| `components/ui/button.tsx` | 02 (shadcn primitive) |
| `components/v2/*` (14 panels) | 02 |

## Library — engine (`lib/v2/engine/`)

All indexed in `01-architecture.md` unless noted; additional deep coverage below.

| File | Also indexed in |
|------|-----------------|
| `accounting-verifier.ts` | 07; completion §1.3 U13 (identities A/B/C/D) |
| `analytics.ts` | 02, 07 |
| `api-auth.ts` | 02; completion §4.2 (full quote) |
| `bankroll.ts` | 07 |
| `clock.ts` | 11; `_appendix/test-coverage-matrix.md` |
| `comparison.ts` | 14; completion §1.4 Q7 (read-only per `:9-11`) |
| `config.ts` | 00; completion §3 (full env schema) |
| `dashboard-auth.ts` | 02; completion §4.1 (full quote) |
| `db.ts` | 07, 12, 13; completion §1.3 U5, `_appendix/errata.md` (line shift) |
| `engine.ts` | 03; `_appendix/errata.md` (class name `Edge5Engine`) |
| `events.ts` | 01, 14 |
| `http-agent.ts` | 01 |
| `latency-trace.ts` | 01 |
| `market-model.ts` | 01 |
| `notifier.ts` | 08, 13 |
| `preflight.ts` | 13 |
| `proxy.ts` (engine-internal) | `PHASE0_COMPLETION_REPORT.md` §1.1 C5 — outbound HTTP/WS proxy; distinct from root `proxy.ts` |
| `reconciler.ts` | 09; `_appendix/errata.md` (line shift −2) |
| `report.ts` | 01 |
| `risk.ts` | 08; `_appendix/errata.md` (`DEFAULT_LIMITS` at `:65-71`) |
| `settlement-repair.ts` | 06, 15; completion §1.4 Q6 |
| `settlement-verifier.ts` | 06; completion §1.4 Q6 (auto-repair on official evidence, 60s sweep) |
| `standing-order.ts` | 04 — symbol-scan only. Deep trace pending (R3/R4) |
| `strategy-profiles.ts` | 02, 10 |
| `system-monitor.ts` | 13 |
| `telegram.ts` / `telegram-console.ts` | 13 |
| `trade-replay.ts` | 14; consumed by `scripts/replay-trade.ts` |
| `types.ts` | Referenced throughout |
| `watchdog.ts` | 13; completion §1.3 U14 (thresholds quoted) |
| `execution/executor.ts` | 05 |
| `execution/live.ts` | 05; `_appendix/errata.md` (`POST_ONLY:43`, `TICK_SIZE:45`) |
| `execution/paper.ts` | 05 |
| `feeds/account-sync.ts` | 09, 11 |
| `feeds/btc-reference-feed.ts` | 11 |
| `feeds/clob-price-feed.ts` | 11 |
| `feeds/clob-ws-client.ts` | 11 |
| `feeds/market-discovery.ts` | 11; `_appendix/direction-matrix.md` (label→tokenId mapping at `:129-142`) |
| `feeds/order-events.ts` | 11 |
| `handlers/cancel-replace-pipeline.ts` | 01; `_appendix/test-coverage-matrix.md` |
| `handlers/dust-compounding.ts` | 07; `_appendix/test-coverage-matrix.md` |
| `handlers/index.ts` | 01 (barrel) |
| `handlers/oracle-sync-guard.ts` | 09; completion §1.3 U10 (thresholds quoted) |
| `handlers/orphan-cleaner.ts` | 09; completion §1.3 U15 |
| `handlers/protocol-validator.ts` | 09; `_appendix/test-coverage-matrix.md` |
| `strategy/sniper.ts` | 10; `tests/unit/sniper.test.ts` |
| `strategy-registry/registry.ts` | 10 |
| `strategy-registry/types.ts` | 10 |
| `strategy-registry/strategies/edge{1..6}*.ts` | 10 |
| `lib/utils.ts` | Utility helpers; no KB semantics beyond consumers |

## Scripts (`scripts/`)

All indexed in `_appendix/operator-runbooks.md` and `PHASE0_COMPLETION_REPORT.md` §1.4 Q11.

| File | Purpose (from header) |
|------|-----------------------|
| `scripts/audit-ledger.ts` | Historical ledger audit CLI (Phase 4/5). READ-ONLY by default; `--repair` uses `settlement-repair`. Accepts `--db`, `--mode`, `--limit`, `--json`, `--accounting`. |
| `scripts/derive-clob-credentials.mjs` | Derive CLOB API creds from `.env` (`WALLET_PRIVATE_KEY`, `FUNDER_ADDRESS`) via `@polymarket/clob-client-v2`. |
| `scripts/replay-trade.ts` | Forensic trade replay CLI. Explicitly "Read-only: never writes to the database." |
| `scripts/verify-all.mjs` | Full-system verification harness. Explicitly "READ-ONLY — never places orders." Exercises env, wallet, CLOB L1/L2, market discovery, orderbook, WebSocket, Chainlink, clock sync, SQLite. |
| `scripts/monitor-15m.sh` | 15-minute continuous monitor sampling `/api/v2/bot/status` every 10s; logs slot rollovers and anomalies. |
| `scripts/monitor-health.sh` | Extended health monitor sampling `/health` + watchdog/memory every 15s. |
| `scripts/soak-monitor.sh` | Phase 7 soak monitor: health, memory, watchdog repairs, market rollovers, event-loop responsiveness. |

## Tests (`tests/`)

All 28 test files mapped in `_appendix/test-coverage-matrix.md`.

## Deployment (`deploy/`)

| File | Purpose |
|---|---|
| `deploy/nginx-edge5.conf` | nginx site config for the dashboard reverse proxy (referenced implicitly by `dashboard-auth.ts`'s `x-forwarded-proto` handling). |

## Docs (`docs/`)

| File | Indexed in |
|---|---|
| `docs/production-certification.md` | `_appendix/operator-runbooks.md` |

## Rollup: files with no dedicated report coverage (post Phase 0.5)

- `postcss.config.mjs`, `components.json`, `tsconfig.json`, `lib/utils.ts` — framework/config with no engine semantics.
- `components/ui/button.tsx` — shadcn/ui primitive.
- All items above are enumerated here for completeness; none affects engine behavior.
