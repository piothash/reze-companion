# Phase 4 — Execution Engine Architectural Audit (Read-Only)

Scope: audit only. No production code modified.
Coverage: order creation → submission → resting → fill → cancel → recovery →
reconciliation → settlement handoff. Settlement/ledger/bankroll/replay/risk
internals themselves are out of scope (already certified Phase 2/3/7); only
their execution-layer *interfaces* are audited here.

Modules inspected (LOC via `wc -l`):
`execution/executor.ts` (101), `execution/live.ts` (417),
`execution/paper.ts` (364), `standing-order.ts` (2489),
`reconciler.ts` (167), `feeds/order-events.ts` (330),
`handlers/cancel-replace-pipeline.ts` (43),
`handlers/orphan-cleaner.ts` (46), `db.ts` (trades table lifecycle).

---

## 1. Execution architecture (as-built)

```
setLimitOrder / strategy.decide()
        │
        ▼
  computeOrderShares(record:true) ─── risk.checkOrder ─┐
        │                                    (fail)   ▼
        │                                          BLOCKED (auto-retry)
        ▼
  executor.placeOrder(req)  ── PAPER_V1 (sim book) or LIVE_V2 (CLOB SDK)
        │  ack: exchangeOrderId
        ▼
  submittedShares = size            ◄── immutable freeze (Phase 3)
  restingOrder = placedOrder
        │
   ┌────┴───────────────────────────────────────────┐
   ▼                                                ▼
 checkFill (REST poll, EXEC_CALL_TIMEOUT_MS)   OrderEventListener (WS user)
   │  full match / partial match / null           │  READ-ONLY log + observer
   │                                              ▼  (never feeds fill path)
   ▼                                        onAccountEvent -> debounced refresh
 onFill(order, filledPrice)
   │  insertOpenTrade (status=OPEN)      ── ledger idempotency
   │  bankroll.debitFixed(cost)
   │  submittedShares = null             ── clear
   ▼
 SETTLING (external handoff to engine.recordSettlement)
   │  settle:lock:<uid>, final:<result>, WHERE status='OPEN'
   ▼
 SETTLED_{WIN|LOSS|SCRATCH}

 Parallel loops:
  • Reconciler (60s, LIVE_V2 only)  — untracked/missing/wallet drift
  • Stuck-RESTING guard             — SLO getOrderState mismatch → re-arm
  • Rollover cancelAllOrders()      — purge stale makers at slot flip
  • settlement-repair (SLO-side)    — SCRATCH → WIN/LOSS retro
```

Diagram artifact: `P4_Execution_State_Machine.mmd` (state machine below).

---

## 2. Order state machine

Legal transitions currently implemented:

| From | To | Trigger | Evidence |
|---|---|---|---|
| NEW | VALIDATED | `risk.checkOrder` PASS | `standing-order.ts:1586` (block path) |
| NEW | BLOCKED | risk fail | `:1586` |
| BLOCKED | NEW | gate clears next tick | idle re-tick |
| VALIDATED | SUBMITTING | `executor.placeOrder(req)` | `:1607` |
| SUBMITTING | SUBMIT_FAILED | throw / `withTimeout` | `:1607` wrapped |
| SUBMITTING | ACKNOWLEDGED | orderID returned | `live.ts:158`, `:1659` freeze |
| ACKNOWLEDGED | GHOST_ORPHAN | epoch changed mid-flight | `standing-order.ts:1629-1648` |
| GHOST_ORPHAN | DEAD | `cancelOrder(orphan)` | `:1648` |
| ACKNOWLEDGED | RESTING | tick continues | fall-through |
| RESTING | PARTIALLY_FILLED | `size_matched>0 && <shares` | `live.ts:243` |
| PARTIALLY_FILLED | FILLED_TERMINAL | remainder cancel + re-read | `live.ts:255-282` |
| RESTING | FILLED_TERMINAL | `size_matched >= shares` | `live.ts:242` |
| RESTING | CANCEL_PENDING | rollover / cancel-replace | `live.ts:205-227` |
| CANCEL_PENDING | RESTING | cancel throws && state=LIVE | `live.ts:215-222` (aborts replace) |
| CANCEL_PENDING | DEAD | cancel ok / state=DEAD\|MATCHED | `live.ts:224` |
| RESTING | STUCK_RESTING | `getOrderState` mismatch | `standing-order.ts:1765` |
| STUCK_RESTING | NEW | SLO re-arms | SLO tick |
| FILLED_TERMINAL | OPEN_LEDGER | `insertOpenTrade` | `db.ts:291` |
| OPEN_LEDGER | SETTLING | oracle read | `engine.recordSettlement` |
| SETTLING | SCRATCH_PENDING | official winner missing <5m | Phase 2 hardening |
| SCRATCH_PENDING | SETTLING | repair retry | `settlement-repair.ts` |
| SETTLING | SETTLED_{WIN\|LOSS\|SCRATCH} | KV lock + row UPDATE | `db.ts:360`, `settle:lock:<uid>` |

