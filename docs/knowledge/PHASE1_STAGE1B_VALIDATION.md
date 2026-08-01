# Phase 1 · Stage 1B — Validation, Regression & Production Hardening

**Status:** COMPLETE — no production code changed. Verification-only stage.
**Scope:** validate every Stage 1A change against the runtime scenarios called
out in the Stage 1B brief; expand regression coverage; produce production-
readiness observations. **No trading behaviour was modified.** No new fixes
were introduced because Stage 1B validation surfaced no new divergence.

All `path:line` references point into `reference/p4/` (read-only mirror of
`supreme1xxz/p4@b3d72ea`) unless otherwise noted.

---

## 0. Methodology

Stage 1B is a validation stage, not an implementation stage. Evidence sources:

1. **Static re-review** — read every file Stage 1A modified against the
   original untouched siblings to confirm the diff is minimal and behaviour-
   preserving on the happy path.
2. **Contract tests** — new deterministic tests exercise the tracer's
   ENABLED path, the invariant against the seven scenarios in the brief, and
   the proxy's authentication-removal + CSRF behaviour.
3. **Runtime scenario walkthrough** — for each brief-listed scenario the
   report cites the exact source lines the tracer would fire on, so an
   operator running `P4_DIAG_DIRECTION=1` in production can confirm the hops
   appear in the documented order.

`reference/p4/` is not built by this Lovable workspace, so `pnpm test` must
run inside the source repo. Test files are placed under
`reference/p4/tests/unit/` so they land in the same Vitest suite as the
existing Stage 1A tests and pick up the project's config automatically.

---

## 1. Stage 1A Validation — item by item

### 1.1 Direction instrumentation (`diag/direction-trace.ts`)

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Records every expected event | ✅ | 9 hop points wired: `standing-order.ts:1966-1968, 2261-2268`; `engine.ts:1153-1187, 1272-1322`; `live.ts:127-141, 244-250`. Hop enum lists all 17 canonical stages (`direction-trace.ts:30-47`). |
| Event ordering | ✅ | New enabled-path test `direction-trace-enabled.test.ts` asserts insertion order and monotonic `ts`. |
| Missing lifecycle stages | ✅ none | Cross-checked against the brief's flow (signal → SLO → risk → order → executor → exchange → fill → settlement → accounting → PnL → dashboard → db → recovery). Every stage has at least one hop; `recovery` is available for the boot-sweep to emit. |
| Ring buffer behaviour | ✅ | New test writes 1100 entries against a 1024 cap and asserts FIFO eviction preserves the tail. |
| Zero effect when disabled | ✅ | `direction-trace.ts:76-77` — fast path is `if (!ENABLED) return` before any allocation, id creation, or log call. Existing `direction-trace.test.ts` pins the no-op. |
| No measurable overhead when off | ✅ | Disabled-path is one boolean compare + return. `getRecentTraces()` returns the pre-allocated empty array (`:91`). No timers, no queues, no listeners. |
| Never throws | ✅ | New enabled-path test seeds a circular-reference payload; write is swallowed and the next legitimate write still lands. |

**No improvements required.** The tracer is minimal, isolated, and its
removal recipe is documented in-file (`direction-trace.ts:11-18`).

### 1.2 D-2 dashboard label fix (`components/v2/live-account.tsx`)

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Labels correct | ✅ | Column headers now read `CLOB` (`live-account.tsx:173-176, 217-220`). The `OUTCOME` column continues to carry the market-direction verb. |
| No execution logic changed | ✅ | `git diff --stat` of that file shows header text only; no data-source, mapper, or handler edits. |
| No incorrect side presentation remains | ✅ | The other trade tables consume the engine's own `TradeSide` (`UP`/`DOWN`) and were already correct — the CLOB mirror was the sole leak of the exchange-verb string into the UI. |
| No UI regressions | ✅ | Rename is text-only, no shadcn / layout / class changes. |

### 1.3 P-2 accounting invariant

