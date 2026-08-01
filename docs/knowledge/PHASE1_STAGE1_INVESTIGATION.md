# Phase 1 — Stage 1 Investigation: Trade Direction & PnL

**Status:** ROOT-CAUSE INVESTIGATION ONLY. No production logic modified.
**Scope:** Full direction lifecycle + full PnL lifecycle in `reference/p4/`.
**Verdict:** No deterministic direction-inversion or PnL-inversion root cause reproducible from source alone. Two real (non-direction) defects and three PnL-adjacent divergences documented. Runtime instrumentation plan attached — awaiting your approval before I add it.

All citations are `reference/p4/<path>:<line>`.

---

## 1. Direction lifecycle — audited hop-by-hop

Every hop was re-read against source (not just the Phase 0 matrix). The `side` semantic (`TradeSide = "UP" | "DOWN"`) is defined at `lib/v2/engine/types.ts:22`.

| # | Stage | File:line | Direction handling | Verdict |
|---|---|---|---|---|
| 1 | Market discovery / token map | `lib/v2/engine/feeds/market-discovery.ts:139-142` | `upTokenId`/`downTokenId` selected **by outcome label** (`"up"`/`"down"`), never positional | ✅ safe |
| 2 | Official resolution reader | `feeds/market-discovery.ts:108-124` | Winner read by label from `outcomePrices`, only when `closed`/UMA-resolved | ✅ safe |
| 3 | Registry strategy signal | strategies return `TradeSide` | strategy → `engine.orderIds(side)` | ✅ passthrough |
| 4 | SLO trigger evaluation | `standing-order.ts:1280-1310` | Locked side = whichever leg's live best-ask first reaches trigger; both-qualify → higher ask wins | ✅ matches spec (momentum race) |
| 5 | Engine `orderIds(side)` | `engine.ts:820-823` | `tokenId = side==="UP" ? m.upTokenId : m.downTokenId` | ✅ safe |
| 6 | Executor request (LIVE) | `execution/live.ts:127-132` | `Side.BUY` always; direction encoded via `tokenID` | ✅ safe (BUY is CLOB semantic, not direction) |
| 7 | Executor request (PAPER) | `execution/paper.ts` | `PlaceOrderRequest.tokenId` preserved into simulated book | ✅ passthrough |
| 8 | Fill handling | `execution/live.ts:192-250`; `engine.ts:1153-1187`; `standing-order.ts:1886-2018` | `order.side` (`UP`/`DOWN`) preserved onto position and ledger row | ✅ safe |
| 9 | DB persistence — `openTrade` | `db.ts:272-309` | `side` column stores `TradeSide` verbatim | ✅ safe |
| 10 | DB persistence — `insertTrade` | `db.ts:241-264` | Same | ✅ safe |
| 11 | Settlement — engine path | `engine.ts:1272-1322` | `won = pos.side === winner`; payout math matches side | ✅ safe |
| 12 | Settlement — SLO path | `standing-order.ts:2250-2410` | Same identity; per-uid idempotency (`settledUids`) | ✅ safe |
| 13 | Post-settlement verifier | `settlement-verifier.ts:1-32, 43-` | Re-checks each SETTLED row against official label; drives `repairTrade` on mismatch | ✅ safe |
| 14 | Settlement repair | `settlement-repair.ts:14-24 (computeExpected)` | `won = trade.side === officialWinner`; delta = `expected.payout − bookedPayout` | ✅ safe |
| 15 | Restart recovery | `db.ts:384-392` → `scratchOrphanedOpenRows` | Orphaned OPEN rows closed as SCRATCH (cost refunded); side is never rewritten | ✅ safe |
| 16 | Replay / verdict | `trade-replay.ts` + `tests/unit/direction-verdict.test.ts` | Uses stored `feedAudit` snapshot to classify CORRECT / WRONG_SIDE / UNPROVABLE | ✅ safe |
| 17 | SLO dashboard render | `components/v2/limit-order-panel.tsx:174-199, 294-295` | Reads `sl.openPosition.side` (`UP`/`DOWN`) | ✅ safe |
| 18 | LIVE account mirror render | `components/v2/live-account.tsx:186, 225` | Reads `o.side` / `t.side` from `LiveAccountOrder` / `LiveAccountTrade` — **see finding D-2 below** | ⚠️ display divergence |

**Bottom line for direction:** the write path (signal → tokenId → executor → position → ledger → settlement) is internally consistent. Zero inversion found in source. If real-world trades landed wrong-side, the divergence is almost certainly at the boundary — outside the codepaths above — or is a display/read-side rendering issue, not an execution issue.

---

## 2. Findings (direction-adjacent)

### D-1 Dead orphan-hedger branch (misleading comment, but not an inversion)