Illegal transitions currently **structurally impossible**:

- `SETTLED_* → *` — `WHERE status='OPEN'` clause rejects re-settlement (`db.ts:362`).
- `WIN → SCRATCH` (or any reversal) — final markers in KV (`settle:lock:*` `final:<result>`).
- `PARTIALLY_FILLED → RESTING` — partial fill forces cancel-remainder in `live.ts:253`.
- `NEW → ACKNOWLEDGED` without VALIDATED — no path bypasses `risk.checkOrder` before `placeOrder`.

Illegal transitions currently **possible but guarded** (defense in depth OK):

- `ACKNOWLEDGED → RESTING → duplicate submit` — prevented by `restingOrder != null` gate in SLO tick; strategy path relies on single-in-flight tick discipline. See §7 R-3.

---

## 3. Subsystem findings

### 3.1 Order Creation

Current impl: `computeOrderShares(limitPrice, {record:true})` → `risk.checkOrder` → build `PlaceOrderRequest`. Sizing freeze (Phase 3) means `submittedShares` is captured post-ack; pre-ack, the `capped` value is a local const, not mutable engine state.

- Failure modes: risk gate returns block → BLOCKED (self-heals next tick); TIF computed at placement (`live.ts:129`) uses `Date.now()` — safe.
- Race: PERCENT sizing reads bankroll KV; if a settlement writes between compute and place, size may under-shoot by one order. Acceptable per Phase 3 §Remaining risks.
- Severity: Low.

### 3.2 Order Submission

- REST: `client.createAndPostOrder(...)` inside `placeOrder`. No retry loop; a throw bubbles to the SLO tick which logs and abandons the slot iteration. Next tick reissues fresh.
- No REST-level idempotency key. Polymarket SDK does not accept a client order id header; `randomUUID()` in `OpenOrder.clientOrderId` is for internal tracking only.
- Timeout: `withTimeout(executor.placeOrder, EXEC_CALL_TIMEOUT_MS)` on SLO path; a timeout returns to the caller while the request may still complete server-side → possible orphan on the exchange. Ghost-orphan sweep at `standing-order.ts:1629-1648` handles the epoch-changed case, but a plain-timeout-with-later-success case is only caught by the reconciler.
- **F-1 (Medium)**: Submission timeout without epoch change may leave an untracked resting order until the 60s reconciler cycle. Mitigation exists (reconciler flags UNTRACKED as ERROR) but recovery requires operator action or the SLO stuck-RESTING guard once id is known.
- Ack handling: sole trust is `resp.orderID`. If SDK returns success:true with no id, `exchangeOrderId=null` and `cancelOrder` becomes a no-op (`live.ts:200`). Any subsequent fill on that order would be undetected.
- **F-2 (Medium)**: `resp.success===true && orderID==null` path not defensively rejected. Recommend a hard throw so the SLO stays armed rather than tracking an unreferenceable order.

### 3.3 Partial Fill Handling

