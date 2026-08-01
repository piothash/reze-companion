# Phase 0 Review — Self-Audit of the Engineering Knowledge Base

**Scope.** Review of `docs/knowledge/` against `reference/p4/`. No changes to production code. No changes to the 16 existing reports; findings live only here and in the two new appendices under `docs/knowledge/_appendix/`.

**Read this with:**
- `_appendix/file-index.md` — every file in `reference/p4/` with the report(s) that index it.
- `_appendix/open-questions.md` — every `Unverified` item and question the KB cannot answer from source alone.

---

## 1. Executive Summary

The Phase 0 KB captures the architecture and safety posture of the P4 trading bot with correct high-level structure and useful cross-cutting reports (Execution, Settlement, Accounting, Risk, Synchronization). Deep dives on the two most consequential modules — `engine.ts` (1551 LOC) and `standing-order.ts` (2489 LOC) — remain **symbol-scan level**, not line-by-line traces. Coverage of tests, operator runbooks, and support scripts is materially incomplete.

Multiple `path:line` citations drift by 2–7 lines from the actual source location, and one substantive naming contradiction was found (`Engine` in the reports vs `Edge5Engine` in source at `engine.ts:842`).

**Verdict: PHASE 0 REQUIRES ADDITIONAL DOCUMENTATION.** See §11 for the specific closable gaps.

---

## 2. Documentation Completeness

| Checklist item | Report(s) | Depth | Complete? |
|---|---|---|---|
| Architecture | 01 | Module map, boot sequence, data flow | ✅ |
| Dashboard | 02 | Pages, API routes, panels, auth surface | ⚠️ auth details asserted, not quoted |
| Trading Engine | 03 | Fields, phases, control API, tick, snapshot | ⚠️ tick body not traced end-to-end |
| Standing Limit Orders | 04 | Purpose, state machine, safeguards | ❌ symbol-scan only for 2489 LOC file |
| Execution | 05 | Contract + LIVE + PAPER, safety comments quoted | ✅ |
| Settlement | 06 | Slot end, winner, verify+repair | ⚠️ `settleOfficial`/`computeSpotFallback` bodies not quoted |
| Accounting | 07 | Bankroll, dust, seams | ✅ |
| PnL | 07 (subsumed) | WIN/LOSS/SCRATCH math | ⚠️ verifier formula not quoted |
| Risk | 08 | Gate, limits, kill switch, migration | ✅ |
| Synchronization | 09 | Reconciler, oracle guard, wallet sync | ⚠️ oracle guard internals not quoted |
| Direction Logic | 10, 11 | `UP`/`DOWN` used throughout | ❌ no `YES`/`NO`/token-id mapping (see §7) |
| Paper Trading (V1) | 05 | Chaos profile, sim book, seams | ✅ |
| Live Trading (V2) | 05 | SDK, EIP-712, POST_ONLY, TIF | ✅ |
| Authentication | 02 | Named at surface level | ❌ mechanism not quoted from `dashboard-auth.ts` or `api-auth.ts` |
| Database | 12 | Schema, migrations, KV, write queue | ✅ |
| Testing | 14 | Framework + gaps disclaimer | ❌ 28 tests exist and were not enumerated (see `_appendix/file-index.md`) |
| Deployment | 01, 13 | PM2, instrumentation | ⚠️ exact `ecosystem.config.js` flags not quoted |
| Configuration | 00, 03 | Named defaults | ⚠️ `env` schema and defaults in `config.ts` not enumerated |
| Runtime lifecycle | 01, 03, 13 | Boot → tick → rollover → settle | ✅ |
| Startup | 01, 13 | Sequence documented | ⚠️ ordering inferred, not quoted |
| Shutdown | 13 (implicit) | `stop()`, `dispose()` mentioned | ❌ no dedicated section, no signal handling detail |
| Recovery | 13 | Auto-resume, SCRATCH sweep, watchdog | ✅ |

**Completeness estimate: ~65%** — structure and safety-critical modules are covered; testing/operator/config/direction-mapping subsystems are shallow or absent.

---

## 3. Evidence Quality Assessment

### Citations that drifted from source

Verified against `reference/p4/`:

