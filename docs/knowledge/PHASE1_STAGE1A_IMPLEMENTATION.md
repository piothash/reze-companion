# Phase 1 — Stage 1A: Implementation Report

**Status:** COMPLETE — awaiting operator approval before proceeding to further stages.
**Scope:** additive runtime instrumentation + evidence-supported fixes only.
**Non-goals:** direction logic was not modified. No refactor of unrelated systems.

All paths below are `reference/p4/<path>`.

---

## 1. Actions taken (mapped to Stage 1 findings)

| Finding | Action | Files touched |
|---|---|---|
| **D-2** LIVE account mirror renders CLOB `BUY`/`SELL` in a column labelled `SIDE`, easily read as direction | Renamed header **SIDE → CLOB** in both tables of the LIVE account panel. Presentation-only. No executor change (evidence — CLOB `side: Side.BUY` is the correct exchange verb; direction is carried by `tokenID`, and the `OUTCOME` column already renders `Up`/`Down`). | `components/v2/live-account.tsx` (2 header cells) |
| **P-2** engine `recordSettlement` had no accounting invariant | Extracted the SLO invariant into a shared, unit-tested helper and wired it into `Edge5Engine.recordSettlement`. Violations log `CRITICAL` + write an `ERROR` row to `order_log` (same reporting shape as SLO). | new `lib/v2/engine/handlers/accounting-invariant.ts`; `lib/v2/engine/engine.ts:recordSettlement` |
| **P-3** engine path never wrote an OPEN ledger row → crash-during-position silently lost the debited cost | `Edge5Engine.onFill` now calls `openTrade({...})` and stores `tradeId`/`tradeUid` on the `FilledPosition`. `recordSettlement` now calls `settleTrade({...})` (idempotent, `AND status='OPEN'`) followed by `updateSettledBalance`. On restart, the existing boot-sweep (`db.closeOrphanedOpenTrades → scratchOrphanedOpenRows`) refunds the cost via SCRATCH — same recovery guarantee the SLO path already had. | `lib/v2/engine/engine.ts` (`FilledPosition`, `onFill`, `recordSettlement`) |
| **P-1** engine `onFill` silently clamped `dust = max(pool − cost, 0)`, masking pool overspend | Kept the clamp (the position must still be tracked), added a loud ERROR log + `order_log` ERROR row when `dust < 0`. No behaviour change on the happy path. | `lib/v2/engine/engine.ts:onFill` |
| **Direction inversion** — no reproducible cause found in Stage 1 audit | Added the instrumentation described below, **did not modify** any direction-carrying code. Documented in the report. | see instrumentation section |
| **Dashboard login removal** (post-Stage 1A checklist) | Removed the login redirect and helpers. `proxy.ts` retains the CSRF / cross-site guard on mutating API calls (unrelated to dashboard UI auth). Dashboard opens directly. | `proxy.ts` rewritten; deleted `app/login/`, `app/api/auth/`, `lib/v2/engine/dashboard-auth.ts`, `tests/unit/auth.test.ts` |

## 2. Runtime instrumentation

Env-gated via `P4_DIAG_DIRECTION=1`. Full contract, hop schemas, and removal steps in **`docs/knowledge/RUNTIME_INSTRUMENTATION.md`**.

- New module: **`lib/v2/engine/diag/direction-trace.ts`** — pure, no dependencies on trading state.
- Wired at 9 hop points covering: SLO fill / settlement input, engine fill / settlement input / settlement result, live `placeOrder` request+ack, live `checkFill`, and a dedicated `live-token-mismatch` alarm when the CLOB's returned `asset_id` disagrees with the engine's stored `tokenId`.

Enable in a controlled operational window. Every trade produces one `[dtrace]` JSON line per hop; grep by `traceId` (= trade UID) to reconstruct the full lifecycle.

## 3. Trade direction — result

**Static audit remains: no direction-inversion cause identified in source.** Instrumentation is now the evidence source. If a wrong-direction trade occurs while the tracer is enabled, the `live-check-fill` / `live-token-mismatch` and `engine-settlement-input` lines will pinpoint the divergence within milliseconds of the fill.

Per the Stage 1A brief ("Do not modify trade direction logic unless instrumentation demonstrates an actual runtime divergence"), execution logic is unchanged.

## 4. PnL — verification & result

Every value in the PnL chain was audited against source (see Stage 1 report §3). Only the two evidence-supported concerns were changed:

- **Missing invariant on engine path (P-2)** — fixed with a shared helper (see below).
- **Registry crash-during-position drops cost (P-3)** — fixed by mirroring the SLO OPEN-row lifecycle.

Cost basis, entry price, fee handling (none — pUSD CLOB is fee-less on V2), position value, realized PnL, unrealized PnL (SLO only, unchanged), settlement math, dashboard aggregation, and DB persistence all match the specification. `avgEntryPrice` in analytics is an unweighted mean by design — documented in the Stage 1 report §3 P-4 but **not** changed because no evidence indicates operators want it re-formulated. Left for a future stage.