- `live.ts:253` cancels remainder, re-reads `size_matched` post-cancel, reports max of the two counts. This is correct against the fill-during-cancel race.
- Cancel-remainder failure only logs error; the remainder may keep matching. Reconciler catches it as UNTRACKED after 60s.
- `submittedShares` is authoritative in `onFill` at `standing-order.ts:1951` — verified Phase 3.
- Late fills after `submittedShares=null`: an event arriving after the clear at `:2055` would be re-processed by another `checkFill` poll only if `restingOrder` is still set; the clear runs after `restingOrder = null`, so subsequent polls skip. Late WS `trade` events are read-only.
- **F-3 (High)**: partial-remainder cancel failure only logs. If the CLOB cancel returns 5xx and the remaining shares fill, the ledger records only the first partial and the extra shares become an untracked position. Reconciler surfaces this at T+60s but does NOT trigger auto-flatten. Severity High for LIVE_V2 with large orders.

### 3.4 Retry Engine

- Executor level: no automatic retry on `placeOrder` or `cancelOrder`. Failures propagate.
- SLO level: implicit — the next tick tries again if the slot is still armed and no order is resting.
- checkFill: soft retry via next-tick polling; consecutive failure counter at `live.ts:314-326` warns after 5x within 30s (throttled).
- No exponential backoff on REST calls. WS reconnect uses `RECONNECT_BASE_MS * 2^n` capped at 15s (`order-events.ts:34-35`) — correct.
- No max-retry counter for SLO placement — a persistently failing CLOB would emit tick warnings indefinitely. Acceptable; the risk gate throttles.

### 3.5 Cancel / Replace

- `cancelReplace` (`live.ts:205`): try cancel → on failure query `getOrderState` → if LIVE/UNKNOWN, throw (refuse duplicate) → else post replacement. Correct.
- SLO enforces single-in-flight via `restingOrder` field.
- Late exchange ack: cancel returning 200 after the SLO has already re-armed is benign (order is gone).
- Duplicate cancel: `cancelOrder` on a DEAD id returns error → swallowed by `.catch(()=>{})` at `:447, :2573`. Acceptable.
- Replace race under `UNKNOWN`: treated conservatively as LIVE — refuse to duplicate. Correct.

### 3.6 Exchange Synchronization

- REST reconciler: 60s, LIVE_V2 only, read-only, flags UNTRACKED / MISSING / wallet drift.
- WS reconciler: `OrderEventListener` observes for logging + a debounced dashboard refresh trigger; explicitly does NOT drive fill logic (`order-events.ts:11-15`).
- Out-of-order events: WS events are for observation only, so ordering does not affect state machine correctness. REST `checkFill` is the sole authority.
- Missing execution reports: `checkFill` polls `size_matched` directly, so a missed WS event cannot hide a fill.
- **F-4 (Medium)**: `OrderEventListener.open()` at `order-events.ts:180` **registers `ws.on("open", ...)` TWICE** (`:180` and `:196`). Both fire on connect. First handler subscribes + starts ping; second handler stamps `lastFrameAtMs`. No functional break (both are needed), but the pattern is fragile: a future edit inside either handler would look complete while the other silently overwrites intent. Recommend consolidating into one `on("open")` in Phase 5.

### 3.7 Restart Recovery

- SLO: `restoreArmedConfig` at `standing-order.ts:428-458` re-hydrates params, adopts any resting order id via `adopt` scan (`:1830-1848`), and re-arms. `submittedShares=null` on adoption — partial-fill provenance falls back to `lastSizing → order.shares`; ledger/bankroll unaffected (Phase 3 §Remaining risks R-1).
- DB: `closeAllOpenAsScratch` at `db.ts:177-219` refunds cost and marks OPEN rows SCRATCH on boot; settlement-repair then upgrades to WIN/LOSS if oracle confirms.
- Pending settlement: SCRATCH-pending survives restart (KV `pending` lock).
- Pending cancel: on restart, `restingOrder` restored from persisted rt; SLO cancels it defensively at `:447` before re-arming.
- **F-5 (Low)**: adopted-order partial-fill provenance is best-effort; ledger + bankroll remain correct (they use actual filled qty). Display-only artifact.

