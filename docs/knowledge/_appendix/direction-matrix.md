# Direction Matrix — Phase 0.5

Complete end-to-end propagation of trade direction through the P4 stack. Every hop is quoted from `reference/p4/` source.

## Representations reference

| Term | Present in P4 source? | Where |
|---|---|---|
| `UP` / `DOWN` | ✅ | `types.ts` `TradeSide = "UP" \| "DOWN"` |
| `Up` / `Down` (Gamma outcome labels) | ✅ | `feeds/market-discovery.ts:132, 139-140` |
| `upTokenId` / `downTokenId` | ✅ | `types.ts:26-27, 464-465, 526-527`; `feeds/market-discovery.ts:141-142` |
| `Side.BUY` (CLOB API) | ✅ | `execution/live.ts:128` — always BUY; direction encoded via `tokenId` |
| `YES` / `NO` | ❌ | Not present. Polymarket labels 5m BTC tokens `Up`/`Down`, not `Yes`/`No`. |
| `Bull` / `Bear` | ❌ | Not present. |
| `Signal` | ✅ (conceptual) | Return value of a strategy's per-tick evaluate |
| `Trigger` | ✅ (conceptual) | SLO arming/triggering inside `StandingOrderManager` (`standing-order.ts`) |
| `Position` | ✅ | `engine.ts:113` — `position` field |
| `outcome` (display string) | ✅ | `execution/live.ts:317, 336` — mirrored back onto `LiveAccountOrder` / `LiveAccountTrade` |
| `winner` (settlement) | ✅ | `engine.ts:1326` |

## Paper V1 end-to-end trace

```
[Strategy or SLO evaluate]
    → returns TradeSide ("UP" | "DOWN") or null
    → Signal captured in engine tick loop

[engine.orderIds(side)]                          (engine.ts:820-823)
    → returns { marketId: m.slug,
                tokenId: side === "UP" ? m.upTokenId : m.downTokenId }
    → upTokenId / downTokenId sourced from market discovery (below)

[PaperExecutor.placeOrder({ tokenId, price, size })]
    → simulated fill / partial / reject
    → FillReport with the same tokenId
    → bankroll.debitCost(cost)

[db.insertTrade]                                 (db.ts trades schema)
    → row: mode='PAPER_V1', side='UP'|'DOWN', tokenId, price, shares, cost, status='OPEN'

[Slot end — winner computation]                  (engine.ts:1326)
    → winner: "UP" | "DOWN" | null (SCRATCH)
    → winningTokenId = winner === "UP" ? m.upTokenId : m.downTokenId
    → WIN if side === winner, LOSS if opposite, SCRATCH if null

[Settlement]
    → WIN payout  = shares × 1.00
    → LOSS payout = 0     (pnl = -cost)
    → SCRATCH     = cost refunded (pnl = 0)
    → bankroll.credit / refund
    → db update: result, pnl, balance_after, settled_at

[Dashboard]
    → analytics.ts reads trades table
    → UI shows side, price, shares, cost, result, pnl
```

## Live V2 end-to-end trace

Identical to Paper V1 through `engine.orderIds(side)`. Divergence at the executor:

```
[LiveExecutor.placeOrder]                        (execution/live.ts:128)
    → { tokenID: req.tokenId, price, side: Side.BUY, size, expiration }
    → EIP-712 signed via EthersV6SignerAdapter    (live.ts:52)
    → POST_ONLY = true                            (live.ts:43)
    → TICK_SIZE = "0.01"                          (live.ts:45)
    → HMAC L2 auth via CLOB_API_KEY/SECRET/PASSPHRASE
    → SignatureType default 1 = POLY_PROXY        (config.ts:27-31)

[CLOB acknowledgement]
    → exchangeOrderId returned
    → engine belief updated

[Fills arrive via feeds/order-events.ts WS]
    → per-fill wallet mirror update
    → bankroll debit / credit per FillReport

[settlement-verifier.ts sweep]                   (settlement-verifier.ts:1-32, 43)
    → every 60s, re-checks each booked trade against
      fetchOfficialResolution() (feeds/market-discovery.ts)
    → on mismatch backed by official evidence,
      calls repairTrade() (settlement-repair.ts)
    → atomic + idempotent: kv marker prevents double-credit

[Dashboard mirror]                               (live.ts:317, 336)
    → LiveAccountOrder.outcome, LiveAccountTrade.outcome
      populated from SDK reply
```

## Direction identity checks

- `direction-verdict.test.ts` (unit) exercises the label→side mapping.
- `settlement-integrity.test.ts` (integration) exercises WIN/LOSS/SCRATCH direction paths through the settlement path.
- `standing-order.test.ts` (integration) exercises SLO-side direction handling.

## What is NOT direction-encoded

- The CLOB order `Side.BUY` is a constant at the exchange layer (`live.ts:128`). Direction is entirely carried by the `tokenID` chosen from `upTokenId` vs `downTokenId`.
- The engine never sends `Side.SELL` for direction; a "sell" on Polymarket would require a separate `Side.SELL` submission which P4 does not do.

## Where `YES`/`NO` would enter if it did

Not applicable — Polymarket's outcome labels for the 5m BTC series are `Up`/`Down`. If a different series (e.g. sports) were added, the `outcomes` JSON in Gamma would carry `Yes`/`No` and the label-match at `feeds/market-discovery.ts:139-140` would need extending. Currently, extending to `Yes`/`No` is unimplemented in P4.
