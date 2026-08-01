# 13 — Recovery & Watchdogs

## Process supervisor

PM2 (`ecosystem.config.js`): exponential-backoff restarts, memory ceiling, SIGINT for graceful shutdown.

## Instrumentation

- `instrumentation.ts` — Next.js hook that runs on server boot.
- `instrumentation-node.ts` — installs `uncaughtException` and `unhandledRejection` handlers routed through the Telegram console (`telegram-console.ts`).

## Process guards

`installProcessGuards()` (`engine.ts:1526,1539`) is idempotent (guarded by `globalRef.__botProcessGuards`) — prevents duplicate handler installation on Next hot reload.

## Global singleton

Engine kept on `globalThis.__botEngineV2` keyed by `ENGINE_VERSION` (`engine.ts:1540`) so hot reload does not create a second engine.

## Auto-resume

`maybeAutoResume()` (`engine.ts:247`) reads KV `v2:engine:running` at boot. If `true`, `start()` is called automatically. Combined with the boot-time SCRATCH sweep in `db.ts:scratchOrphanedOpenRows`, this makes crash recovery deterministic: any in-flight position is refunded to SCRATCH and the engine resumes.

## Config restore

`restoreConfig()` (`engine.ts:260`) rehydrates persisted operator settings (mode, bands, drift padding, TIF, price range, active strategy, SLO configuration, risk limits, kill switch) from KV.

## Watchdog (`watchdog.ts`, 211 LOC)

Liveness checks on the tick loop and feeds. Detects:
- Tick loop stuck (`lastTickStartMs` not advancing, `engine.ts:119`)
- Feeds stale beyond threshold
- Executor hung

Failure paths escalate through `notifier.ts` (Telegram alert) and, for severe conditions, trigger the kill switch.

## System monitor (`system-monitor.ts`, 115 LOC)

CPU, memory, heap sampling. Surfaced to `system-panel.tsx`.

## Preflight (`preflight.ts`, 179 LOC)

Startup checks required before allowing LIVE mode: env vars present, CLOB reachable, wallet address consistent, database writable, KV integrity, etc.

## Orphan cleaner (`handlers/orphan-cleaner.ts`)

Cancels resting orders at safe boundaries (post-rollover, post-restart) that neither the strategy engine nor the SLO claims. This is the enforcement counterpart to the reconciler (which only observes).

## DB maintenance timers

`dbMaintenanceTimer` and `dbKickoffTimer` on the engine (`engine.ts:231-232`). `runDbMaintenanceSafe()` (`engine.ts:234`) performs periodic housekeeping (WAL checkpoints, index maintenance) without blocking the tick loop.
