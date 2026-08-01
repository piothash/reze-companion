# Phase 2 — Production Readiness, Hardening & Deployment

**Status:** Audit complete. No production logic modified.
**Scope:** Audit-only Phase 2 pass over the baseline established by Phase 0/0.5 and Phase 1A/1B. This document is the single Phase 2 deliverable and rolls up every required sub-report (readiness checklist, reliability, security, deployment, diagnostics, tech debt, tests, git).
**Guiding rule (from the brief):** *"Only implement fixes supported by evidence."* Phase 2 surfaced no new evidence-backed defect above the Phase 1B baseline, so no production code changed in this phase. Every candidate item that appeared during the audit is recorded in §7 (Technical Debt Register) with evidence, risk, and priority for explicit approval before any Phase 3 work.

---

## 1. Repository-Wide Production Audit

Each subsystem was re-walked against its knowledge-base report and the code at
`reference/p4/`. "Readiness" is scored against the Phase 1B baseline; "Debt"
counts open items in §7 that touch this subsystem.

| # | Subsystem | Evidence anchor | Readiness | Debt | Notes |
|---|-----------|-----------------|-----------|------|-------|
| 1  | Trading Engine        | `docs/knowledge/03-trading-engine.md`, `reference/p4/lib/v2/engine/engine.ts` | READY | — | `Edge5Engine` phases + P-3 ledger opening verified in Stage 1B. |
| 2  | Standing Limit Orders | `docs/knowledge/04-standing-limit-order.md`, `reference/p4/lib/v2/engine/standing-order.ts` | READY | — | Invariant now shared with engine path (P-2). |
| 3  | Execution             | `docs/knowledge/05-execution.md`, `reference/p4/lib/v2/engine/execution/{live,paper}.ts` | READY | T-4 | Live post-only + HMAC verified; retry ladder documented. |
| 4  | Settlement            | `docs/knowledge/06-settlement.md`  | READY | — | Invariant covers both paths. |
| 5  | Accounting            | `docs/knowledge/07-accounting-and-pnl.md`, `handlers/accounting-invariant.ts` | READY | — | 7-scenario regression suite green in Stage 1B. |
| 6  | PnL                   | `docs/knowledge/07-accounting-and-pnl.md` | READY | — | 13 tracked fields consistent (Stage 1B §3). |
| 7  | Risk                  | `docs/knowledge/08-risk.md`, `reference/p4/lib/v2/engine/risk.ts` | READY | — | `DEFAULT_LIMITS` and kill-switch preserved. |
| 8  | Dashboard             | `docs/knowledge/02-dashboard.md`   | READY | — | Auth removed; D-2 label fixed. |
| 9  | Database              | `docs/knowledge/12-persistence.md`, `reference/p4/lib/v2/engine/db.ts` | READY | T-1 | WAL + write queue; migration ordering documented. |
| 10 | Synchronization       | `docs/knowledge/09-synchronization.md`, `_appendix/synchronization-matrix.md` | READY | — | 12 surfaces mapped. |
| 11 | Recovery              | `docs/knowledge/13-recovery.md`   | READY | — | P-3 closed the crash-during-position gap. |
| 12 | Configuration         | `reference/p4/lib/v2/engine/config.ts`, `.env.example` | READY | T-2 | Env schema enumerated in completion report. |
| 13 | Deployment            | `reference/p4/ecosystem.config.js`, `reference/p4/deploy/nginx-edge5.conf` | READY | — | PM2 recovery model verified. |
| 14 | Background workers    | `reference/p4/lib/v2/engine/reconciler.ts`, `watchdog` | READY | — | 60s reconciler + watchdog verified. |
| 15 | Scripts               | `reference/p4/scripts/`           | READY | T-5 | Operator scripts documented in `_appendix/operator-runbooks.md`. |
| 16 | Logging               | `instrumentation-node.ts`, PM2 log_rotate note in `ecosystem.config.js` | READY | — | pm2-logrotate documented inline. |
| 17 | Monitoring            | `scripts/monitor-15m.sh`, `scripts/soak-monitor.sh` | READY | T-3 | External alerting deferred. |
| 18 | Diagnostics           | `lib/v2/engine/diag/direction-trace.ts` | READY | — | Env-gated; see §6. |
| 19 | API routes            | `app/api/**`                       | READY | — | CSRF/origin guard intact. |
| 20 | Proxy (Next middleware) | `reference/p4/proxy.ts`         | READY | — | Auth removed; CSRF preserved. |
| 21 | OpenTelemetry         | `instrumentation.ts`               | READY | T-6 | Optional exporter env; documented. |
| 22 | PM2 configuration     | `ecosystem.config.js`              | READY | — | Restart policy, memory ceiling, kill_timeout verified. |
| 23 | Environment loading   | `.env.example`, `.env.template`, `config.ts` | READY | T-2 | See T-2 for env drift tooling. |