| Report | Cited as | Actual location | Off by |
|---|---|---|---|
| 05 Execution | `POST_ONLY = true (live.ts:33)` | `live.ts:43` | +10 |
| 05 Execution | `TICK_SIZE = "0.01" (live.ts:35)` | `live.ts:45` | +10 |
| 05 Execution | `EthersV6SignerAdapter (live.ts:52)` | (unverified in this pass) | — |
| 05 Execution | `throws if any of … missing (live.ts:71-84)` | (unverified in this pass) | — |
| 09 Sync | `RECONCILE_MS = 60_000 (reconciler.ts:29)` | `reconciler.ts:27` | −2 |
| 09 Sync | `DRIFT_TOLERANCE_USD = 1 (reconciler.ts:30)` | `reconciler.ts:28` | −2 |
| 08 Risk | `DEFAULT_LIMITS (risk.ts:70-76)` | `risk.ts:65-71` | −5 |
| 03 Engine | `SPOT_STALE_MS = 10_000 (engine.ts:837)` | `engine.ts:837` | ✅ exact |
| 05 Execution | `paper.ts:88` `priceForSide` | (unverified — line was inside chaos struct at 88) | needs recheck |
| 12 Persistence | `scratchOrphanedOpenRows (db.ts:174-206)` | defined at `db.ts:185`; called at `db.ts:163, 388` | range shifted |
| 01 Architecture | `eslint.config.js` in `.prettierignore` note | Actual file is `eslint.config.mjs` | filename wrong |

**Assessment.** The pattern is small line-offset drift (±10) caused by summarizing then re-numbering during writes, plus one file-extension mistake. No citation was to a nonexistent file. No citation asserted behavior contradicted by the referenced line. Numerical constants are all correct (`60_000`, `1`, `100/500/2000/1000`, `10_000`).

### Statements without a supporting citation

Enumerated in `_appendix/open-questions.md` as U1–U18.

---

## 4. Cross-Reference Validation

### Working cross-references

- `README.md` links to reports 00–15: all files exist. ✅
- Report 05 refers to `paper.ts:186-192` authority-seam comment: consistent with Report 07's authority-seam explanation. ✅
- Reports 05 / 09 / 13 all cite the reconciler's read-only invariant identically. ✅
- Report 06's SCRATCH-refund behavior on boot matches Report 12's schema-migration description. ✅
- Report 08's `maxDailyOrders=2000` migration matches the `KV_ORDER_CAP_MIGRATION` key in `risk.ts:84`. ✅

### Missing cross-references

- Report 14 (Testing) does not link to Report 08 (Risk) despite `tests/unit/risk.test.ts` existing.
- Report 04 (SLO) does not link to Report 08 (Risk) even though it asserts SLO uses the same risk gate.
- Report 10 (Strategies) does not link to Report 05 (Execution) despite the `Executor` contract being the only downstream interface.
- No report links to the appendices (`_appendix/*`) because they did not exist until this review.

---

## 5. Cross-Document Consistency

### Contradictions

| # | Where | Statement A | Statement B | Evidence |
|---|---|---|---|---|
| C1 | Reports 01, 03 vs `engine.ts:842` | KB calls the class `Engine` | Source uses `Edge5Engine` (`private static readonly SPOT_STALE_MS` is accessed as `Edge5Engine.SPOT_STALE_MS`) | `grep -n "Edge5Engine" lib/v2/engine/engine.ts` |
| C2 | Report 01 file listing | `eslint.config.js` | Actual filename is `eslint.config.mjs` | `find reference/p4 -maxdepth 1 -name "eslint*"` |
| C3 | Report 14 §Gaps | "Phase 0 sweep did not enumerate a `tests/` directory tree" | The tree exists with 28 files (see `_appendix/file-index.md`) | Repo listing |
| C4 | Report 15 §Gaps | "No documented runbook" | Eight top-level operator markdown docs exist (`OPERATIONS.md`, `PRODUCTION_SETUP.md`, `TRADING_GUIDE.md`, `QUICK_START.md`, `SETUP.md`, `DERIVE_CREDENTIALS.md`, `EXECUTION_LATENCY_OPTIMIZATION.md`, `docs/production-certification.md`) | Repo listing |
| C5 | Report 01 module map | Lists `proxy.ts` once | Two `proxy.ts` files exist: root Next middleware AND `lib/v2/engine/proxy.ts` | Repo listing |
| C6 | Report 10 §Two coexisting layers | Legacy `sniper` "kept alongside registry" | Never verified from `engine.ts` which one is default at boot; `tests/unit/sniper.test.ts` suggests it may still be first-class | See U4 |

Per instructions, contradictions are **not** resolved in Phase 0.

### Consistent pairs (spot-checked)

