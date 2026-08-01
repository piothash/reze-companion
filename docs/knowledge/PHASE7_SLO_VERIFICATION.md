# Phase 7 — SLO Majority-at-Trigger: Verification & Edge-Case Audit

Read-only verification of the Standing Limit Order engine. No code changed.
Every claim is backed by a `path:line` citation into `reference/p4/`.

Sandbox note: the reference tree ships without `node_modules` (git-ignored,
per policy) and the host project has no vitest binary — so runtime test
execution is not available in this sandbox. Verification is performed
statically against the code paths, plus the regression suites already
committed under `reference/p4/tests/unit/` which the operator can execute
on the VPS with `pnpm test`. Every claim below is falsifiable from source.

---

## 1. Simultaneous trigger (both sides at/above the trigger in the same tick)

**Claim:** direction is deterministic — always the higher-priced contract of
the atomic snapshot. Never random.

Path:
- `standing-order.ts:1172-1176` — one tick captures ONE snapshot
  (`this.tickSnapshot = this.deps.clobPriceFeed.validatedQuotes()`).
- `standing-order.ts:1275-1306` — trigger gate is side-agnostic
  (`upPrice ≥ trigger || downPrice ≥ trigger`).
- `standing-order.ts:1416-1441` — immediately before submission,
  `computeMajority(this.tickSnapshot)` is called; `standing-order.ts:935-940`
  defines it as `snap.up.price >= snap.down.price ? UP : DOWN`.
- Tie-break is `>=`, so simultaneous-equal resolves to `UP`. Deterministic,
  not random.

**Verdict:** PASS. Regression coverage:
`tests/unit/slo-majority-at-trigger.test.ts` case *"Tie: UP wins by
deterministic tie-break"* and case *"Both sides at/above trigger"*.

---

## 2. Majority flip between ticks (one immutable snapshot per order)

**Claim:** exactly one snapshot decides direction; a flip in the next tick
cannot corrupt the in-flight order.

Path:
- `standing-order.ts:1172-1176` — snapshot captured once per tick.
- `standing-order.ts:1416-1441` — `computeMajority` reads that snapshot only.
- `standing-order.ts:1526-1541` — after selection, the snapshot is frozen
  onto `this.triggerSnapshot` AND the identity is frozen onto
  `this.triggerLock { generation, marketId, upTokenId, downTokenId,
  slotEndMs, lockedAtMs }`, then `persistState()` is called BEFORE the
  network call at `1586`.
- After the placement `await`, the ghost-tick guard at `1610-1633`
  checks `this.tickEpoch !== myEpoch` and, if the world moved, cancels the
  orphan rather than re-selecting.
- Any later tick that observes a different majority cannot re-decide,
  because `this.lockedDirection !== null` at `1288-1290` and the
  submission-time re-computation at `1428` is gated on
  `lockedDirection === null`.

**Verdict:** PASS. Exactly one `computeMajority` call per order per lock.
There is no second invocation on the resting/adopted path.

---

## 3. Duplicate trigger protection (trigger true across many ticks)

**Claim:** at most one order per window even if the trigger stays true.

Guards, in order:
1. `standing-order.ts:1100-1120` — `this.busy` re-entrancy gate. Only one
   `tick()` runs at a time (with a busy-watchdog that bumps `tickEpoch` to
   invalidate the hung tick).
2. `standing-order.ts:1574` — `this.readyForTrigger = false` fires
   **synchronously before** the placement `await`, so the next tick sees
   the gate closed.
3. `standing-order.ts:1366` — the whole submission block is gated on
   `if (!this.restingOrder)`. Once set, subsequent ticks fall through to
   the resting-order poll branch at `1684-1704`.
4. `standing-order.ts:1239-1243` — `this.windowFilled` short-circuits every
   further tick in the slot after a fill.
5. `standing-order.ts:1576-1578` — `persistState()` runs BEFORE the network
   call, so a crash mid-placement cannot re-race after restart.