**Verdict:** All 23 subsystems meet the Phase 1B baseline. Remaining items in §7 are all classified below "correctness / reliability" and do not block production.

---

## 2. Reliability & Failure Audit

Each failure surface was re-verified against baseline evidence. No new
regressions found.

| Surface | Verified by | Result |
|---------|-------------|--------|
| Startup                       | `instrumentation.ts`, `instrumentation-node.ts` boot trap; `maybeAutoResume()` in `engine.ts` | ✅ |
| Shutdown                      | SIGINT trap → `engine.dispose()`; PM2 `kill_timeout: 8000` | ✅ |
| Restart                       | PM2 `autorestart`, `exp_backoff_restart_delay`, `min_uptime`, `max_restarts` | ✅ |
| Recovery                      | Boot SCRATCH sweep + `closeOrphanedOpenTrades` (Stage 1A P-3) | ✅ |
| Duplicate order prevention    | Post-only + idempotency key in `execution/live.ts` | ✅ |
| Duplicate fill prevention     | Fill dedupe map in `Edge5Engine.onFill` | ✅ |
| Duplicate settlement prevention | `settleTrade` + `updateSettledBalance` idempotent (Stage 1A P-3) | ✅ |
| Idempotency                   | Ledger row keyed by `tradeUid` | ✅ |
| Retry handling                | 429/timeout ladder in `execution/live.ts` | ✅ |
| Timeout handling              | Per-request AbortController; documented | ✅ |
| Network interruption recovery | Reconciler pulls truth on next tick (60s) | ✅ |
| Database consistency          | WAL + serialized write queue in `db.ts` | ✅ |
| Exchange synchronization      | `_appendix/synchronization-matrix.md` (12 surfaces) | ✅ |
| WebSocket reconnection        | Feed reconnect backoff verified in `feeds/` | ✅ |
| Memory cleanup                | Dispose cancels timers, closes sockets; PM2 `max_memory_restart: 512M` | ✅ |
| Resource cleanup              | Same as above | ✅ |
| Long-running stability        | PM2 + memory cap + pm2-logrotate operator note | ✅ |

**Outcome:** No new hardening implemented. All failure surfaces already
covered by Phase 1B tests or by verified in-source safeguards.

---

## 3. Stress & Edge Case Validation

Scope check against the brief — every item mapped to existing regression
coverage or explicitly deferred with justification.

| Scenario | Existing coverage | Action |
|----------|-------------------|--------|
| Multiple simultaneous SLOs        | `tests/unit/handlers.test.ts` + SLO invariant | Covered |
| High-frequency market updates     | `tests/unit/feed-chaos.test.ts`, `feed-integrity.test.ts` | Covered |
| Partial fills                     | `accounting-invariant-scenarios.test.ts` case 1 | Covered |
| Multiple fills                    | Same suite case 2                     | Covered |
| Restart during execution          | `direction-trace-enabled.test.ts` + P-3 recovery | Covered |
| Restart during settlement         | `accounting-invariant-scenarios.test.ts` case 6 (orphan refund) | Covered |
| Restart during reconciliation     | `tests/unit/reconciler.test.ts`       | Covered |
| Exchange disconnects              | `feed-chaos.test.ts`                  | Covered |
| WebSocket reconnects              | Same                                  | Covered |
| Database interruptions            | Write-queue serialization in `db.ts`; no dedicated test | Deferred → T-1 |
| Long-running engine operation     | Soak monitor script `scripts/soak-monitor.sh` | Covered (operational) |
| Concurrent order processing       | SLO + engine dedupe map               | Covered |

No defect exposed; no smallest-safe-fix required in this phase.

---

## 4. Documentation Synchronization

The following files are already synchronized with the current implementation
after Phase 1B; Phase 2 verified this and made no changes:

- `docs/knowledge/README.md` (16 report index)
- `docs/knowledge/03-trading-engine.md` — P-3 fill-time `openTrade` behaviour
- `docs/knowledge/07-accounting-and-pnl.md` — shared invariant helper
- `docs/knowledge/13-recovery.md` — orphan refund path covers strategy trades
- `docs/knowledge/RUNTIME_INSTRUMENTATION.md` — direction tracer + env flag
- `docs/knowledge/_appendix/errata.md` — authoritative line-number overlay
- `docs/knowledge/_appendix/synchronization-matrix.md`
- `docs/knowledge/_appendix/test-coverage-matrix.md`
- `docs/knowledge/_appendix/operator-runbooks.md`
- `CHANGELOG.md` — Phase 1A + 1B entries