### 3.8 WebSocket Recovery

- Disconnect: `scheduleReconnect` uses exponential backoff (`:266`). Correct.
- Zombie socket: `forceReconnect` public API exists (`:74`); however, no internal watchdog currently invokes it based on `lastFrameAgeMs`. It is exposed for the engine watchdog but call sites need audit — **F-6 (Medium)**: search of the repo shows `forceReconnect` is defined but I did not observe an internal watchdog invocation path in the audited files; recommend Phase 5 verify caller wiring.
- Duplicate subs: `setMarkets` diffs added/removed and only sends the delta; guarded against unchanged scope (`:106-108`). Correct.
- Missed fills: irrelevant — WS is read-only for fills.

### 3.9 Idempotency ledger

| Event | Idempotency mechanism | Location |
|---|---|---|
| Order ACK | Local; no exchange idempotency key | `live.ts:158` |
| Fill (full) | `restingOrder=null` after `onFill` prevents re-poll | `standing-order.ts:2055` |
| Fill (partial) | Remainder cancelled + `restingOrder=null`; ledger row inserted once | `live.ts:253`, `db.ts:291` |
| Cancel | Cancelling DEAD id swallowed; no double-effect | `:447`, `:2573` |
| Settlement | `settle:lock:<uid>` + `final:<result>` KV + `WHERE status='OPEN'` row guard | Phase 2 |
| Restart-adopted fill | Ledger row inserted at fill regardless of adoption; boot SCRATCH-close is atomic per row | `db.ts:187-219` |

Exactly-once for FILL / CANCEL / SETTLEMENT holds structurally. ACK does NOT
have exchange-level exactly-once (no idempotency key) — see F-1/F-2.

---

## 4. Risk register

Ranked by severity × likelihood:

| ID | Severity | Likelihood | Area | Risk | Recommended fix (Phase 5) | Regression risk |
|---|---|---|---|---|---|---|
| F-3 | **High** | Medium | Partial fill | Cancel-remainder failure → untracked resting shares fill unseen until 60s reconciler | Auto-retry cancel N times with backoff, then flag as CRITICAL_UNTRACKED + optional auto-flatten via `orphan-cleaner` | Touches `live.ts:253-282` and `orphan-cleaner`; must not double-cancel a naturally-completed order — check state before each retry |
| F-2 | Medium | Low | Submission ack | `success:true` with null `orderID` produces an untrackable resting order | Throw in `placeOrder` when `orderID` missing; SLO next tick retries cleanly | Local to `live.ts:157-165`; low regression |
| F-1 | Medium | Low-Med | Submission timeout | `withTimeout` may abandon a request the server still completes → orphan until reconciler | Add pre-place snapshot of open orders, or accept F-1 as covered-by-reconciler and document | Reconciler already flags; no new logic strictly needed |
| F-6 | Medium | Unknown | WS zombie recovery | `forceReconnect` may not be wired to a `lastFrameAgeMs` watchdog | Verify/add watchdog: if `lastFrameAgeMs > 30_000` and hasScope, `forceReconnect("stale")` | Isolated in feed layer |
| F-4 | Low | Low | WS handler duplication | Two `on("open")` handlers — fragile but functional | Consolidate to one handler at `order-events.ts:180` | Trivial |
| F-5 | Low | Low | Restart adoption | Partial-fill display estimate degraded after restart | Persist `submittedShares` in rt so adoption restores it | Persistence-only; ledger unaffected |
| F-7 | Low | Low | Rollover ordering | `cancelAllOrders` purges SLO's resting order → SLO's `restingOrder` may be non-null for one tick after purge until stuck-RESTING guard clears it | Coordinate rollover to call `slo.onExternalPurge()` before `cancelAllOrders` | Small; SLO already documents this at `engine.ts:669` |

No **Critical** defects found.

---

