# P4 Trading Bot — Engineering Knowledge Base (Phase 0)

**Status:** Phase 0 (Learning). READ-ONLY. No code changes made to `reference/p4/`.
**Source:** `github.com/supreme1xxz/p4` @ `b3d72ea`, imported to `reference/p4/`.
**Scope:** Deep engineering understanding of the entire P4 stack — architecture, dashboard, trading engine, standing limit order, execution, settlement, accounting, risk, synchronization, testing, and production readiness.

## How to Read This KB

- Every claim is backed by `path:line` evidence pointing into `reference/p4/`.
- No fixes, no refactors, no recommendations to change the source. Recommendations live only in the Production Readiness assessment (Report 15) and are labeled as *observations*, not TODOs.
- Reports are numbered so downstream implementation phases can reference sections by ID.

## Reports

| # | Report | Purpose |
|---|--------|---------|
| 00 | [System Overview](./00-system-overview.md) | 30-second summary of what the bot does and why |
| 01 | [Architecture](./01-architecture.md) | Process model, module map, boot sequence, data flow |
| 02 | [Dashboard](./02-dashboard.md) | Next.js dashboard, auth, API surface, panels |
| 03 | [Trading Engine](./03-trading-engine.md) | The `Engine` class, tick loop, phases, state machine |
| 04 | [Standing Limit Order](./04-standing-limit-order.md) | The SLO subsystem, trigger→resting→fill lifecycle |
| 05 | [Execution](./05-execution.md) | `Executor` contract, `LiveExecutor`, `PaperExecutor` |
| 06 | [Settlement](./06-settlement.md) | Slot end, official winner resolution, PnL booking |
| 07 | [Accounting & PnL](./07-accounting-and-pnl.md) | Bankroll, dust compounding, ledger, verifier |
| 08 | [Risk](./08-risk.md) | Kill switch, daily loss cap, order/notional caps |
| 09 | [Synchronization](./09-synchronization.md) | AccountSync, Reconciler, oracle sync guard |
| 11 | [Feeds & Market Data](./11-feeds.md) | BTC reference feed, CLOB price/WS, market discovery |
| 12 | [Persistence](./12-persistence.md) | SQLite schema, migrations, KV store, write queue |
| 13 | [Recovery & Watchdogs](./13-recovery.md) | Instrumentation, process guards, watchdog, orphan cleaner |
| 14 | [Testing Report](./14-testing.md) | What is tested, coverage gaps, chaos harness |
| 15 | [Production Readiness](./15-production-readiness.md) | Risks, gaps, evidence-backed observations |

## Conventions

- **Evidence tag:** `[file:line]` or `[file:startLine-endLine]` — all paths are relative to `reference/p4/`.
- **Terminology:**
  - *Slot* = one 5-minute Polymarket BTC price market window.
  - *Phase* = engine sub-state within a slot (`OFFLINE`, `WAITING`, `PRIORITY_1`, `PRIORITY_2`, `STOPPING`).
  - *Side* = `UP` | `DOWN` (`lib/v2/engine/types.ts:26`).
  - *Mode* = `PAPER` | `LIVE` pipeline selection.