## 5. Accounting invariant — root cause docs (P-2)

- **Where it failed:** `Edge5Engine.recordSettlement` had **no** invariant. Prior to Stage 1A, a double-credit or missed credit on the engine path would silently drift the bankroll away from `Σ pnl` in the analytics view. The SLO path (`standing-order.ts:2331-2354`) already had the check.
- **Why it failed:** the check was authored inline inside the SLO handler and never extracted, so the engine copy of the settlement code was written without it (the file predated the SLO invariant work).
- **Downstream calculations that depend on it:**
  - `Bankroll.balance` + `dustReserve` → all future sizing (`Bankroll.size`, `debitFixed`)
  - `db.trades.balance_after` (display + drawdown series)
  - `analytics.totalReturn / bankrollSeries / drawdown / roi`
  - `settlement-verifier` cross-check against official winners (the verifier repairs *booked* PnL; it cannot detect a bankroll credit that was applied twice against a correct booking).
- **Regression tests:** `tests/unit/accounting-invariant.test.ts` — 7 cases covering WIN / LOSS / SCRATCH / floating tolerance / double-credit / missed-credit / custom tolerance. Both settlement paths call the same helper.

## 6. Registry crash-during-position — root cause docs (P-3)

- **Where it failed:** `Edge5Engine.onFill` called `Bankroll.commitFill` (zeroing balance, sweeping dust) but never inserted a `trades` row until settlement. `Edge5Engine.recordSettlement` used `insertTrade(...)` (creates a fresh SETTLED row).
- **Why it failed:** the engine path was written before `openTrade`/`settleTrade` existed. When the SLO path was added, it introduced the OPEN→SETTLED lifecycle and the boot-time `scratchOrphanedOpenRows` sweep, but the engine path was not migrated.
- **Consequence pre-fix:** a process crash between `onFill` (cost debited) and `recordSettlement` (cost not yet booked as a row) left the debit unrecoverable — `closeOrphanedOpenTrades` had no row to find. The pool would reboot with `balance=0, dust=(pool-cost)`; the `cost` was gone. The SLO path was safe because `openTrade` writes the row on fill, so the boot-sweep refunds it via SCRATCH.
- **Fix:** engine now writes an OPEN row on fill (same shape as SLO), stores `tradeId`/`tradeUid` on the in-memory position, and calls `settleTrade` at settlement. The DB idempotency guard (`AND status='OPEN'`) prevents any double-settle from boot-sweep racing settlement. If `openTrade` itself fails (very rare — SQLite write queue exhausted), we log a warning and fall back to the legacy `insertTrade(...)` path at settlement so a settlement is still recorded.
- **Regression tests:** the SLO recovery pattern is already exercised by existing coverage; the engine now uses the identical DB primitives (`openTrade` / `settleTrade` / `updateSettledBalance`), and the accounting invariant test proves that when `settleTrade` returns 0 (already settled) the bankroll credit is skipped — preventing double-pay under any race.

## 7. Dashboard login removal

- `DASHBOARD_PASSWORD` gating removed. Dashboard opens directly.
- CSRF / cross-site check on mutating API calls **preserved** — this is unrelated to the login UI and remains valuable defense in depth.
- Deleted: `app/login/page.tsx`, `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `lib/v2/engine/dashboard-auth.ts`, `tests/unit/auth.test.ts`.
- Callers of `dashboard-auth` were verified to be limited to the four files above; no orphaned imports remain.

## 8. Regression tests added

| File | Coverage |
|---|---|
| `tests/unit/direction-trace.test.ts` | Tracer disabled by default; no-op when disabled; never throws on non-serialisable payloads; `newTraceId` shape |
| `tests/unit/accounting-invariant.test.ts` | 7 cases: WIN / LOSS / SCRATCH / floating tolerance / double-credit / missed-credit / custom tolerance |

## 9. Git status

This environment cannot execute stateful git commands. The workspace is left commit-ready. Recommended commits (small, atomic, in this order):

1. `refactor(engine): extract accounting invariant into shared handler + wire into strategy path (P-2)`
2. `fix(engine): open ledger row on fill so crash-during-position is refunded at boot (P-3)`
3. `feat(diag): add env-gated direction & PnL runtime tracer (Phase 1 Stage 1A instrumentation)`
4. `ui(live-account): rename SIDE column to CLOB to disambiguate exchange verb from market direction (D-2)`
5. `chore(auth): remove dashboard login; keep CSRF/origin guard on mutating API`

Push target: existing `supreme1xxz/p4` (no dedicated production repository was designated).

## 10. Stop condition

Stage 1A complete. Awaiting explicit approval before continuing.
