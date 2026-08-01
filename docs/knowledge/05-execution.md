# 05 — Execution

## Contract: `Executor` (`lib/v2/engine/execution/executor.ts:42`)

Hot-swappable interface — the strategy layer never knows if it is trading against a real exchange or a simulator.

Required methods:
- `placeOrder(req: PlaceOrderRequest): Promise<OpenOrder>`
- `cancelOrder(order): Promise<void>`
- `cancelReplace(order, req): Promise<{ order, latencyMs }>` — atomic, latency-tracked
- `checkFill(order): Promise<FillReport | null>`

Optional (live-only or paper-only):
- `getOrderState(order): Promise<OrderState>` — `LIVE|MATCHED|DEAD|UNKNOWN` (live+paper both implement)
- `cancelAllOrders(): Promise<void>` — bulk purge at rollover (live+paper)
- `getAvailableBalanceUsd(): Promise<number|null>` (live+paper)
- `getOpenOrdersLive()`, `getRecentTradesLive()`, `getFunderAddress()` — dashboard mirror
- `creditSettlement(usd)` — **paper-only**: mirror settlement into sim wallet
- `setWalletUsd(usd)` — **paper-only** authority seam (see Report 07)

## `PlaceOrderRequest` (`executor.ts:8`)

```
marketId, tokenId, side (UP|DOWN), price, shares, phase, tif ("1m"|"2m"|"GTC"), expireAtMs (null=GTC)
```

Contract note: even for GTC (no engine-side timer), TIF is passed through to the underlying exchange.

## LIVE_V2 (`lib/v2/engine/execution/live.ts`)

- Uses `@polymarket/clob-client-v2`.
- **EIP-712 order signing** — via `EthersV6SignerAdapter` (`live.ts:52`), because the SDK expects the ethers v5 `_signTypedData` shape; adapter bridges to ethers v6 `signTypedData`.
- **HMAC auth** — SDK handles L2 auth from `key/secret/passphrase` creds.
- **Post-only** — `POST_ONLY = true` (`live.ts:33`). Never crosses the spread.
- **Tick size** — `TICK_SIZE = "0.01"` (`live.ts:35`).
- **Numeric sanitation** — `price.toFixed(2)`, `Math.floor(shares)` before submission (`live.ts:103`).
- **TIF mapping** — `GTC → OrderType.GTC, expiration=0`; else `OrderType.GTD` with `expiration = now + 60|120s` (`live.ts:107`).
- **Boot preconditions** — throws if any of `POLY_PRIVATE_KEY`, `POLY_PROXY_ADDRESS`, `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE` missing (`live.ts:71-84`).

### Cancel-replace safety (`live.ts:154-190`)

If the initial `cancelOrder` throws, the code calls `getOrderState` and:
- `LIVE` or `UNKNOWN` → **abort** — refuses to place a duplicate.
- `DEAD` or `MATCHED` → safe to proceed; logs a warning.

### Partial-fill safety (`live.ts:210-240`)

Any reported partial fill is treated as terminal for the window:
1. Cancel the remainder immediately (or log ERROR if cancel fails).
2. Re-poll `getOrder` **after** cancel to capture any shares matched during the cancel race.
3. Report the authoritative post-cancel matched count.

### Fill-detection outage surfacing (`live.ts:253-263`)

`fillCheckFailures` counter; after 5 consecutive failures a throttled WARN is logged every 30s so a silent fill-detection outage is impossible.

## PAPER_V1 (`lib/v2/engine/execution/paper.ts`)

- Runs the **entire** V2 stack. Only the final submission is intercepted — no signer, no client, no credentials → real orders are structurally impossible.
- Fill decisions driven by the **live** Polymarket CLOB best-ask (`priceForSide`, `paper.ts:88`) — a resting BUY fills iff the live ask trades at/below its limit.
- Chaos profile (`paper.ts:32-60`): latency range, reject rate, timeout rate, partial rate, slow-ack rate, outage-until.
- Deterministic profile under vitest (`ZERO_CHAOS`, `paper.ts:50`).
- Exchange-style rejections mirror live: size < 1, price ∉ (0,1), notional > wallet, post-only cross.
- Same cancel-replace safety flow as live (`paper.ts:257-268`).
- Same partial-fill semantics: cancel remainder and report the partial exactly once (`paper.ts:293-303`).
- Trades buffer capped at 200 entries (`paper.ts:184`) — prevents unbounded heap growth during long paper runs.

## Both executors observe

- **Idempotent fill reporting** — `fillReported` on the resting order guarantees `checkFill` never double-books (`paper.ts:74-76`).
- **`getOrderState`** — the reconciler and stuck-RESTING guard depend on this to avoid duplicate orders.