- Engine ↔ SLO — both attributed to the same `Executor` and same `RiskManager`. ✅
- Engine ↔ Execution — control API in Report 03 matches `Executor` contract in Report 05. ✅
- Execution ↔ Settlement — `creditSettlement(usd)` in paper mirrors bankroll credit in Report 06. ✅
- Settlement ↔ Accounting — WIN/LOSS/SCRATCH math consistent across Reports 06 and 07. ✅
- Accounting ↔ Dashboard — analytics endpoints in Report 02 consume `analytics.ts` per Report 07. ✅
- Risk ↔ Execution — Reports 05 and 08 both state placement must pass `checkOrder`. ✅
- Paper ↔ Live — same `Executor` contract, symmetric safety flows (cancel-replace, partial fill). ✅
- Architecture ↔ Runtime flow — module map and data-flow diagram in Report 01 align with tick sequence in Report 03. ✅

---

## 6. Missing Coverage

Full inventory in `_appendix/file-index.md`. Highest-impact gaps:

1. **Eight top-level operator docs unread.** `OPERATIONS.md`, `PRODUCTION_SETUP.md`, `TRADING_GUIDE.md`, `QUICK_START.md`, `SETUP.md`, `DERIVE_CREDENTIALS.md`, `EXECUTION_LATENCY_OPTIMIZATION.md`, `docs/production-certification.md`. Any of these may be authoritative operator runbooks that make Report 15's "no runbook" claim wrong.
2. **28 test files unread.** Report 14's disclaimer stands, but the test surface is now enumerable — a coverage matrix per production module is achievable in Phase 1 without further code changes.
3. **`scripts/` unread.** `audit-ledger.ts`, `replay-trade.ts`, `verify-all.mjs`, `derive-clob-credentials.mjs` — likely part of the operator/support toolchain.
4. **`config.ts` env schema not enumerated.** Every default the KB quotes ($12 drift padding, 5 min shares, `PAPER_STARTING_BALANCE`, `DB_PATH`, `CHAIN_ID`, `CLOB_HTTP_HOST`, `SIGNATURE_TYPE`, `POLY_*`) traces to `config.ts` without a `path:line` for the definition.
5. **Auth mechanism not quoted.** `dashboard-auth.ts` (133 LOC) and `api-auth.ts` (32 LOC) exist but no report shows what session/CSRF actually enforces.
6. **Shutdown path undocumented.** No dedicated section on `stop()`/`dispose()`, SIGINT handling in PM2, or the "in-flight order on shutdown" behavior.
7. **Direction Logic ↔ Token IDs.** No mapping of `UP`/`DOWN` to Polymarket `YES`/`NO` outcome tokens (see §7).
8. **`lib/v2/engine/proxy.ts` unread.** Distinct file from root `proxy.ts`; purpose is unknown from Phase 0.

---

## 7. Direction Matrix Validation

Required coverage: Signal, Trigger, SLO, YES, NO, Bull, Bear, Up, Down, Position, Outcome Token, Execution, Settlement, Accounting, PnL, Dashboard, Database.

| Representation | Where in KB | Evidence |
|---|---|---|
| Up / Down | Reports 00, 03, 05, 06, 10 | `types.ts:26` `TradeSide = "UP" | "DOWN"` |
| Position | Report 03 (field `position`), Report 06 | `engine.ts:113` |
| Execution | Report 05 (`Executor.placeOrder`, `Side.BUY`) | `live.ts` — always `Side.BUY`; direction encoded via `tokenId` |
| Settlement | Report 06 (WIN/LOSS/SCRATCH per side) | `engine.ts:1221` |
| Accounting | Report 07 (bankroll debit/credit per fill) | `bankroll.ts` |
| PnL | Report 06 (WIN payout = `shares × 1.00`; LOSS = `-cost`; SCRATCH = 0) | `db.ts` schema |
| Dashboard | Report 02 (`ledger.tsx`, `live-account.tsx`) | `LiveAccountOrder.outcome`, `LiveAccountTrade.outcome` |
| Database | Report 12 (`trades.side TEXT`) | `db.ts:87-102` |
| Signal | ❌ Not called out as a distinct concept | — |
| Trigger | ⚠️ Named in Report 04 (SLO `TRIGGERED` state) but not evidenced | — |
| SLO | Report 04 | `standing-order.ts` |
| **YES** | ❌ Never appears in the KB | — |
| **NO** | ❌ Never appears in the KB | — |
| Bull | ❌ Never appears | — |
| Bear | ❌ Never appears | — |
| **Outcome Token** | ⚠️ Mentioned as "binary outcome tokens" in Report 00; token id ↔ side mapping not traced | `market-discovery.ts` (unread body) |

