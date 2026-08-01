# Test Coverage Matrix — Phase 0.5

Every test file in `reference/p4/tests/` mapped to the production module(s) it exercises. Every production module either has a test entry below or is listed in "Production modules with no dedicated test file".

## Test framework

- Vitest (`vitest.config.ts:1-28`)
  - `environment: "node"` (`:11`)
  - `include: ["tests/**/*.test.ts"]` (`:12`)
  - `pool: "forks"` (`:14`) — one worker per file
  - `setupFiles: ["tests/setup-db.ts"]` (`:17`) — per-worker DB isolation via `data/test-ledger-<pool>.db`
  - Env defaults: `DB_PATH: "data/test-ledger.db"`, `ENVIRONMENT: "PAPER_V1"` (`:22-25`)

## Unit tests (13)

| Test | Production module(s) |
|---|---|
| `tests/unit/auth.test.ts` | `dashboard-auth.ts`, `api-auth.ts` |
| `tests/unit/direction-verdict.test.ts` | Direction/verdict path — winner computation and `TradeSide` handling |
| `tests/unit/feed-chaos.test.ts` | `feeds/*` — chaos/latency injection on price feeds |
| `tests/unit/feed-integrity.test.ts` | `feeds/*` — freshness, staleness, contract invariants |
| `tests/unit/handlers.test.ts` | `handlers/oracle-sync-guard.ts`, `handlers/orphan-cleaner.ts`, `handlers/protocol-validator.ts`, `handlers/cancel-replace-pipeline.ts`, `handlers/dust-compounding.ts` |
| `tests/unit/model-clock.test.ts` | `clock.ts` (slot-boundary model) |
| `tests/unit/paper-executor.test.ts` | `execution/paper.ts` |
| `tests/unit/reconciler.test.ts` | `reconciler.ts` |
| `tests/unit/risk.test.ts` | `risk.ts` |
| `tests/unit/sniper.test.ts` | `strategy/sniper.ts` (legacy strategy, retained) |
| `tests/unit/watchdog.test.ts` | `watchdog.ts` |

## Integration tests (13)

| Test | Production module(s) |
|---|---|
| `tests/integration/accounting-integrity.test.ts` | `accounting-verifier.ts`, `bankroll.ts`, `db.ts` |
| `tests/integration/db-chaos.test.ts` | `db.ts` — write-queue + migrations under chaos |
| `tests/integration/execution-hardening.test.ts` | `execution/live.ts`, `execution/paper.ts` — cancel/replace, partial fill, duplicate-order safety |
| `tests/integration/execution-latency.test.ts` | Execution path latency budget (`cancelReplaceBudgetMs = 100`) |
| `tests/integration/ledger-accounting.test.ts` | `db.ts`, `bankroll.ts`, ledger identities |
| `tests/integration/ops-chaos.test.ts` | End-to-end ops chaos (rollovers, feed drops, WS reconnect) |
| `tests/integration/profiles-and-console.test.ts` | `strategy-profiles.ts`, `telegram-console.ts` |
| `tests/integration/settlement-integrity.test.ts` | `settlement-verifier.ts`, `settlement-repair.ts`, direction settlement |
| `tests/integration/settlement.test.ts` | Settlement happy paths — WIN/LOSS/SCRATCH bookings |
| `tests/integration/sizing-and-window.test.ts` | Sizing math (`handlers/dust-compounding.ts`, `handlers/protocol-validator.ts`) + P1/P2 window semantics |
| `tests/integration/soak-certification.test.ts` | Long-run certification harness (Phase 6) |
| `tests/integration/soak.test.ts` | Soak (memory/leak/latency) |
| `tests/integration/standing-order.test.ts` | `standing-order.ts` (SLO end-to-end) |

## Helpers + setup (2)

| File | Purpose |
|---|---|
| `tests/helpers/fake-clob-feed.ts` | Test double for CLOB price feed — used by direction / settlement / execution tests |
| `tests/setup-db.ts` | Per-worker DB isolation (`vitest.config.ts:17`) |

## Production modules with no dedicated test file

Explicitly enumerated so every production module is accounted for:

- `bankroll.ts` — covered indirectly by `ledger-accounting.test.ts`, `accounting-integrity.test.ts`.
- `analytics.ts` — no dedicated test (dashboard presentation layer).
- `comparison.ts` — indirectly via `profiles-and-console.test.ts`.
- `strategy-profiles.ts` — indirectly via `profiles-and-console.test.ts`.
- `notifier.ts`, `telegram.ts`, `telegram-console.ts` — no dedicated tests.
- `market-model.ts` — no dedicated test.
- `latency-trace.ts` — no dedicated test.
- `http-agent.ts` — no dedicated test.
- `preflight.ts` — no dedicated test.
- `report.ts` — no dedicated test.
- `system-monitor.ts` — no dedicated test.
- `trade-replay.ts` — no dedicated test (consumed only by `scripts/replay-trade.ts`).
- `events.ts` — no dedicated test; consumed by many modules under test.
- `lib/v2/engine/proxy.ts` — no dedicated test.
- `strategy-registry/registry.ts` and `strategy-registry/strategies/edge{1..6}*.ts` — no per-strategy tests. Selection/verdict behavior may be exercised through `direction-verdict.test.ts` and `sniper.test.ts`; per-strategy branches are not enumerated.
- Every route in `app/api/*` — **no route-level tests**.
- Every component in `components/v2/*` — **no component tests** (Vitest include is `tests/**/*.test.ts` only, `vitest.config.ts:12`).

## Coverage summary

- **Production module coverage:** every module has an entry (either mapped to a test or explicitly listed as no dedicated test).
- **Route-level coverage:** 0 dedicated tests for `app/api/*` routes.
- **UI component coverage:** 0 dedicated tests.
- **CLI script coverage:** `scripts/*` executables have no dedicated tests; they consume modules that are individually tested.