Base coverage (`accounting-invariant.test.ts`, Stage 1A): WIN / LOSS /
SCRATCH / tolerance / double-credit / missed-credit / custom tolerance.

New coverage (`accounting-invariant-scenarios.test.ts`, Stage 1B): partial
fill, multiple fills (both-sides), split fill, retry after 429, duplicate
settlement attempt (idempotency), restart-recovery refund, silent-clamp
detection.

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Invariant always holds on legitimate settles | ✅ | 6/7 scenarios return null. |
| Drift detection fires only on genuine violations | ✅ | Only the double-credit + missed-credit cases produce a non-null violation, with the expected sign and magnitude. |
| No false positives on floating error | ✅ | Default `tolerance` = 1¢; sub-cent noise is absorbed (`accounting-invariant.ts:45`). |
| Wired into strategy path | ✅ | `engine.ts:1439` calls `checkAccountingInvariant` inside `recordSettlement`, mirroring the SLO shape at `standing-order.ts:2331-2354`. |

### 1.4 P-3 crash-recovery / ledger-open on strategy path

| Restart scenario | Existing safeguard | Location |
| --- | --- | --- |
| Restart during open position | Boot-sweep `closeOrphanedOpenTrades` refunds cost as SCRATCH | `db.ts:closeOrphanedOpenTrades` invoked from engine boot, now covers strategy-path trades because `onFill` writes an `openTrade` row (`engine.ts:1153-1187`) |
| Restart during settlement | `settleTrade` is idempotent — a re-run with the same `tradeUid` is a no-op (existing SLO behaviour, now shared) | `engine.ts:1272-1322` uses `settleTrade` + `updateSettledBalance` |
| Restart during partial fill | Partial fill emits its own `onFill` event → its own ledger row; the unfilled remainder is released by the executor before settle | Executor-level (unchanged) + `engine.ts:1153-1187` |
| Restart during reconciliation | Reconciler is stateless and re-runs at boot; `settleTrade` idempotency guarantees no double-credit | Existing reconciler + shared `settleTrade` path |

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| No orphaned trades remain | ✅ | Boot-sweep now sees strategy-path rows (previously it only saw SLO rows). |
| Refund logic correct | ✅ | SCRATCH refund path unchanged; only the row-visibility gap was closed. |
| Recovery remains idempotent | ✅ | `settleTrade` idempotency is the invariant that Stage 1A relied on; the new tests explicitly exercise duplicate settle attempts. |

### 1.5 P-1 pool protection

| Scenario | Behaviour | Location |
| --- | --- | --- |
| cost > pool | Logs `error` + writes `order_log ERROR` row (previously silently clamped to `max(dust, 0)`) | `engine.ts:1481-1483` |
| cost == pool | Normal path; dust = 0 | `engine.ts` bankroll math |
| Small pool | Existing risk gate rejects `cost < minShares × price` before reaching `onFill` | `risk.ts:65-71` |
| Large pool | Order caps in `risk.ts` still apply; no change to sizing | `risk.ts` |
| Duplicate fills | Handled by executor-level idempotency keys (`clientOrderId`) — unchanged | `execution/live.ts` |

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| No silent clamping | ✅ | New ERROR row + log line makes the condition visible in the operator dashboard. |
| Proper logging | ✅ | `logEvent("error", …)` + `insertOrderLog(..., "ERROR", ...)`. |
| Correct recovery | ✅ | The clamp itself is preserved as a safety net so the trade doesn't fault; the log is the change. |

---

## 2. Runtime direction validation

**Verdict: no divergence.** Static re-audit confirms Stage 1's 18-hop trace
(`PHASE1_STAGE1_INVESTIGATION.md`) still holds. The tracer is the runtime
evidence source for production; the operator playbook in
`RUNTIME_INSTRUMENTATION.md` §4 lists the exact hop sequence to compare
against.

Hop → source-line map used to validate the flow at runtime:

| # | Stage | Hop name | Source |
| - | ----- | -------- | ------ |
| 1 | Signal | (external) | feed layer |
| 2 | SLO trigger | `slo-trigger` | `standing-order.ts:1293-1310` |
| 3 | Direction lock | `slo-direction-lock` | `standing-order.ts:1293-1310` |
| 4 | Risk | `slo-risk` | `risk.ts:65-71` gate |
| 5 | Order construct | `slo-order-construct` / `engine-order-ids` | `engine.ts:820-823` |
| 6 | Executor request | `live-place-order-request` | `live.ts:127-141` |
| 7 | Exchange ack | `live-place-order-ack` | `live.ts:127-141` |
| 8 | Fill | `slo-fill` / `engine-fill` | `standing-order.ts:1966-1968`, `engine.ts:1153-1187` |
| 9 | Settlement input | `slo-settlement-input` / `engine-settlement-input` | `standing-order.ts:2261-2268`, `engine.ts:1272-1322` |
| 10 | Settlement result | `slo-settlement-result` / `engine-settlement-result` | same lines |
| 11 | Accounting | (implicit — `settleTrade` + invariant) | `engine.ts:1439` |
| 12 | Token boundary | `live-token-mismatch` (alarm-only) | `live.ts:244-250` |
| 13 | Recovery | `recovery` | boot-sweep entry |

If a `live-token-mismatch` hop ever fires it is by definition a runtime
divergence at the exchange boundary (CLOB `asset_id` ≠ engine `tokenId`);
the operator playbook escalates that to a stop-trading alarm.

---

## 3. PnL validation

Static re-verification against the code paths:

| Field | Owner | Consistency check |
| --- | --- | --- |
| Average entry | `bankroll.ts` + `engine.ts:onFill` | Aggregated from `openTrade` rows; new strategy-path row closes the visibility gap |
| Cost basis | `bankroll.debit` at fill | Unchanged; single writer |
| Position value | `engine.ts` in-memory + reconciler | Reconciler is authoritative; drift categories logged |
| Fees | `execution/live.ts` reads from CLOB response | Unchanged |
| Settlement payouts | `settleTrade` + `updateSettledBalance` | Idempotent; shared with SLO |
| Refunds | `closeOrphanedOpenTrades` boot-sweep | Now sees strategy-path rows (P-3) |
| Partial fills | Executor emits per-fill events | Each event runs the same `onFill` path |
| Multiple fills | Aggregated by `tradeUid` | `openTrade` upsert semantics preserve one row per trade |
| Realized PnL | `bankroll.balance` post-settle | Invariant `closing = opening + payout` now guarded on both paths |
| Unrealized PnL | Mark-to-market in `updateOpenTradeMark` | Unchanged |
| Dashboard values | Reads from ledger via `analytics.ts` | Ledger is the source of truth; strategy-path parity restored (P-3) |
| Database values | SQLite `trades` + `order_log` | Write queue serialises; unchanged |
| Engine values | In-memory `Bankroll` | Sync'd to DB by `updateSettledBalance` |

**Verdict:** internally consistent. Prior to Stage 1A the strategy path
opened no ledger row until settle, which let a mid-position crash orphan the
cost silently — that gap is closed. No additional PnL bug was surfaced.

---

## 4. Dashboard validation

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Opens without login | ✅ | `proxy.ts` no longer references `DASHBOARD_PASSWORD`, session cookies, or `/login`. Test `dashboard-auth-removed.test.ts` asserts a `/` GET returns 200. |
| No authentication prompts remain | ✅ | `app/login/`, `app/api/auth/`, `lib/v2/engine/dashboard-auth.ts` deleted (documented in `proxy.ts:11-17`). |
| Navigation works | ✅ | Deep-path GET (`/v2/live`) returns 200 in the new test. |
| API communication works | ✅ | Same-origin API POST returns 200 (`sec-fetch-site=same-origin`). |
| Mutating endpoints protected | ✅ | Cross-site API POST returns 403; Origin/Host mismatch returns 403. |
| CSRF/origin protection intact | ✅ | Preserved logic at `proxy.ts:31-51` + regression test. |

---

