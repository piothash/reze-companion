# 01 — Architecture

## Process model

Single Node.js process managed by PM2 (`reference/p4/ecosystem.config.js`). PM2 config specifies exponential-backoff restarts, memory ceiling, and SIGINT-based graceful shutdown. The Next.js server hosts both the dashboard **and** the engine — the engine is instantiated as a Node-side singleton on the server instrumentation hook (`instrumentation.ts` / `instrumentation-node.ts`).

## Boot sequence

1. Next.js starts and invokes `instrumentation.ts` → `instrumentation-node.ts`.
2. `installProcessGuards()` is called (`engine.ts:1526,1539`) — installs `uncaughtException` and `unhandledRejection` handlers via the Telegram console.
3. A single `Engine` instance is stored on `globalThis.__botEngineV2` keyed by `ENGINE_VERSION` (`engine.ts:1540`) so hot-reloads do not double-instantiate.
4. `maybeAutoResume()` reads the KV key `v2:engine:running` — if `true`, the engine calls `start()` again to resume through a crash (`engine.ts:247`).
5. Config is restored from KV in `restoreConfig()` (`engine.ts:260`).
6. SQLite is opened lazily on first `getDb()` call, applies PRAGMAs, runs idempotent migrations, and — critically — SCRATCHes any `OPEN` trade rows from before the crash, refunding cost to the bankroll (`db.ts:157-166`, `scratchOrphanedOpenRows`).

## Module map (`lib/v2/engine/`)

| Module | Responsibility |
|--------|----------------|
| `engine.ts` (1551 LOC) | Master state machine, tick loop, phase transitions, rollover, snapshot |
| `standing-order.ts` (2489 LOC) | Independent SLO manager (`ARMED`→`TRIGGERED`→`RESTING`→`FILLED`) |
| `execution/executor.ts` | Common `Executor` interface for LIVE and PAPER |
| `execution/live.ts` | Polymarket CLOB V2 SDK adapter, EIP-712 signer, post-only orders |
| `execution/paper.ts` | Simulated exchange with chaos profile (latency, rejects, partials, outages) |
| `feeds/btc-reference-feed.ts` | Live BTC spot source used for fair-price computation |
| `feeds/clob-price-feed.ts` | Polymarket book best-ask stream per side |
| `feeds/clob-ws-client.ts` | Websocket transport for CLOB updates |
| `feeds/market-discovery.ts` | Discovers the current 5-minute BTC market and its two tokens |
| `feeds/account-sync.ts` | Periodic account/order/trade mirror for the dashboard |
| `feeds/order-events.ts` | Order-event bus |
| `bankroll.ts` | Compounding-size + dust reserve KV state |
| `handlers/dust-compounding.ts` | `Shares = floor((balance + dust) / price)` and dust math |
| `handlers/oracle-sync-guard.ts` | Blocks trading when BTC oracle looks stale/divergent |
| `handlers/orphan-cleaner.ts` | Cancels untracked resting orders at safe boundaries |
| `handlers/protocol-validator.ts` | Sanity-checks market/token metadata before use |
| `handlers/cancel-replace-pipeline.ts` | Wraps executor cancel-replace with retries + verification |
| `reconciler.ts` | Every 60s: compares tracked vs on-exchange orders and wallet |
| `risk.ts` | Kill switch + daily loss/order/notional/share caps |
| `strategy-registry/` | Registry + Edge 1..6 strategies |
| `strategy/sniper.ts` | Older direct sniper strategy (kept alongside registry) |
| `strategy-profiles.ts` | Named parameter presets |
| `settlement-verifier.ts` | Cross-checks realized settlement against official market resolution |
| `settlement-repair.ts` | Retroactively corrects mis-settled rows |
| `accounting-verifier.ts` | Ledger integrity: cost debits, WIN payouts, SCRATCH refunds sum |
| `db.ts` (769 LOC) | SQLite handle, schema/migrations, KV, order log, audit log, write queue |
| `analytics.ts` | Aggregations for dashboard |
| `report.ts` | Human-readable trade explanations |
| `notifier.ts`, `telegram.ts`, `telegram-console.ts` | Alerts + operator console |
| `system-monitor.ts` | CPU/mem/heap sampling |
| `watchdog.ts` | Liveness checks on tick loop and feeds |
| `preflight.ts` | Startup checks before allowing LIVE mode |
| `clock.ts` | Slot end calculation (aligned to 5-minute UTC boundaries) |
| `market-model.ts` | Fair price / EV helpers |
| `latency-trace.ts` | Round-trip latency measurement + histograms |
| `comparison.ts` | Paper-vs-live comparison harness storage |
| `http-agent.ts` | Keep-alive HTTP agent for CLOB REST |
| `dashboard-auth.ts`, `api-auth.ts` | Session/CSRF for the dashboard and API |
| `types.ts` (625 LOC) | All shared types (see Report 03) |
| `events.ts` | `logEvent(level, msg)` — the ONLY logging entry point |

## Data flow

```
BTC ref feed ─┐
              ├─► Engine.tick() ── strategy.decide() ── Executor.placeOrder/cancelReplace ── CLOB (live) / SimBook (paper)
CLOB feed ────┘        │                                          │
                       ▼                                          ▼
                   Bankroll                                  order_log / audit_log
                       │                                          │
                       └────► settleSlot() ── ledger.trade ── Bankroll credit ── Reconciler cross-check
```

## Deployment

- `ecosystem.config.js` — PM2 app spec (auto-restart with backoff, memory ceiling, graceful SIGINT).
- `proxy.ts` (root) — Next.js middleware: enforces dashboard session cookie + CSRF token on state-changing routes.
- Environment: everything read once via `env` in `lib/v2/engine/config.ts` at process start.

## Read-only invariant

All references to the `Engine` are through the global singleton; no test or dashboard route constructs a second instance. The dashboard uses the engine via `snapshot()` (`engine.ts:1388`) and typed control methods (`start`, `stop`, `setMode`, `setStrategy`, ...) which are the ONLY mutation surface.
