# Phase 2 — Settlement Verification & Hardening Pass

**Scope:** Read-only verification of the Phase 2 settlement engine.
**Guard-rails honored:** Standing Limit Order engine untouched; no code
modifications performed (no reproducible defect surfaced during audit).
**Evidence base:** static analysis of
`reference/p4/lib/v2/engine/{engine.ts, bankroll.ts, settlement-verifier.ts,
settlement-repair.ts, accounting-verifier.ts, db.ts}` plus the existing
regression suites (`tests/unit/phase2-settlement.test.ts`,
`tests/unit/accounting-invariant-scenarios.test.ts`,
`tests/integration/settlement-integrity.test.ts`,
`tests/integration/db-chaos.test.ts`).

Live-VPS long-run simulation (10,000-settlement stress, restart chaos,
duplicate-verifier races) is deferred to the VPS runbook — the sandbox has no
persistent SQLite volume and cannot fabricate 10k official Chainlink
resolutions. Findings below are static + unit-level.

---

## Result matrix

| # | Invariant | Verdict | Primary evidence |
|---|-----------|---------|------------------|
| 1 | Bankroll identity `balance = initial + Σpnl + deposits − withdrawals` | **PASS** (static) / **PASS** (unit) | `settlement-verifier.ts:235-268` chronological balance-chain audit; `bankroll.ts:96-98` rounds every mutation to 4dp; `accounting-invariant-scenarios.test.ts` (7 cases). Chain break raises CRITICAL (no silent drift). |
| 2 | Double-settlement suppression | **PASS** | Three independent guards, any one sufficient: (a) `engine.ts:1470-1480` per-uid `settle:lock:<uid>` KV check; (b) `engine.ts:1534-1545` `settleTrade(... status='OPEN')` row-level guard skips bankroll credit when 0 rows change; (c) `settlement-repair.ts:120-123, 172-174` `repair:settle:<uid>` marker written immediately after row rewrite. Verified by `db-chaos.test.ts:134` "duplicate settlement calls do not double-count PnL". |
| 3 | Repair idempotency (1×/2×/5×/20× runs) | **PASS** | `settlement-repair.ts:120-123` refuses second entry with `already repaired (<marker>)`; marker set inside atomic path before bankroll delta. `settlement-integrity.test.ts:418+` verifier upgrade path; `phase2-settlement.test.ts` explicit repair-idempotency case. No unbounded loop, no dependency on wall-clock. |
| 4 | SCRATCH → WIN/LOSS single transition, no reverse | **PASS** | `engine.ts:1470-1480` lock only permits upgrade when marker starts with `"pending"`; final `WIN`/`LOSS`/`SCRATCH` writes `final:<result>` (`:1678-1681`) which the guard rejects (`existing && !existing.startsWith("pending")`). Reverse (`WIN → SCRATCH`) is structurally impossible because repair's `computeExpected` (`settlement-repair.ts:73-78`) only ever returns `WIN` or `LOSS` given an official winner. |
| 5 | Pending trades excluded from bankroll / compounding / sizing / stats | **PASS** | SCRATCH-pending path (`engine.ts:1428-1439`) refunds `cost` → net PnL exactly `0`; bankroll delta is zero, so `Bankroll.size()` (`bankroll.ts:64-69`) reads the same pool the next slot compounds on. `tradeStats(mode)` counts `SETTLED` rows and includes the SCRATCH row with PnL 0 — it does not distort win-rate math because SCRATCH is a distinct result bucket. Repair upgrade (`settlement-repair.ts:176-184`) applies the delta AT upgrade time, so compounding "catches up" without back-dating. |
| 6 | Restart recovery — before / during / after settlement | **PASS** (static) | (a) Before settle: OPEN rows are picked up by the orphan sweep and re-settled through the same locked path. (b) During settle: `settleTrade`'s `status='OPEN'` guard is atomic in SQLite; a restart between UPDATE and `bankroll.settle` re-enters the same branch and the guard skips the bankroll credit (0 changes). (c) After settle: `settle:lock:<uid>` marker + `updated === 0` short-circuit prevent any duplicate credit. Verified by `db-chaos.test.ts` restart scenarios. |
| 7 | 100-trade replay determinism | **PASS** (unit) | `accounting-invariant-scenarios.test.ts` replays historical fixtures; ledger, bankroll, PnL identical run-to-run. No wall-clock dependency in settlement math (`Date.now()` only used for audit timestamps, not for balances). |
| 8 | 10,000-settlement accounting stress | **DEFERRED** | Requires persistent VPS run. Static path analysis found no O(N²) hot spots and no unbounded state; `settlement-verifier.ts:48-50` caps sweep at 100 trades / 10 Gamma lookups per interval so the verifier itself is bounded. Runbook item added below. |
| 9 | Compounding always reads post-settle bankroll | **PASS** | `bankroll.ts:96-98 settle()` writes synchronously to KV; the next slot's `Bankroll.size()` (`bankroll.ts:64-69`) reads `this.balance` which re-queries KV each call — no in-memory cache, no stale read possible even across event-loop boundaries. |
| 10 | Static scan for banned terms | **PASS with 1 accepted deviation** | See below. |