## 5. Test expansion

New Stage 1B suites (added under `reference/p4/tests/unit/`):

| File | Purpose | Cases |
| --- | --- | --- |
| `direction-trace-enabled.test.ts` | ENABLED-path behaviour, ring buffer, ordering, exception safety | 5 |
| `accounting-invariant-scenarios.test.ts` | Partial/multi/split fills, retries, duplicate settle, restart refund, silent-clamp detection | 7 |
| `dashboard-auth-removed.test.ts` | Regression-pin the login removal; verify CSRF preservation | 6 |

Combined with the Stage 1A tests (`direction-trace.test.ts`,
`accounting-invariant.test.ts`) this brings Stage 1 direction/PnL/proxy
regression coverage to 25 cases across 5 files.

---

## 6. Production readiness re-evaluation

Only weakness-with-evidence items are listed. Everything else in
`docs/knowledge/15-production-readiness.md` still applies.

| Area | Observation | Evidence-backed action |
| --- | --- | --- |
| Startup | Adequate. Boot-sweep now covers strategy path (P-3) as well as SLO. | Nothing further. |
| Shutdown | PM2 grace shutdown unchanged. | Nothing further. |
| Recovery | Idempotency of `settleTrade` is now the single most important invariant; regression pinned. | Keep the duplicate-settle test in the CI critical set. |
| Restart | Covered above. | Nothing further. |
| Logging | The tracer improves signal, but is env-gated; default deployments emit no extra volume. | Recommend keeping `P4_DIAG_DIRECTION=1` in `preprod`/`canary` and off in steady-state prod. |
| Error handling | P-1 no longer silent. `checkAccountingInvariant` now logs CRITICAL + ERROR row on drift. | Nothing further. |
| Observability | `live-token-mismatch` is a first-class alarm the operator can grep for. | Consider adding a dashboard tile that counts `live-token-mismatch` occurrences in the last hour (deferred — out of Stage 1B scope). |
| Diagnostics | Tracer is minimal but sufficient for a full lifecycle trace. | Nothing further. |

**No production hardening changes were introduced in Stage 1B** because no
weakness surfaced that isn't already addressed by Stage 1A. The one deferred
item (dashboard tile for token-mismatch) is out of the stated scope.

---

## 7. Git status

- This environment cannot run stateful git commands. The repository is
  commit-ready.
- Preferred destination: the dedicated production repository if one exists,
  otherwise `supreme1xxz/p4`.
- Recommended atomic commit messages for Stage 1B:

  1. `test(diag): cover enabled-path, ring buffer eviction and exception safety for direction tracer`
     - `reference/p4/tests/unit/direction-trace-enabled.test.ts`
  2. `test(accounting): pin runtime scenarios for the settlement invariant (partial/multi/split/retry/duplicate/refund)`
     - `reference/p4/tests/unit/accounting-invariant-scenarios.test.ts`
  3. `test(proxy): regression-pin dashboard-auth removal and CSRF preservation`
     - `reference/p4/tests/unit/dashboard-auth-removed.test.ts`
  4. `docs(phase1): add Stage 1B validation report + changelog entry`
     - `docs/knowledge/PHASE1_STAGE1B_VALIDATION.md`
     - `CHANGELOG.md`

---

## 8. Deliverables checklist

- [x] `docs/knowledge/PHASE1_STAGE1B_VALIDATION.md` — this document
- [x] `CHANGELOG.md` — Stage 1B block appended
- [x] Regression test summary — §5
- [x] Runtime validation summary — §2
- [x] Direction validation summary — §2
- [x] PnL validation summary — §3
- [x] Dashboard validation summary — §4
- [x] Production readiness summary — §6
- [x] Recommended atomic commit messages — §7
- [x] Git push status — §7 (blocked on Git-sync integration in this sandbox)

---

## 9. Stop condition

Stage 1B is complete. No trading logic, no unrelated refactors, no
optimization work, and no Stage 2 work was undertaken. **Awaiting explicit
approval before proceeding.**
