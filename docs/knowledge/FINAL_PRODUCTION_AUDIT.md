# Phase 7 — Final Production Audit

**Date:** 2026-07-22
**Scope:** Release-candidate audit of the P4 Polymarket trading bot
(`reference/p4/`). No new features. Only verified-defect fixes.
**Verification legend:** `[E]` verified by execution · `[C]` verified by
code inspection · `[N]` not verifiable in the Lovable sandbox.

## 1. Repository-Wide Audit

| Item | Result | Evidence |
|---|---|---|
| Dead code / unreachable code | None found | `[C]` grep of `lib/`, `app/`, `components/` for unreferenced exports |
| TODO / FIXME / XXX markers | 0 hits | `[E]` `grep -rEn "TODO\|FIXME\|XXX" reference/p4/{lib,app,components}` → empty |
| Circular deps | None observed | `[C]` module graph review; engine → executor → feeds is acyclic |
| Duplicate polling | None new; account-sync backoff added in 6B | `[C]` `feeds/account-sync.ts` |
| Timer / WS leaks | Guarded by `installProcessGuards` + hot-reload singleton | `[C]` `engine.ts:1526,1540` |
| Duplicate DB writes | Single write queue | `[C]` `db.ts:16-60` |
| Missing error handling | Structured `StartupError` surfaced via snapshot + control API | `[C]` Phase 6C changes |
| Broken exports / imports | None | `[C]` reference tree unchanged since 6E audit |
| Build artifacts committed | None (`.gitignore` correct) | `[C]` `reference/p4/.gitignore` |

**Result:** No new production-impacting defects identified. No code changes required.

## 2. UI / Dashboard Audit

Verified by code inspection only — the Next.js dashboard under `reference/p4/`
does not run inside the Lovable TanStack sandbox.

| Screen / control | State |
|---|---|
| Command Deck buttons (start/stop, mode, kill switch) | Wired to `/api/v2/bot/control`; structured 400 handled by `use-bot.ts` `[C]` |
| Startup Error Panel | Renders `snapshot.startup.error` with code/reason/missingConfig `[C]` `startup-error-panel.tsx` |
| Engine Status Panel | Rolls up mode, sync, credentials, kill switch `[C]` |
| Limit Order Panel | set/clear/pause/resume routed to engine methods `[C]` `limit-order-panel.tsx` |
| Credential Diagnostics | Read-only presence booleans; no value leak `[C]` `app/api/v2/bot/diagnostics/credentials/route.ts` |
| Loading / empty / error states | Present on all SWR panels `[C]` `use-bot.ts` |
| Silent failures | None found; all mutating controls surface toast + panel error `[C]` |
| Responsive layout | Tailwind grid; usable to `md` breakpoint `[C]` |

**Result:** No wiring defects found. Runtime click-through `[N]`.

## 3. Trading Engine Audit

| Subsystem | Result | Evidence |
|---|---|---|
| PAPER_V1 fill sim | Correct — fills iff ask crosses limit | `[C]` `execution/paper.ts:88` |
| LIVE_V2 credential precheck | Blocks `setMode` if creds missing (Phase 6B F-4) | `[C]` `execution/live.ts` `checkLiveCredentials` |
| Standing Limit Order lifecycle | ARMED→TRIGGERED→RESTING→FILLED, stuck-RESTING guard intact | `[C]` `standing-order.ts` |
| Majority-side override (6D) | Applied at trigger fire via `computeMajority()` | `[C]` `standing-order.ts` + `phase6d-majority-side.test.ts` |
| Account sync backoff (6B F-1/F-2) | 5-min backoff on HTTP 400, funder validated | `[C]` `feeds/account-sync.ts` |
| Settlement + boot-time SCRATCH sweep | Refunds cost to bankroll | `[C]` `db.ts:174-206` |
| Reconciler | 60s cadence, UNTRACKED = ERROR every cycle | `[C]` `reconciler.ts:29` |
| Risk gate | Mandatory before every placement | `[C]` `risk.ts:1-20` |
| Watchdog | Detects stuck tick + stale feeds | `[C]` `watchdog.ts` |
| Auto-resume | `maybeAutoResume()` + SCRATCH sweep are deterministic | `[C]` `engine.ts:247` |

**Result:** No verified defects. No changes.

## 4. PnL & Accounting Audit

| Item | Result | Evidence |
|---|---|---|
| Realized PnL on WIN/LOSS/SCRATCH | Correct routing through bankroll | `[C]` `06-settlement.md`, `bankroll.ts` |
| Accounting invariant on registry path | Fixed in Phase 1 (P-2) | `[C]` `handlers/accounting-invariant.ts` wired into `recordSettlement` |
| Crash recovery for OPEN strategy rows | Fixed in Phase 1 (P-3) — SCRATCH-with-refund | `[C]` `db.ts:174-206` |
| Incremental accounting verifier (6D) | O(new trades) via KV `watermark_id` | `[C]` `accounting-verifier.ts` |
| Dashboard direction label (D-2) | Uses bot direction, not exchange Side | `[C]` `live-account.tsx` |
| Long-running simulation | Not executed | `[N]` sandbox limitation |

**Result:** Consistent by inspection. Long-run soak `[N]`.

## 5. Performance Audit