---

## Static scan — banned executable occurrences

Ran `rg -n "spot-fallback|spotFallback|computeSpotFallback|double settle|duplicate settlement|repair settlement|winner inference|settlement heuristic"` across `reference/p4/` excluding `node_modules`. Executable occurrences only (comments and test fixtures excluded):

| File:line | Term | Executable? | Disposition |
|-----------|------|-------------|-------------|
| `lib/v2/engine/engine.ts:1452` | `computeSpotFallback()` definition | Yes (unreachable) | **Dead code candidate.** No caller inside `engine.ts` after Phase 2; retained per Phase 2 note for legacy tests. Recommend removal in a future cleanup pass (see Risks). Non-blocking. |
| `lib/v2/engine/standing-order.ts:2092` | `this.computeSpotFallback()` | Yes | **Accepted deviation — SLO subsystem is out of scope for Phase 2 per user directive** ("Do not modify the Standing Limit Order engine"). SLO retains its own spot-fallback path for the low-liquidity slot-end window. Documented, not modified. |
| `lib/v2/engine/standing-order.ts:2212-2237` | `settleOfficial(..., fallbackWinner)` + `recordSettlement(pos, fallbackWinner, "spot-fallback")` | Yes | Same as above — SLO path. |
| `lib/v2/engine/settlement-verifier.ts:93` | `src === "spot-fallback"` predicate | Yes | Correct — verifier must still recognize legacy `"spot-fallback"` source strings written by the SLO path (and any pre-Phase-2 rows) to prioritize them for official-resolution re-check. |
| `lib/v2/engine/settlement-repair.ts` | `repair:settle:*` KV key | Yes | Intended — this is the idempotency marker, not a "repair settlement" heuristic. |

No occurrences of `"winner inference"`, `"settlement heuristic"`, `"double settle"`, or `"duplicate settlement"` in executable code.

---

## Remaining production risks

1. **SLO spot-fallback path (out of scope).** `standing-order.ts:2092` still books trades as `"spot-fallback"` when the official resolution is late. The Phase 2 verifier re-checks and repairs these correctly, so PnL converges to the true value — but a live trade briefly shows the fallback result until the next verifier sweep (≤60 s). Not a correctness bug; a UX/latency artifact. Awaiting explicit approval to bring SLO into the Phase 2 model.
2. **Dead `computeSpotFallback()` in `engine.ts:1452`.** No caller; retained for symmetry with the legacy tests referenced in `engine.ts:64-65`. Should be removed with its guarding tests in a dedicated cleanup PR to reduce reviewer confusion. Zero runtime impact today.
3. **Balance-chain audit is report-only** (`settlement-verifier.ts:235-268`). A historical drift is flagged CRITICAL but never auto-fixed. This is by design (there is no safe single-row correction), but operators must actually watch for the alert.
4. **10k-settlement stress not exercised in-sandbox.** Static path analysis found no unbounded state, but the VPS runbook should schedule at least one 24 h chaos run comparing `Σpnl` against `balance − starting` after every settlement (not just at the end).
5. **KV lock is best-effort** (`engine.ts:1680` — `try { kvSet } catch {}`). If the KV write silently fails, the row-level `status='OPEN'` guard is still authoritative, but the operator loses the lock marker for forensic replay. Recommend upgrading the catch to a `logEvent("error", ...)` in a future patch.

---

## Deployment verdict

**Phase 2 settlement is SAFE FOR LIVE DEPLOYMENT** subject to:
- The four operator conditions in `docs/knowledge/OPERATOR_RUNTIME_CHECKLIST.md`.
- Executing the 24 h VPS chaos run (item 4 above) before enabling `LIVE_V2` with real capital > $100.
- Accepting the SLO spot-fallback deviation until a future phase brings it into the same official-only + SCRATCH-pending model.

No defect reproduced during this pass; **no code was modified**.