Phase 2 adds only this report + the CHANGELOG entry.

---

## 5. Deployment Verification

Reviewed against the `reference/p4/` deployment artifacts.

| Concern | Evidence | Status |
|---------|----------|--------|
| PM2 process definition | `ecosystem.config.js:20-70` — single-instance, exp-backoff, 512M cap, 8s kill timeout | Verified |
| Environment variables  | `.env.example`, `.env.template`, enumerated in `PHASE0_COMPLETION_REPORT.md` | Verified |
| Startup scripts        | `next start -p 3000` via PM2; `instrumentation.ts` boot trap | Verified |
| Build process          | `package.json` `build` → `next build` | Verified |
| Logging                | `logs/edge5.{out,err}.log`; pm2-logrotate documented inline | Verified |
| OpenTelemetry          | `instrumentation.ts` optional exporter | Verified (env-gated) |
| Proxy                  | `deploy/nginx-edge5.conf` present | Verified |
| Configuration loading  | `lib/v2/engine/config.ts` central schema | Verified |

No deployment artifact inconsistency found.

---

## 6. Runtime Diagnostics Review

| Diagnostic | Location | Decision |
|------------|----------|----------|
| Direction trace ring buffer | `lib/v2/engine/diag/direction-trace.ts` | **Keep permanent, disabled by default.** Env-gated (`P4_DIAG_DIRECTION=1`), zero-alloc when off, 1024-entry FIFO, 17 hop points documented in `RUNTIME_INSTRUMENTATION.md`. High troubleshooting value; no cost when off. |
| Accounting invariant log    | `handlers/accounting-invariant.ts` | **Keep permanent, always on.** Only logs on violation (CRITICAL) and writes `order_log ERROR`. |
| P-1 defensive `cost > pool` log | `Edge5Engine.onFill` | **Keep permanent, always on.** Only logs on the abnormal branch. |
| Reconciler drift categories | `reconciler.ts`         | **Keep.** Already production-shape. |
| Telegram console            | `instrumentation-node.ts` | **Keep.** Operator alerting channel; already env-gated. |

No diagnostic slated for removal.

---

## 7. Technical Debt Register (Evidence-Backed, Non-Blocking)

Every item below was surfaced by the Phase 2 audit. None meets the brief's
"correctness / reliability / production stability / security / maintainability"
threshold for immediate action, and the brief mandates that speculative
changes be avoided. Recorded here for explicit prioritization before Phase 3.

| ID | Description | Evidence | Risk | Impact | Priority |
|----|-------------|----------|------|--------|----------|
| T-1 | No dedicated regression test for a mid-write DB interruption (SIGKILL between WAL write and checkpoint). | `lib/v2/engine/db.ts` write queue exists; no test file targets kill-mid-write. | Low — WAL replay handles this; SQLite guarantee. | Would only surface a defect if we deviated from serialized queue. | LOW |
| T-2 | `.env.example` and `.env.template` coexist without a documented diff. | `reference/p4/.env.example`, `reference/p4/.env.template` | Very low — operator confusion only. | Onboarding friction. | LOW |
| T-3 | External alerting (PagerDuty / Slack webhook) not wired; only `soak-monitor.sh` + Telegram exist. | `scripts/soak-monitor.sh`; no alerting adapter. | Low — Telegram covers primary channel. | Slower incident detection outside operator hours. | LOW |
| T-4 | Live executor retry ladder magic numbers are inline; not central config. | `execution/live.ts` retry loop | Very low — values are documented. | Tuning requires code edit. | LOW |
| T-5 | Operator scripts (`audit-ledger.ts`, `replay-trade.ts`) lack `--help` and Vitest coverage. | `reference/p4/scripts/` | Very low — read-only tools. | Operator learning curve. | LOW |
| T-6 | OpenTelemetry exporter is env-gated but sample OTEL env keys are not in `.env.example`. | `reference/p4/instrumentation.ts` | Very low. | Operator must consult code to enable OTEL. | LOW |

**Decision:** Per Phase 2 principles ("Do not add unrelated features",
"smallest safe change", "only evidence-backed improvements"), none of the
above are actioned in this phase. All are candidates for a scoped Phase 3
grooming pass if approved.

---

## 8. Security Review Summary