6. `standing-order.ts:1606-1633` — post-await ghost-tick guard cancels the
   order instead of adopting into a changed world.

**Verdict:** PASS. Five independent guards prevent duplicate submission.

---

## 4. Snapshot freshness

**Claim:** stale snapshots are rejected before any decision.

Path:
- `feeds/clob-price-feed.ts:44` — `const STALE_MS = 15_000`.
- `feeds/clob-price-feed.ts:266-269` — if `upAgeMs >= STALE_MS ||
  downAgeMs >= STALE_MS`, `validatedQuotes()` returns null with reason
  `"stale quote …"`.
- `feeds/clob-price-feed.ts:48-49` — confidence grading:
  `HIGH < 3s WS/WS`, `MEDIUM < 10s`, else `LOW`.
- `feeds/clob-price-feed.ts:275-282` — confidence is stamped on the
  snapshot.
- `standing-order.ts:911-914` — `executionPriceForSide` REJECTS `LOW`
  confidence (returns `null` → NO_DATA path at `1312-1336`, which cancels
  any resting order and holds).

**Verdict:** PASS. Two-stage freshness: hard reject at 15 s, execution
reject at LOW confidence (worse than MEDIUM at 10 s). Numbers explicit in
source.

---

## 5. Retry behaviour when snapshot unavailable

**Claim:** no side chosen, no order submitted, retry next tick, submit only
once a valid snapshot exists, or skip if window closes.

Path:
- `standing-order.ts:1292-1306` — pre-check: if either
  `executionPriceForSide` returns null, `side` and `sidePrice` are set to
  null and the flow falls through to `1312`.
- `standing-order.ts:1312-1336` — NO_DATA branch: cancels any resting
  order, sets status `NO_DATA`, throttled-logs the diagnostic, writes a
  WITHHELD order-log row (via `logWithheld` at `959-…`), and `return`s —
  no order placed, no state advanced.
- `standing-order.ts:1428-1441` — at submission time, if
  `computeMajority(this.tickSnapshot).side === null`, status `NO_DATA`,
  throttled warning, `return`. Order withheld, retry on next tick.
- The tick timer chain (`armWindowOpenTimer` at `1263` and the base tick
  cadence) re-invokes automatically until success OR the window closes.
- Window-expiry termination: `1488-1504` (see §6).

**Verdict:** PASS. Retry is a natural consequence of the timer loop; no
partial state is written on withhold.

---

## 6. Execution window: trigger never fired → nothing survives into next
market

**Claim:** if the entry window expires without a trigger, no order exists,
and rollover clears everything.

Path:
- `standing-order.ts:1257-1273` — before the window opens the trigger
  evaluation is fully skipped; for `UPWARD_CROSSING` mode the gate is
  forcibly re-closed each waiting tick (`this.readyForTrigger = false`).
- `standing-order.ts:1488-1504` — last-instant re-check: if window is not
  yet open OR settlement has passed, the submission is withheld.
- `standing-order.ts:1131` — slot rollover check at every tick top; when
  `slotEnd !== this.slotEndMs`, the rollover path (search
  `rollover|resetForNextSlot|windowFilled = false` at `2039-2124`) resets
  `slotEndMs`, `restingOrder`, `restingSide`, `lockedDirection`,
  `triggerLock`, `triggerSnapshot`, `windowFilled`, `readyForTrigger`,
  and persists.
- `standing-order.ts:1178-1218` — TRIGGER LOCK INTEGRITY GUARD cancels any
  in-flight order and releases the lock if the market identity changed
  mid-lock.

**Verdict:** PASS. Stateless window check (synced clock vs slotEndMs) plus
identity-change guard means no residue crosses market boundaries.

---

## 7. Evidence bundle stored on every fill

Path: `standing-order.ts:1878-1909` (`buildFeedAudit`), invoked at
`standing-order.ts:1970-1985` inside the `openTrade(...)` ledger write.