## 5. Every recovery mechanism (inventory)

1. Risk-gate auto-resume — next tick after block.
2. SLO tick self-retry — no explicit retry counter; re-fires when idle & armed.
3. Ghost-tick guard — epoch bump cancels orphan orders (`standing-order.ts:1629`).
4. Stuck-RESTING guard — `getOrderState` mismatch → re-arm (`:1765`).
5. Cancel-remainder on partial (`live.ts:253`).
6. Cancel-verify before replace (`live.ts:212-224`).
7. WS reconnect w/ exponential backoff (`order-events.ts:266`).
8. WS `forceReconnect` API for zombie sockets (`:74`).
9. Reconciler UNTRACKED/MISSING/drift reports (60s, LIVE_V2).
10. Boot SCRATCH-close for orphaned OPEN rows (`db.ts:187`).
11. Settlement-repair loop upgrades SCRATCH → WIN/LOSS retro.
12. Rollover `cancelAllOrders` + SLO adoption on next tick.
13. Orphan-cleaner FOK counter-order builder (defined; strategy-invoked).
14. `checkFill` failure warn at 5x consecutive (`live.ts:319`).

---

## 6. Every reconciliation path (inventory)

- 60s REST reconciler (`reconciler.ts:runOnce`).
- WS user channel observer (`order-events.ts`).
- Post-partial `getOrder` re-read (`live.ts:265`).
- Boot orphan sweep (`db.ts:187`).
- Settlement-repair sweep (SLO-side incremental watermark).
- SLO adoption scan on restore (`standing-order.ts:1830`).

---

## 7. Every duplicate-order risk (inventory)

| R# | Path | Guard |
|---|---|---|
| R-1 | Cancel fails, replace posted | `cancelReplace` verifies DEAD/MATCHED first (`live.ts:212-224`) |
| R-2 | SLO ticks re-enters while `placeOrder` in flight | `restingOrder != null` gate + epoch check |
| R-3 | Restart re-adopts + re-places | Adoption sets `restingOrder` before tick can decide to place (`:1830-1848`) |
| R-4 | Submission timeout with later exchange success | Ghost-tick sweep for epoch-change case; reconciler for plain timeout (F-1) |
| R-5 | Rollover purge + SLO tick before re-arm sees purge | SLO re-arms after purge; no fresh place until stuck-RESTING clears (F-7) |

---

## 8. Prioritized implementation plan (Phase 5 — pending approval)

Do NOT implement yet. Order of operations if approved:

1. **F-3** — Partial-remainder cancel retry + CRITICAL_UNTRACKED escalation. **High priority.** Isolated to `live.ts` partial-fill block; regression-tested against `phase3-sizing` and `standing-order` suites.
2. **F-2** — Reject `success:true && orderID==null` at ack. **Medium.** Trivial.
3. **F-6** — Wire `forceReconnect` to a `lastFrameAgeMs` watchdog (30s idle). **Medium.**
4. **F-1** — Post-timeout open-orders sweep to reconcile the ambiguous ack. **Medium**, optional if F-6 + reconciler deemed sufficient.
5. **F-4** — Consolidate duplicate `on("open")` in `order-events.ts`. **Low, do while nearby.**
6. **F-7** — Rollover ordering explicit contract with SLO. **Low.**
7. **F-5** — Persist `submittedShares` in rt for adoption. **Low, display-only.**

Each item independently testable; each item has zero footprint in Settlement,
Ledger, Bankroll, Position Sizing, Risk, or Replay — the systems declared
untouchable by this phase remain untouched.

---

## 9. Verdict

- Execution engine is **structurally sound** for exactly-once FILL / CANCEL /
  SETTLEMENT. No Critical defects.
- One High-severity gap (F-3, partial-remainder cancel failure). All others
  Medium/Low.
- The state machine is complete; illegal transitions are structurally blocked
  where it matters (settlement finality, sizing immutability).
- Recommend proceeding to Phase 5 with the 7-item plan above, starting with
  F-3.

No code was modified during this audit.