**End-to-end trace status:**
- Paper V1 signal-to-ledger trace: **incomplete.** Reports 00→10→05→06→07→12→02 cover the chain by module, but no single report walks a single trade from strategy decision to `trades` row.
- Live V2 signal-to-ledger trace: **incomplete.** Same modules, same gap. Extra unverified step: how `TradeSide` maps to `tokenId` for the CLOB order (`live.ts:120-135` uses `req.tokenId` — the mapping to `UP`/`DOWN` is elsewhere and never quoted).

---

## 8. Synchronization Matrix Validation

Required columns per surface: source of truth, owner, update frequency, failure behavior, recovery behavior, conflict handling.

| Surface | Source of truth | Owner | Freq | Failure | Recovery | Conflict |
|---|---|---|---|---|---|---|
| BTC spot | ✅ (ref feed) | ✅ (`spotFeed`) | ⚠️ ("live") | ✅ (10s staleness → no trade) | ⚠️ not documented | ⚠️ not documented |
| CLOB best-ask | ✅ | ✅ (`ClobPriceFeed`) | ❌ ("stream") | ⚠️ not documented | ⚠️ (WS reconnect noted) | ❌ |
| Wallet balance | ✅ (exchange) | ✅ (executor) | ✅ (rollover + reconciler 60s) | ✅ (soft-fail, null) | ✅ (`setWalletUsd` seam paper; on-chain live) | ✅ ($1 drift tolerance) |
| Bankroll | ✅ (KV) | ✅ (`Bankroll` class) | ✅ (on fill + on settle) | ⚠️ | ✅ (SCRATCH sweep on boot) | ✅ (authority: ledger, not sim wallet) |
| Open orders | ✅ (exchange + engine belief) | ✅ (executor + reconciler) | ✅ (60s reconciler) | ⚠️ | ⚠️ (orphan cleaner noted) | ✅ (UNTRACKED = ERROR every cycle) |
| Ledger rows | ✅ (SQLite) | ✅ (`db.ts`) | ✅ (per event) | ⚠️ (write queue is async — failure logs to stderr) | ✅ (boot SCRATCH sweep) | ✅ (idempotent migrations) |
| KV state | ✅ (SQLite `kv`) | ✅ (`db.ts`) | ✅ (per write) | ⚠️ | ⚠️ (silent revert to defaults on typo — Report 15 §Watch) | ⚠️ |
| Kill switch | ✅ (`risk:killswitch`) | ✅ (`RiskManager`) | ✅ (on change) | ✅ (persisted) | ✅ (survives restart) | ✅ (OPERATOR vs BREAKER source) |
| Oracle sync guard | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ (module body unread) |
| Standing Limit Order | ✅ (KV + in-memory) | ✅ (`StandingOrderManager`) | ⚠️ (own clock) | ⚠️ (stuck-RESTING guard mentioned) | ⚠️ | ⚠️ |

**Assessment.** The KB covers the two most important sync surfaces (wallet, open orders) with all six required columns. Seven of ten surfaces are missing at least one column. Oracle sync guard is the largest gap — it is a trading-blocker and its behavior is asserted but never quoted.

---

## 9. Production Readiness Sanity Check

Re-reading `15-production-readiness.md` for recommendation-shaped language:

| Line/section | Sentence | Verdict |
|---|---|---|
| §Watch — "10s spot staleness" | *"worth measuring 99p feed gap in production before assuming this is conservative"* | Reads as a recommendation to future work — should be an open question. |
| §Watch — "PM2 memory ceiling" | *"verify the ceiling is high enough that legitimate warm-cache growth doesn't cause daily restarts"* | Recommendation. |
| §Gaps — "No documented runbook…" (two bullets) | Prescribes writing runbooks | Recommendation phrased as gap. **Also factually questionable** — see C4 above. |
| §Gaps — "Dashboard auth… Flag for Phase 2 security review" | Prescribes a future review | Recommendation. |
| §Gaps — "No live/paper comparison verdict yet" | Prescribes documenting acceptance criteria | Recommendation. |
| §Strengths | All 12 bullets | Observed facts with citations. ✅ |
| §Phase 0 conclusion | Descriptive statement + "Awaiting instructions" | ✅ |