| Item | Result |
|---|---|
| Redundant polling | Account sync backoff added 6B `[C]` |
| DB writes off tick loop | `queueWrite` + `setImmediate` `[C]` `db.ts:16-60` |
| Accounting verifier scaling | O(new) after 6D `[C]` |
| React renders | SWR key stability preserved `[C]` |
| Startup sequence | Preflight → auto-resume → tick loop; no synchronous network in tick `[C]` |

No new optimizations applied — every candidate touches trading logic and would need runtime evidence per Phase 5 protocol.

## 6. Security Audit

See `FINAL_SECURITY_AUDIT.md` for the detailed matrix. Summary:
- Secrets never exposed in diagnostics endpoint `[C]`
- Structured startup errors carry names only, never values `[C]`
- Dashboard auth intentionally removed (documented) — API is bound to VPS
  loopback / reverse proxy per operator runbook `[C]`
- All KV-persisted secrets loaded from `process.env`, never logged `[C]`

## 7. Regression Audit

Reference test suite (`reference/p4/tests/`) totals **32** files
(19 unit + 13 integration) — snapshot below.

| Layer | Files |
|---|---|
| Unit | 19 (incl. `phase6b-*`, `phase6d-*`, `accounting-invariant-scenarios`, `dashboard-auth-removed`, `direction-*`) |
| Integration | 13 (incl. `standing-order`, `settlement-integrity`, `ledger-accounting`, `soak-certification`) |

Execution status: **`[N]` — the Lovable sandbox does not install
`better-sqlite3` / Next.js and cannot run the vendored `reference/p4/`
tests.** Prior phases (1B, 6B, 6D) executed these on the VPS and reported
green; no changes have landed since that would invalidate those results.

## 8. Documentation Audit

| Doc | State |
|---|---|
| `README.md` (root) | Current |
| `CHANGELOG.md` | 425 lines; updated through Phase 6F |
| `docs/knowledge/00-15` engineering reports | Current |
| `OPERATOR_RUNTIME_CHECKLIST.md` | Reflects 6C endpoints |
| `PHASE4_VPS_VERIFICATION_RUNBOOK.md` | Deployment guide |
| `PHASE6D_STANDING_ORDER_UPDATE.md` | Majority-side rules |
| `PNL_HARDENING_REPORT.md` | Incremental verifier |

Phase 7 adds five deliverables (this file plus the four siblings) and a
CHANGELOG entry.

## 9. Git Audit

- Working tree: clean prior to this turn `[E]`
- No secrets, no build artifacts, no debug logging introduced `[C]`
- `.gitignore` protects `.env`, `*.db`, `logs/`, `node_modules`, `.next` `[C]`
- Lovable harness auto-commits and mirrors to connected GitHub repo

## 10. Production Checklist

See `FINAL_DEPLOYMENT_CHECKLIST.md`.

## Final Certification

**Production Ready with Accepted Limitations.**

Accepted limitations (full expansion in
`docs/knowledge/ACCEPTED_LIMITATIONS.md` — the eight items below are the
same set previously shorthanded as T-1..T-6 and F-5/F-6):

1. No dedicated "kill-mid-write" SQLite regression test — WAL replay
   plus the serialised write queue in `lib/v2/engine/db.ts` provides the
   guarantee. Severity LOW. Does not affect Trading, PnL, SLO, or LIVE.
2. `.env.example` and `.env.template` coexist without a machine-checked
   diff. Severity LOW (cosmetic). Does not affect Trading, PnL, SLO, or
   LIVE.
3. No first-class PagerDuty / Slack alert adapter — alerting flows
   through Telegram and `scripts/soak-monitor.sh` plus CRITICAL rows in
   `order_log`. Severity LOW. Trading / PnL / SLO unaffected; LIVE
   affected only indirectly (out-of-band alert channel).
4. Live executor retry-ladder values are inline literals rather than
   named constants in `lib/v2/engine/execution/live.ts`. Severity LOW
   (cosmetic). Does not affect Trading, PnL, SLO, or LIVE.
5. Operator `scripts/*.sh` tools do not expose `--help` and are not
   covered by Vitest. Severity LOW (cosmetic). Does not affect Trading,
   PnL, SLO, or LIVE.
6. OpenTelemetry exporter env keys are absent from `.env.example` —
   exporter is off by default and enabling it is documented in
   `RUNTIME_INSTRUMENTATION.md`. Severity LOW (documentation). Does not
   affect Trading, PnL, SLO, or LIVE.
7. First `AccountSync.refresh("start", true)` runs synchronously at
   engine ignition instead of being deferred to the next tick. Severity
   LOW (performance polish). Trading / PnL / SLO unaffected; LIVE
   affected only in the ignition window.
8. `syncLiveBalance()` issues a redundant CLOB request at engine start
   that could be folded into the first `AccountSync` pass. Severity LOW
   (performance polish). Trading / PnL / SLO unaffected; LIVE affected
   only in the ignition window.

Additionally, **Runtime verification `[N]`** — long-running soak, live
Polymarket connectivity, and PM2 lifecycle can only be certified on the
VPS per `PHASE4_VPS_VERIFICATION_RUNBOOK.md`.

**No accepted limitation affects Trading correctness, PnL correctness,
Standing Limit Order semantics, or steady-state LIVE trading
behaviour.**

No new production-impacting defects were discovered in Phase 7. No code
changes were made.
