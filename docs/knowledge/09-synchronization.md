# 09 — Synchronization

## Reconciler (`lib/v2/engine/reconciler.ts`, 167 LOC)

**Read-only** periodic cross-check of exchange truth vs local engine belief.

- Cadence: `RECONCILE_MS = 60_000` (`reconciler.ts:29`).
- Startup pass: 10s after ignition (`reconciler.ts:69`).
- Drift tolerance: `DRIFT_TOLERANCE_USD = 1` (`reconciler.ts:30`).

### Drift categories

1. **UNTRACKED ORDER** — live on the account, neither the strategy engine nor SLO tracks it. Logged as **ERROR every cycle** until it disappears or is cancelled — this is the single most dangerous drift state (real money, unobserved).
2. **MISSING ORDER** — engine believes it is resting; exchange no longer lists it. Handled live by the SLO stuck-RESTING guard; reported here as a cross-check.
3. **WALLET DRIFT** — `|bankroll − on-chain USDC| > $1`. Informational; engine re-syncs at every rollover.

### Report shape (`reconciler.ts:32-45`)

```
{ atMs, ok, exchangeOpenOrders, trackedOrders,
  untrackedOrderIds[], missingOrderIds[],
  walletUsd, localBalanceUsd, walletDriftUsd, error }
```

Exposed via `engine.snapshot().reconciler` for the dashboard.

## Oracle sync guard (`handlers/oracle-sync-guard.ts`)

Blocks trading when the BTC oracle looks stale or divergent from the reference feed. Consulted by `tryExitRollover()` (`engine.ts:669`) — the engine will not re-arm the next slot until this clears.

## Wallet sync

`syncLiveBalance()` (`engine.ts:721`) pulls `executor.getAvailableBalanceUsd()`, compares to bankroll, and in PAPER mode re-seeds the sim wallet via the `setWalletUsd` authority seam (see Report 07). Never overwrites bankroll from a stale in-memory wallet.

## Account sync (`feeds/account-sync.ts`)

Mirrors on-exchange orders, trades, and balance into the snapshot's `LiveAccount` section for the dashboard `live-account.tsx` panel. Read-only pump.

## Rollover gating

`tryExitRollover()` (`engine.ts:669`) waits for **all** of:
- Next market discovered (`market-discovery.ts`).
- CLOB book depth adequate for the coming phase.
- Oracle sync guard clear.

Only then does `rolloverState` return to `"LIVE"` and the tick loop resume quoting.

## Protocol validator (`handlers/protocol-validator.ts`)

Sanity-checks discovered market/token metadata (condition id, token ids, resolution rules) before the engine will arm it — guards against a malformed discovery result poisoning the slot.

## Orphan cleaner (`handlers/orphan-cleaner.ts`)

Cancels untracked resting orders at safe boundaries (typically post-rollover). This is the ONE place that will act on untracked orders — the reconciler only reports.