- **Location:** `engine.ts:1198-1204`, handler at `handlers/orphan-cleaner.ts:26-46`.
- **What the comment claims:** "flatten it with an immediate market-priced FOK counter before the candle resolves".
- **What actually runs:** `buildOrphanCounter(...)` is called and only `counter.reason` is logged; the constructed FOK order is **never sent** to the executor. Only `cancelOrder(order)` executes.
- **Additionally the guard can never fire:** `detectOrphan(leg1, leg2)` at `handlers/orphan-cleaner.ts:27-29` requires `leg2 ∈ {REJECTED, NONE}`, but the call site passes the literal `"PENDING"` — so `detectOrphan("FILLED", "PENDING") === false` unconditionally. The whole branch is unreachable.
- **Direction impact:** none. In the current single-leg registry-strategy design (`openOrder` is scalar) cancel-only is the correct action; the dead branch is only dead. Impact is documentation drift + confusion during forensic reviews.
- **Recommended action (Stage 4, not Stage 1):** either wire the FOK counter into the executor (real multi-leg protection) or remove the branch and its imports. Do not touch during Stage 1.

### D-2 Live account mirror `side` field carries CLOB `"BUY"/"SELL"` — not `UP`/`DOWN`

- **Location:** `execution/live.ts:308-345` (`getOpenOrdersLive`, `getRecentTradesLive`).
- **Behavior:** `side: String(o.side ?? "")` — the CLOB order-book side is `"BUY"` for every engine order (engine only ever posts `Side.BUY`). The `outcome` label (`"Up"`/`"Down"`) is exposed on the same object.
- **Consumer:** `components/v2/live-account.tsx:186, 225` renders `{o.side}` / `{t.side}` in the LIVE account orders and trades tables.
- **User-visible result:** in LIVE mode, the account mirror table shows every row as `BUY`, while the engine's own ledger table (SLO + strategy trades panel) shows the same trade as `UP` or `DOWN`. A reasonable operator glancing at those two tables side-by-side could easily read this as "the engine says UP but the exchange executed BUY" and conclude the direction is wrong — when in fact `BUY` is the CLOB action verb and the direction is carried by `assetId`/`outcome` on the same row.
- **This is a display divergence, not an execution divergence.** The engine's `trades.side` DB column is written from `order.side` (`UP`/`DOWN`) at `standing-order.ts:1937` and `engine.ts:1298`, and the settlement/verifier chain reads that same column. The CLOB `"BUY"` field is never used for any correctness decision.
- **If your "wrong direction" report is really "LIVE dashboard shows BUY on every row" — this is the root cause.** Please confirm before I touch it.

### D-3 (Unverified, plausible) SLO both-sides-below-trigger displays a "leading side" while status is not yet locked

- **Location:** `standing-order.ts:1305-1310`. When neither side has qualified, `side = upPrice >= downPrice ? "UP" : "DOWN"` is chosen "for display/messaging". This value only paints the majority indicator; `lockedDirection` is not set unless `upQualifies || downQualifies` at `1295`. So no trade fires from this branch. **Not a bug**, but the audit trail should call this out because someone reading Telegram logs mid-slot may see "majority DOWN" then a trade fire UP once UP crosses first.

---

## 3. PnL lifecycle — audited hop-by-hop

Registry-strategy path uses `Bankroll.commitFill` (all-in compounding). SLO path uses `Bankroll.debitFixed` (fixed-size). Both settle via `Bankroll.settle(payout)`.