Fields present on every trade:
- `generation`, `sequence` (feed integrity) — `1884-1885`.
- `snapshotAtMs` (**snapshot timestamp**) — `1886`.
- `triggerPrice`, `triggerMode`, `limitPrice` — `1887-1889`.
- `winningSide` — historical field name, holds the **submitted side**
  (`order.side`) — `1890`. NOTE: name preserved for backward-compat with
  stored records; semantics are now "the side executed = live majority".
- `majority { side, upPct, downPct }` — `1891-1893`.
- `quotes { up: {price, source, ageMs, latencyMs}, down: {…} }` —
  including **UP quote, DOWN quote, and quote age** — `1894-1899`.
- `wsFreshMs`, `restFreshMs`, `confidence` — `1900-1902`.
- `marketId` (**market ID**) and `slotEndMs` — `1903-1904`.
- `lock { generation, marketId, upTokenId, downTokenId, lockedAtMs }`
  where `lockedAtMs` is the **trigger timestamp** — `1905-1907`.
- **Submission timestamp** and full latency breakdown recorded separately
  at `standing-order.ts:1667-1679` (`executionLatency: { quoteAgeMs,
  decisionMs, preSubmitMs, submitMs, fillCheckMs, totalMs, atMs }`),
  persisted at `1980`.
- `sideSelection` narrative at `1972`:
  `"direction chosen from live majority-at-trigger snapshot: <side> was
  the higher-priced contract at the instant the trigger fired (trigger
  does not select direction)"`.

Prohibited wording — grep of the LIVE explanation writer at
`standing-order.ts:1970-1986`: no "direction locked", no "won the race",
no "first side". The prior `sideSelection` string that read "direction
locked to <side> — first side whose best-ask reached the trigger" no
longer appears in engine code (see §10).

**Verdict:** PASS. All ten required evidence fields are present. The
`winningSide` key name is retained for backward-compat with historical
rows; its value is the same submitted side. If field-name purity is
required, this is a documentation task, not a correctness task
(see TODO §Remaining risk).

---

## 8. Replay: old and new trades

Path: `lib/v2/engine/trade-replay.ts`.

- New trades (post-Phase-1, feedAudit present):
  `trade-replay.ts:240-278` runs the verdict:
  - `!triggerReached(snap)` → `WRONG_SIDE (trigger not reached)`.
  - `trade.side === majoritySide(snap)` → `CORRECT (majority-at-trigger)`.
  - otherwise → `WRONG_SIDE (minority at trigger)`.
  The verdict is derived from the **stored** snapshot (`feedAudit.quotes`
  and `feedAudit.triggerPrice`), not from any live state — it is
  reproducible offline forever.

- Old trades (pre-Phase-1, no feedAudit): `trade-replay.ts:280-298` opens
  the record, prints the stored `sideSelection` / `entry` narratives, and
  returns `UNPROVABLE` with an explicit missing-evidence list. Old trades
  still open — nothing crashes, nothing was migrated destructively.

**Verdict:** PASS. Fixture-based coverage of pre-Phase-1 explanation
strings continues to exercise the old-trade branch via
`tests/unit/direction-verdict.test.ts` (kept for backward compatibility).

---

## 9. Performance: old vs new

Every mechanism used by the new selection already existed before the
change — this is a pure re-wiring of decision logic, not a new I/O path.

| Cost source          | Before                          | After                             |
| -------------------- | ------------------------------- | --------------------------------- |
| `tickSnapshot` reads | 1 per tick (`1176`)             | 1 per tick (`1176`, unchanged)    |
| Feed I/O per tick    | WS message-driven + REST poll   | identical (feed layer untouched)  |
| `computeMajority`    | 1 per tick (display) + 1 (race) | 1 per tick (display) + 1 (submit) |
| `persistState` calls | at fill and at lock             | at lock (`1578`) and at fill      |
| Network placements   | 1 per triggered window          | 1 per triggered window            |
| DB writes            | 1 `order_log` + 1 `trade` per fill | 1 + 1 per fill                 |

