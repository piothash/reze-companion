# 07 — Accounting & PnL

## Sources of truth

- **Bankroll (per-mode)** — KV keys `bankroll:<mode>:balance`, `bankroll:<mode>:dust`, `bankroll:<mode>:starting` (`bankroll.ts:29-53`). Stored to 4 decimal places.
- **Trades ledger** — SQLite `trades` table (`db.ts:87-102`).
- **Sim wallet (paper only)** — in-memory; a **mirror**, never authoritative (`paper.ts:87` and the `setWalletUsd` seam at `paper.ts:194-199`).
- **On-chain USDC (live only)** — read via `getAvailableBalanceUsd()`; reconciler cross-checks drift.

## Compounding + dust math (`handlers/dust-compounding.ts`, invoked by `bankroll.ts:73`)

```
Shares = floor((balance + dustReserve) / price)
```

Constraints:
- `shares >= minShares` (default 5, Polymarket floor).
- On fill: `commitFill` zeros the balance and moves the fractional remainder into `dustReserve` (`bankroll.ts:80-83`) → rolls forward into the next slot's capital pool.

Standing Limit Order sizing bypasses this — it uses a fixed integer share count and a fixed-size cost debit.

## Fill accounting

- **Debit at fill:** `walletUsd -= cost` (paper: `paper.ts:167`; live: real on-chain debit).
- **Trade row:** appended with `status='OPEN'`, `cost`, `entry_at_ms`, per-mode.
- **Settlement:** `status → SETTLED`, `pnl`, `balance_after`, `dust_saved`, `explanation` written atomically.

## Authority seam (paper only)

`setWalletUsd(usd)` (`paper.ts:194-201`) exists so the engine can re-seed the sim wallet FROM the ledger-driven bankroll at boot and after every rollover sync. Before this seam existed, `syncLiveBalance` copied the stale in-memory wallet OVER the true bankroll — the historical root cause of "balances jumping by the payout instead of the PnL" (see comment `paper.ts:186-192`).

## Accounting verifier (`accounting-verifier.ts`, 199 LOC)

Ledger integrity checks: sum of `cost` debits + WIN payouts + SCRATCH refunds must reconcile with `balance_after` on the latest row per mode. Divergence is surfaced through `logEvent("error", ...)` and the audit log.

## Analytics (`analytics.ts`, 192 LOC)

Aggregations for dashboard: win rate, cumulative PnL, per-strategy stats, latency histograms.

## Audit log

`audit_log(id, ts_ms, level, category, message)` (`db.ts:127-133`) — every important event, queryable and persisted. Indexes on `ts_ms` and `(category, ts_ms)` for dashboard reads.

## Order log

`order_log` (`db.ts:104-119`) captures every SUBMITTED / ACK / CANCEL / FILL event. Composite index `(mode, event, ts_ms)` (`db.ts:122-125`) exists specifically for the risk manager's daily order-rate query.
