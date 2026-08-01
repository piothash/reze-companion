# 12 — Persistence

## Storage

Single SQLite file at `env.DB_PATH` (`db.ts:76`). WAL journal, `busy_timeout=5000`, `synchronous=NORMAL` (`db.ts:82-84`).

## Schema (`db.ts:87-134`)

### `trades`

```
id, market_id, slot_end_ms, side (UP|DOWN), price, shares, cost,
result (WIN|LOSS|SCRATCH), pnl, balance_after, dust_saved,
mode (PAPER|LIVE), created_at, settled_at
```

Additive columns (idempotent migration, `db.ts:141-155`):
`status (OPEN|SETTLED default SETTLED)`, `order_id`, `trade_uid`, `entry_at_ms`, `mark_price`, `unrealized_pnl`, `explanation` (JSON).

Indexes: `idx_trades_mode`, `idx_trades_status`, `idx_trades_mode_settled`.

### `kv`

`(key TEXT PRIMARY KEY, value TEXT NOT NULL)` — the ONLY runtime config/state store outside the ledger.

Key namespaces observed:
- `v2:engine:running` — resume flag
- `bankroll:<mode>:{balance,dust,starting}`
- `risk:limits`, `risk:killswitch`, `risk:migration:daily-order-cap-2000`

### `order_log`

Every SUBMITTED / ACK / CANCEL / FILL event:
`(id, ts_ms, mode, event, market_id, token_id, exchange_order_id, side, price, shares, phase, detail)` (`db.ts:104-119`).

Indexes: `idx_order_log_market`, `idx_order_log_ts`, and the composite `idx_order_log_mode_event_ts` created specifically for `RiskManager`'s daily-rate query (`db.ts:122-125`).

### `audit_log`

`(id, ts_ms, level, category, message)` (`db.ts:127-133`). Indexes on `ts_ms` and `(category, ts_ms)`.

## Write queue (`db.ts:16-60`)

All writes go through `queueWrite(op)`. `processWriteQueue` drains sequentially on `setImmediate`, so writes NEVER block the tick loop. `flushWriteQueueSync()` (`db.ts:47-58`) is provided **for tests only** to synchronously flush before assertions.

## Boot-time actions

1. Idempotent `CREATE TABLE IF NOT EXISTS` and column-add migrations.
2. `scratchOrphanedOpenRows(db)` (`db.ts:174-206`) — closes any pre-crash `OPEN` positions as SCRATCH **with bankroll refund**, avoiding phantom losses on restart.
3. One-time historical fix clearing `unrealized_pnl` on old SETTLED rows.

## Internal seam

`getDbHandle()` (`db.ts:63-68`) is a narrow escape hatch for sibling modules (strategy profiles, comparison) that manage additive tables — application code and API routes must keep using the typed helpers.