| # | Stage | File:line | Formula | Verdict |
|---|---|---|---|---|
| 1 | Sizing (SLO) | `standing-order.ts:804-847` | `FIXED_SHARES / FIXED_USD / PERCENT`, capped by `risk.maxSharesPerOrder`, exposed via `lastSizing` | ✅ audited (Phase 5 sizing-transparency block) |
| 2 | Sizing (registry) | `bankroll.ts:64-69` → `handlers/dust-compounding` | Floor((balance+dust)/price); ≥ minShares | ✅ safe |
| 3 | Fill cost — SLO | `standing-order.ts:1887-1889` | `cost = order.shares × filledPrice`; `debitFixed(cost)` pulls from balance then dust | ✅ safe |
| 4 | Fill cost — registry | `engine.ts:1155-1170` | `cost = order.shares × filledPrice`; `pool = bal+dust`; `dust' = max(pool-cost, 0)`; `commitFill` zeros balance, sets dust | ⚠️ see P-1 |
| 5 | Open row insert (SLO) | `db.ts:272-309` | `balance_after` = post-debit pool; `mark_price = price`; `unrealized_pnl = 0` | ✅ safe |
| 6 | Live-mark refresh (SLO) | `standing-order.ts:2026-2034` → `db.ts:312-320` | `unrealized = shares × mark − cost`; skipped when no fresh mark | ✅ safe |
| 7 | Fees | none observed | Polymarket CLOB is fee-less at V2; no fee subtraction anywhere | ✅ expected |
| 8 | Settlement payout (both paths) | `engine.ts:1278-1281`, `standing-order.ts:2266-2267` | WIN → `shares × $1`; LOSS → `0`; SCRATCH → `cost` refund | ✅ safe |
| 9 | Realized PnL (both paths) | same lines | `pnl = payout − cost` (SCRATCH → 0) | ✅ safe |
| 10 | Bankroll credit (both paths) | `bankroll.ts:96-98` | `balance += payout` (4dp rounded) | ✅ safe |
| 11 | Accounting invariant | `standing-order.ts:2331-2354` | Asserts `closing = opening + payout` within $0.01; logs CRITICAL + `order_log ERROR` row on drift | ✅ excellent — engine path has NO equivalent (see P-2) |
| 12 | Ledger settle row (SLO) | `standing-order.ts:2295-2310` → `db.ts:341-376` | `settleTrade` updates OPEN→SETTLED atomically (`AND status='OPEN'`); then `updateSettledBalance` stamps post-credit balance | ✅ safe (idempotent) |
| 13 | Ledger settle row (engine) | `engine.ts:1295-1322` | `insertTrade` writes a fresh SETTLED row; **the engine path never opens an OPEN row on fill** — see P-3 | ⚠️ divergent |
| 14 | Wallet mirror (PAPER) | `engine.ts:1287-1292`, `standing-order.ts:2359-2365` | `executor.creditSettlement(payout)` — payout, not pnl | ✅ safe |
| 15 | Post-settle verifier | `settlement-verifier.ts` → `settlement-repair.ts` | `delta = expected.payout − bookedPayout`, applied via `bankroll.settle(delta)`; kv-marker per uid prevents double-repair | ✅ safe (idempotent) |
| 16 | Analytics | `analytics.ts:49-192` | `totalReturn = Σ pnl over SETTLED`; `bankrollSeries` from `balance_after`; drawdown from series | ⚠️ see P-4 |
| 17 | Dashboard rendering | `components/v2/*.tsx` | Reads snapshot / analytics — no re-computation | ✅ safe |

### Findings (PnL-adjacent)

#### P-1 Registry-path `sizing` computed and discarded; `dust` clamped by `Math.max(...,0)` can silently absorb over-fill