**Finding.** Report 15 mostly holds to the "observations only" rule but its §Watch and §Gaps sections contain recommendation-shaped sentences that should be rewritten as open questions or moved to `_appendix/open-questions.md`. Not fixed in this phase per user instruction.

---

## 10. Remaining Unverified Items

Full list in `_appendix/open-questions.md` (18 U-items + 13 Q-items). Highest-priority to resolve before Phase 1:

- **U6** — Update Report 14 to reflect that the test tree exists (28 files).
- **U18 / C1** — Verify the actual engine class name (`Engine` vs `Edge5Engine`) and correct Reports 01/03.
- **U4 / Q1** — Determine whether `strategy/sniper.ts` or the registry is the default at boot.
- **Q12** — Trace `UP`/`DOWN` → `tokenId` → `YES`/`NO` mapping for the direction matrix.
- **U10** — Read `handlers/oracle-sync-guard.ts` and quote its threshold logic.
- **Q9** — Read the eight top-level operator docs before asserting "no runbook" in Report 15.

---

## 11. Repository Areas Requiring Future Engineering Investigation

Areas the KB flags implicitly or that this review surfaces as unknown from source-only reading:

1. **`config.ts` env schema.** Full env-var contract (name, type, default, required-per-mode) — needed before any environment can be reproduced.
2. **`lib/v2/engine/proxy.ts`** — engine-internal file distinct from the Next middleware; purpose unknown.
3. **`handlers/oracle-sync-guard.ts`** — trading-blocker whose thresholds are undocumented.
4. **`settlement-verifier.ts` and `settlement-repair.ts`** — money-moving repair path; trigger conditions and audit trail unclear.
5. **`accounting-verifier.ts`** — the ledger integrity formula.
6. **`watchdog.ts`** — stuck-tick / stuck-feed / stuck-executor thresholds.
7. **`app/api/v2/bot/*` route-level auth** — is every route gated by `api-auth.ts`?
8. **Direction mapping** — where `TradeSide` becomes `tokenId` for a specific outcome token.
9. **Standing Limit Order deep read.** 2489 LOC, only symbol-scanned; the highest single-module unresolved surface in the KB.
10. **Comparison/A-B harness** (`comparison.ts`) — schema, acceptance criteria for promoting paper → live.
11. **Operator scripts** (`scripts/audit-ledger.ts`, `scripts/replay-trade.ts`, `scripts/verify-all.mjs`) — what they mutate, when they should be run.
12. **Top-level operator markdown docs** — content unknown.

---

## 12. Final Recommendation

**PHASE 0 REQUIRES ADDITIONAL DOCUMENTATION.**

Evidence driving the verdict:

- Two of the four largest LOC modules (`standing-order.ts` at 2489 LOC, `engine.ts` at 1551 LOC) are covered at **symbol-scan depth**, not line-by-line — for a system whose safety story is written in inline comments (see `paper.ts:186-192`, `db.ts:157-166`, `risk.ts:55-63`), this is not sufficient for Phase 1 implementation grounding.
- **28 test files** and **8 operator runbook documents** were never opened; both directly affect Report 14 and Report 15's conclusions and one of them (C4) contradicts a stated Phase-0 gap.
- **Direction Matrix** is missing `YES`/`NO` and outcome-token-id mapping — required by the user's own checklist.
- **Auth mechanism** and **`config.ts` env schema** are asserted without evidence, blocking any Phase 1 change that touches those surfaces.
- **6 factual contradictions** (§5, C1–C6) exist between the KB and the source. None were resolved in this phase per user instruction, but all must be resolved before Phase 1 makes decisions using the KB as truth.

**Suggested Phase 0.5 (documentation-only, no code changes).** Not undertaken in this review; listed here per the user's request for evidence-backed conclusions:

1. Resolve C1–C6 by reading the specific files named.
2. Read and index the 8 top-level operator docs → update Report 15 accordingly.
3. Read `handlers/oracle-sync-guard.ts`, `config.ts` (full env schema), `dashboard-auth.ts`, `api-auth.ts` → close U-items.
4. Line-by-line pass over `standing-order.ts` for a proper Report 04.
5. End-to-end direction trace: source of `tokenId` for a given `TradeSide` in one specific slot.
6. Enumerate `tests/` → per-module test-coverage matrix in Report 14.

---

## Stop

This review is complete. No production code was modified. No files under `reference/p4/` were modified. No file under `docs/knowledge/` other than this document and the two new appendices was modified. Awaiting explicit approval before continuing.