| Check | Evidence | Result |
|-------|----------|--------|
| Secrets not committed          | `.env.example` / `.env.template` contain only placeholders; no `.env` in tree | ✅ |
| Environment variables handled  | `config.ts` centralizes reads; no ad-hoc `process.env.*` in engine hot path | ✅ |
| Dashboard accessible without login | `proxy.ts` rewritten; `app/login/` deleted; `dashboard-auth-removed.test.ts` pins behaviour | ✅ |
| Mutating API enforces CSRF/origin | `proxy.ts` retains cross-site + Origin/Host guard; regression-pinned | ✅ |
| No unnecessary auth remnants   | `lib/v2/engine/dashboard-auth.ts`, `app/api/auth/{login,logout}` deleted | ✅ |
| No unintentional debug endpoints | No `/api/debug/*` routes found; direction-trace has no HTTP surface (in-memory only) | ✅ |

No security regression introduced by Phase 1; no new hardening required.

---

## 9. Test Suite

**Present suites (`reference/p4/tests/unit/`, 15 files):**

```
accounting-invariant-scenarios.test.ts   (Stage 1B)
accounting-invariant.test.ts             (Stage 1A P-2)
dashboard-auth-removed.test.ts           (Stage 1B)
direction-trace-enabled.test.ts          (Stage 1B)
direction-trace.test.ts                  (Stage 1A)
direction-verdict.test.ts                (pre-existing)
feed-chaos.test.ts                       (pre-existing)
feed-integrity.test.ts                   (pre-existing)
handlers.test.ts                         (pre-existing)
model-clock.test.ts                      (pre-existing)
paper-executor.test.ts                   (pre-existing)
reconciler.test.ts                       (pre-existing)
risk.test.ts                             (pre-existing)
sniper.test.ts                           (pre-existing)
watchdog.test.ts                         (pre-existing)
```

**Execution status in this environment:** `reference/p4/` is a
read-only reference tree; the Lovable sandbox does not install its
`pnpm` dependency graph (Next.js 14 + `better-sqlite3` native binding).
The full `vitest run` was last executed and captured in
`docs/knowledge/PHASE1_STAGE1B_VALIDATION.md` §5 (all green).
Phase 2 did not modify any production code or test file, so the Stage 1B
green result carries forward. No obsolete tests were found.

**Operator command (on a checkout with `pnpm install` completed):**

```
cd reference/p4 && pnpm test
```

---

## 10. Git Commit Summary & Push Status

Phase 2 introduces **documentation only**:

- `docs/knowledge/PHASE2_PRODUCTION_READY.md` (this file)
- `CHANGELOG.md` (Phase 2 entry appended)

**Recommended atomic commit:**

```
docs(phase2): production readiness audit + technical debt register
```

**Push status:** The Lovable workspace auto-commits and pushes each turn.
The connected `supreme1xxz/p4` repository is the single source of truth
(confirmed in the immediately preceding turn: `origin/main` and
`secondary/main` synced at commit `30d302f`). This Phase 2 commit will
land on the same remotes on the next commit boundary; no manual `git`
action is required or possible from the sandbox.

---

## 11. Production Readiness Checklist

- [x] Trading direction end-to-end verified (Stage 1A/1B)
- [x] PnL invariant enforced on both SLO and engine paths (P-2)
- [x] Crash-during-position ledger recovery closed (P-3)
- [x] Dashboard opens without login; CSRF guard intact
- [x] Direction tracer available behind env flag
- [x] PM2 restart policy + memory ceiling + graceful shutdown verified
- [x] Reconciler + watchdog operational
- [x] Boot-time SCRATCH sweep + orphan refund verified
- [x] Regression tests present for every Stage 1 change
- [x] Knowledge base synchronized with implementation
- [x] Deployment artifacts (PM2, nginx, env template) consistent
- [x] Security review clean (no secrets, no debug endpoints, CSRF preserved)
- [x] Technical debt register recorded with evidence, risk, priority

---

## Final Verdict

**PRODUCTION READY WITH MINOR KNOWN LIMITATIONS**

**Justification:** Every subsystem (§1), every reliability surface (§2), and
every stress scenario (§3) either already meets baseline or is covered by the
regression suite verified in Stage 1B. The six items in the Technical Debt
Register (§7) are all classified LOW — none affects correctness, reliability,
production stability, or security. Per the Phase 2 principle that changes must
be evidence-backed and speculative work is out of scope, those items are
recorded rather than implemented and await explicit approval before any
Phase 3 grooming pass.

**Stop.** Awaiting explicit approval before proceeding.
