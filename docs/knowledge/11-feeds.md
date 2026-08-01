# 11 — Feeds & Market Data

## BTC reference feed (`feeds/btc-reference-feed.ts`)

Built via `makeBtcReferenceFeed()` and held on `engine.spotFeed` (`engine.ts:81`). Provides the authoritative spot BTC price used to compute:
- `fairFor(side)` (`engine.ts:846`)
- `computeSpotFallback()` (`engine.ts:1263`) for settlement when oracle is unavailable

**Staleness guard:** `freshSpot()` (`engine.ts:839`) returns null if the last sample is older than `SPOT_STALE_MS = 10_000` (`engine.ts:837`). No trading occurs on stale spot.

## CLOB price feed (`feeds/clob-price-feed.ts`)

`ClobPriceFeed` provides best-ask per side (`UP`, `DOWN`). Used by:
- Strategy repricing decisions
- PAPER_V1 fill simulation (`paper.ts:88`) — the sim book fills a resting BUY iff the live ask crosses the limit
- SLO trigger evaluation

## CLOB WebSocket client (`feeds/clob-ws-client.ts`)

Websocket transport underlying `ClobPriceFeed`. Handles reconnects; feed diagnostics panel reports connection state.

## Market discovery (`feeds/market-discovery.ts`)

`MarketDiscovery` (`engine.ts:83`) rolls forward through Polymarket's 5-minute BTC markets. Produces a `DiscoveredMarket` including condition id, both token ids, strike, and slot end time. Consumed by:
- `armMarket(slotEndMs)` (`engine.ts:788`) — sets `market`, `strike`, `slotEndMs`.
- `tryExitRollover()` (`engine.ts:669`) — waits for the next market before re-arming.
- `activeConditionIds()` (`engine.ts:775`) — set of currently-relevant conditions (helps the reconciler classify orders).

## Account sync (`feeds/account-sync.ts`)

Periodic pull of authenticated account state: open orders, recent trades, wallet balance. Populates the dashboard's `live-account.tsx` and feeds the reconciler.

## Order events (`feeds/order-events.ts`)

Order-event bus used by the executor path and by `standing-order.ts` to react to placements/cancels/fills without polling.

## Clock (`clock.ts`)

Slot end computation aligned to 5-minute UTC boundaries. Used to derive `slotEndMs` and phase transitions.