- **Location:** `engine.ts:1155-1170`.
- `const sizing = this.bankroll.size(filledPrice, ...)` then `void sizing` — the computed sizing is thrown away, and the position uses `order.shares` directly. This works because `LiveExecutor.checkFill` (`live.ts:248-249`) sets `filledShares = min(finalMatched, order.shares)`, so `order.shares` reflects true fill.
- However, `dust = pool − cost` is then clamped with `Math.max(dust, 0)`. If `cost > pool` (which shouldn't happen post-risk-check, but could if bankroll drifted between size-check and fill), the clamp silently masks a shortfall — creating "phantom dust" that never actually existed in the pool. Analytics would then read a `balance_after` that is too high by that amount.
- **Impact:** low probability but real. No CRITICAL alert like the SLO path has.
- **Recommendation:** log ERROR when `pool − cost < 0` and consider aborting the fill accounting (or matching SLO's invariant check).

#### P-2 No accounting invariant on the engine registry-strategy path

- **Location:** contrast `engine.ts:1272-1322` (no invariant) with `standing-order.ts:2331-2354` (invariant asserts `closing = opening + payout`).
- If a registry-strategy settlement is ever double-credited or misses a credit, nothing screams. Symptom would appear as slow drift in bankroll vs `Σ pnl` in analytics.
- **Recommendation:** port the SLO invariant to `engine.recordSettlement`.

#### P-3 Registry path skips the OPEN-row lifecycle used by SLO

- **Location:** `engine.ts:1153-1187` (`onFill`) inserts nothing into `trades` at fill time. The row is created only at settlement via `insertTrade` (`engine.ts:1295`).
- **Consequences:**
  - No unrealized PnL tracking for registry trades — the dashboard's "open position" panel is SLO-only for a reason, but users may not realize this.
  - Restart during an OPEN registry position → the position exists only in memory (`this.position`); crash before settlement means `closeOrphanedOpenTrades` finds nothing to close (there was no row), and the cost that was debited via `commitFill` is **not refunded**. `Bankroll.commitFill` zeroed the balance and stored dust=`pool-cost`; on reboot the pool resumes at `dust`. The lost `cost` is not recoverable via SCRATCH.
- **Impact:** silent bankroll loss on registry-strategy crash-during-position. SLO path is safe because it opens the ledger row on fill and boot-time sweep refunds it.
- **Recommendation:** either mirror SLO's `openTrade`/`settleTrade` shape in the engine registry path, or explicitly refund `pos.cost` when a strategy position is discovered in-memory-only at boot.

#### P-4 Analytics `startBalance` derivation is fragile

- **Location:** `analytics.ts:105-107`.
- `startBalance = first.balance − pnlOf(settled[0])` assumes `balance_after` of the first settled row equals `start + pnl`. For the registry path this holds. For the SLO path this holds *only* after `updateSettledBalance` — which runs immediately after settle, so should be consistent. But when settlement-repair rewrites `balance_after` retroactively via `updateSettledBalance`, chronological order can be violated if repairs are out of order. Drawdown series (`analytics.ts:88-103`) uses `settled_at` timestamps but iterates `id ASC` — id order and time order can disagree after repairs; drawdown becomes noisy but not wrong for totals.
- `avgEntryPrice` at `analytics.ts:83-85` is an unweighted mean, not share-weighted cost basis — if users expect "average entry price" to mean the ledger cost basis, they'll see a divergent number.
- **Recommendation:** rename or reformulate for clarity; add share-weighted variant.

---

## 4. What I could NOT determine from source alone

Reproducing the reported symptoms requires runtime evidence I do not have:

1. **Trade id (or `slot_end_ms`)** of a trade you observed as wrong-direction, so `pnpm replay <id>` / `deriveVerdict` can classify it CORRECT / WRONG_SIDE / UNPROVABLE using the stored `feedAudit`.
2. **Trade id** of a trade whose booked PnL disagrees with your wallet.
3. Whether the "wrong direction" symptom is:
   - (a) ledger says UP but market/wallet says DOWN → execution divergence (would need runtime instrumentation), or
   - (b) engine ledger says UP but LIVE account mirror shows BUY → **finding D-2, cosmetic**, or
   - (c) engine picked the losing side deliberately by trigger race → intended semantic, not a bug.

Without one of the above, any code change to "fix direction" would violate the engineering principle *"Never replace working code without evidence"* and risks inverting a currently-correct path.

---

## 5. Runtime instrumentation plan (removable, ready on approval)

Only if you cannot produce a failing trade id, add this **temporary** telemetry, run for one operational window, then remove:

1. **Direction breadcrumbs** — augment the existing `feedAudit` block written at `standing-order.ts:1945-1961` and mirror an equivalent block for the registry path at `engine.ts:1295` capturing, at fill time:
   - `signal.side`, `triggerSide`, `lockedDirection`, `orderSide`, `orderIds.tokenId`, and the resolved market's `upTokenId`/`downTokenId` (for identity comparison at replay time).
2. **Exchange-payload echo** — in `LiveExecutor.placeOrder` (`execution/live.ts:123-154`), log a structured line with `{ tokenID, marketId, side: "BUY", price, size, expiration }` and, on ack, echo the SDK-returned `orderID` + first `getOrder` snapshot (`asset_id`, `outcome`).
3. **Fill divergence check** — in `LiveExecutor.checkFill` (`live.ts:192-265`), on every fill compare `o.asset_id` to the engine-stored `order.tokenId`; log ERROR if unequal.
4. **Settlement-input dump** — in `recordSettlement` (both paths), log `{ pos.side, pos.tokenId, winner, winningTokenId, mkt.upTokenId, mkt.downTokenId }`; a mismatch between `pos.tokenId` and (winner→winningTokenId) would prove a mid-pipeline swap.
5. **Dashboard sanity beacon** — one-time boot-time log of the last 20 settled trades' `(side, cost, pnl, balance_after)` chain, to confirm running-balance identity.

All logs are additive to existing structured lines; nothing changes trading behavior. Estimated diff: ~120 LOC across 4 files, guarded by an env flag (`P4_DIAG_DIRECTION=1`).

---

## 6. Recommendation

**Do not commit any production-logic change to Stage 1 yet.** Recommended next step:

1. You provide one of:
   - a trade id you observed as wrong-direction, or wrong-PnL, or
   - approval to land the removable instrumentation in section 5 to catch the next occurrence.
2. Confirm whether the "wrong direction" report may be finding **D-2** (live account mirror showing `BUY`). If yes, that is a 4-line dashboard change and I can prepare it as a standalone atomic commit without touching engine logic.
3. Confirm whether **P-3** (registry-path crash-during-position drops the cost) is a known symptom you have hit — if yes, that is a real PnL leak with a clean fix.

Until then the investigation stands as: **no reproducible root cause for a direction inversion; two defensible display/lifecycle divergences (D-2, P-3) that could be reported as the observed symptom.**

## 7. Git status

This environment cannot execute stateful git commands. The diff for this document is prepared as a single commit-ready change under `docs/knowledge/`. Once the workspace's Git sync integration is enabled on this project it will land in `supreme1xxz/p4` (or a dedicated production repo, if you designate one) as:

```
docs(phase1): Stage 1 direction & PnL root-cause investigation
```

No changes to `reference/p4/`.