There is zero additional websocket traffic, zero additional REST calls,
zero new database writes, and no new awaits inserted on the hot path —
the change replaced the pre-lock branchy race arithmetic with a single
`Math.max`-equivalent comparison against the already-captured snapshot.
Steady-state per-tick CPU is a constant-factor decrease.

Latency instrumentation continues to be recorded per trade at
`1667-1679` and persisted at `1980`, so the operator can observe drift
directly on the VPS.

**Verdict:** PASS (analytical). Empirical VPS benchmark should be taken
during Phase 7 acceptance using the existing latency logs; a synthetic
sandbox benchmark would not represent CLOB/WS latency and is skipped.

---

## 10. Static scan for banned phrases

Command (executed against `reference/p4`, `src`, `docs`):

```
rg -in "direction locked|won the race|first side|trigger winner|race winner|lock direction|winner reached trigger"
```

Occurrences:

| Path                                                                 | Line | Kind                                                        |
| -------------------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| `reference/p4/tests/unit/direction-verdict.test.ts`                  | 123  | Test **fixture** — old stored `entry` string                |
| `reference/p4/tests/unit/direction-verdict.test.ts`                  | 124  | Test **fixture** — old stored `sideSelection` string        |
| `reference/p4/tests/unit/direction-verdict.test.ts`                  | 136  | `expect(...).toContain(...)` on the fixture above           |
| `reference/p4/tests/unit/direction-verdict.test.ts`                  | 209  | Test **fixture** — historical explanation JSON              |
| `reference/p4/tests/integration/ledger-accounting.test.ts`           | 120  | Test **fixture** — historical explanation JSON              |
| `docs/knowledge/PHASE6D_STANDING_ORDER_UPDATE.md`                    | 49   | Historical documentation                                    |
| `docs/knowledge/PHASE6D_STANDING_ORDER_UPDATE.md`                    | 50   | Historical documentation                                    |

Executable engine code containing the banned phrases: **zero**.
All remaining hits are (a) historical stored-record fixtures that the
replay verifier must continue to parse, and (b) prior-phase
documentation. Both are within the allowed exceptions.

**Verdict:** PASS.

---

## Summary

| # | Check                              | Status |
| - | ---------------------------------- | ------ |
| 1 | Simultaneous trigger deterministic | PASS   |
| 2 | Majority flip / one snapshot rule  | PASS   |
| 3 | Duplicate trigger protection       | PASS   |
| 4 | Snapshot freshness enforcement     | PASS   |
| 5 | Retry when snapshot unavailable    | PASS   |
| 6 | Execution window expiry hygiene    | PASS   |
| 7 | Evidence bundle completeness       | PASS   |
| 8 | Replay: old + new trades           | PASS   |
| 9 | Performance                        | PASS   |
| 10| Static scan                        | PASS   |

## Remaining risk

- `feedAudit.winningSide` field name is a semantic vestige of the "race"
  model. Value is correct (= submitted side = live majority), but the
  key name could mislead a future reader. Impact: cosmetic /
  documentation.
- The sandbox cannot execute the vitest suite (no `node_modules`).
  Production sign-off requires `pnpm i && pnpm test` on the VPS to prove
  the regression matrix (`slo-majority-at-trigger.test.ts`,
  `phase6d-majority-side.test.ts`, `direction-verdict.test.ts`,
  `ledger-accounting.test.ts`) is green end-to-end.

## Remaining TODO before production sign-off

1. Run `pnpm test` on the VPS and archive the JUnit / stdout report.
2. Capture 60 minutes of live `executionLatency` log lines under real
   VPS load to confirm the analytical performance claim in §9.
3. Optionally rename the persisted key `feedAudit.winningSide` →
   `submittedSide` in a future non-breaking migration (writer + reader
   + replay + fixture parsers). Not a correctness item.

No other subsystem (settlement, bankroll, compounding, sizing, risk,
reconciler, executor, feed layer, dashboard) was inspected or modified
during this verification.
