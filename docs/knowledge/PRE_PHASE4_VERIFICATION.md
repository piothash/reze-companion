# Pre-Phase 4 — End-to-End Production Verification

**Status:** Verification-only. No source code modified. No tests executed
in-sandbox (see §0 — environment constraints).
**Baseline:** Phase 1B (validated), Phase 2 (audit), Phase 3 (certified).
**Guiding rule:** *"If something cannot be verified in this environment,
explicitly state that it could not be verified."*

---

## 0. Environment Constraints (READ FIRST)

`reference/p4/` is a **read-only reference tree** of the production
Next.js 14 application. The Lovable sandbox that hosts this workspace is
a TanStack Start / Vite project — it does **not** run the P4 stack:

| Capability required | Available in this sandbox? |
|---------------------|----------------------------|
| `pnpm install` of the P4 dependency graph | **No** — sandbox uses `bun`, and P4 declares `pnpm@9` + `pnpm-workspace.yaml` |
| `better-sqlite3` native binding compile | **No** — no `node-gyp` toolchain configured for the reference tree |
| `next start` / `next dev` for the P4 dashboard | **No** — sandbox dev server is Vite for the host project only |
| PM2 process supervision | **No** — no PM2 in sandbox |
| Live Polymarket CLOB / WS connectivity | **Not attempted** — would require production credentials and would touch a real venue |
| Vitest run against `reference/p4/tests/**` | **No** — depends on installed P4 deps |

Consequence: every "Verified" row below is a **static** verification
(source read, evidence-anchored) unless explicitly marked
**Runtime-verified**. Every dynamic check is marked
**Not verifiable in this environment** with the reason.

---

## 1. V1 Paper Engine Verification

Source anchor: `reference/p4/app/v1/page.tsx`,
`reference/p4/lib/v2/engine/execution/paper.ts` (shared paper executor),
`reference/p4/lib/v2/engine/strategy/sniper.ts`.

| Check | Method | Result |
|-------|--------|--------|
| Engine starts successfully | Static — boot path via `instrumentation.ts` → `maybeAutoResume()` in `engine.ts` | ✅ Static |
| Engine stops cleanly | Static — SIGINT trap → `engine.dispose()`; PM2 `kill_timeout: 8000` | ✅ Static |
| Paper trading executes correctly | Static + Vitest suite `paper-executor.test.ts` (present, last-green in Stage 1B) | ✅ Static; runtime green last recorded in `PHASE1_STAGE1B_VALIDATION.md` §5 |
| Order lifecycle | Static — `Executor` interface; paper `place → fill → close` verified in `paper-executor.test.ts` | ✅ Static |
| Position lifecycle | Static — `openTrade` at fill, `closeTrade` at settle (P-3) | ✅ Static |
| PnL updates | Static — `handlers/accounting-invariant.ts` enforces `closing = opening + payout` | ✅ Static |
| Dashboard reflects state | **Not verifiable in this environment** — dashboard requires `next start` | ⚠️ Static only |
| No runtime errors / silent failures / stuck orders / duplicate orders / reconciliation problems / restart issues | **Not verifiable in this environment** — needs live engine run | ⚠️ Static only (no code paths flag issues; last soak run captured in `docs/knowledge/15-production-readiness.md`) |

**Finding:** No static evidence of regression against the Phase 1B
baseline. Runtime confirmation requires a live VPS / dev host with the
P4 dependency graph installed.

---

## 2. V2 Paper Engine Verification

Source anchor: `reference/p4/app/v2/page.tsx`,
`reference/p4/lib/v2/engine/engine.ts` (`Edge5Engine`),
`reference/p4/lib/v2/engine/standing-order.ts`,
`reference/p4/lib/v2/engine/strategy-registry/registry.ts`.

| Check | Method | Result |
|-------|--------|--------|
| Startup                    | Static — `Edge5Engine` phases OFFLINE→WAITING→PRIORITY_1→PRIORITY_2→STOPPING | ✅ Static |
| Shutdown                   | Static — `dispose()` cancels timers, closes sockets | ✅ Static |
| Paper execution            | Static — `execution/paper.ts` shared with V1 | ✅ Static |
| Signal generation          | Static — Edge1..Edge6 strategies present in `strategy-registry/strategies/` | ✅ Static |
| Standing order flow        | Static — `StandingOrderManager` + `feed-integrity.test.ts`, `handlers.test.ts` (last-green in Stage 1B) | ✅ Static |
| Accounting                 | Static — `handlers/accounting-invariant.ts` wired into `recordSettlement` (Stage 1A P-2) | ✅ Static |
| Settlement                 | Static — `settleTrade` + `updateSettledBalance` idempotent; scenario 6 covers orphan refund | ✅ Static |
| PnL                        | Static — 13 tracked fields validated in Stage 1B §3 | ✅ Static |
| Recovery                   | Static — boot SCRATCH sweep + `closeOrphanedOpenTrades` (P-3) | ✅ Static |
| Dashboard synchronization  | **Not verifiable** — requires live dashboard | ⚠️ Static only |
| Runtime stability          | **Not verifiable** — requires soak run | ⚠️ Static only (Stage 1B soak green) |

**Finding:** V2 remains at the Phase 1B baseline. No static regression
found.

---

## 3. Dashboard Verification

Source anchor: `reference/p4/components/v2/*` (12 panels),
`reference/p4/app/api/v2/bot/*` (12 route files).

| Check | Method | Result |
|-------|--------|--------|
| Panels present in source | Static ls of `components/v2/` — 15 files including `terminal-dashboard.tsx`, `command-deck.tsx`, `ledger.tsx`, `analytics-panel.tsx`, `live-account.tsx`, `market-monitor.tsx`, `intel-feed.tsx`, `feed-diagnostics.tsx`, `profiles-panel.tsx`, `strategy-configurator.tsx`, `system-panel.tsx`, `limit-order-panel.tsx`, `trade-replay-view.tsx`, `top-nav.tsx`, `number-field.tsx`, `use-bot.ts` | ✅ Present |
| API surface | Static ls — 12 `app/api/v2/bot/**/route.ts` endpoints (analytics, audit, control, database, health, notifications, preflight, profiles, status, strategies, system, trades, trades/[id]/replay) | ✅ Present |
| Auth removed | Static — `dashboard-auth-removed.test.ts` pins behaviour; `app/login/`, `app/api/auth/**`, `lib/v2/engine/dashboard-auth.ts` deleted (Stage 1A) | ✅ Static |
| CSRF / Origin guard intact | Static — retained in root `proxy.ts` (Stage 1A) | ✅ Static |
| D-2 label fix (CLOB vs bot direction) | Static — `live-account.tsx` renamed SIDE → CLOB (Stage 1A) | ✅ Static |
| Broken buttons / non-responsive controls / UI inconsistencies / API failures / missing data / console errors / network errors | **Not verifiable in this environment** — requires live `next start` and browser session against the P4 dashboard | ⚠️ Not verifiable |

**Finding:** No static evidence of regression. Interactive verification
of every button/panel requires a running dashboard — must be executed on
the target VPS or a dev host with the P4 stack installed.

---

## 4. VPS Readiness

Source anchor: `reference/p4/ecosystem.config.js`,
`reference/p4/deploy/nginx-edge5.conf`, `reference/p4/.env.example`,
`reference/p4/PRODUCTION_SETUP.md`, `reference/p4/OPERATIONS.md`.

| Check | Method | Result |
|-------|--------|--------|
| Build completes                        | **Not runnable here** — `next build` in `reference/p4/` requires `pnpm install`. Last recorded green build referenced in operator runbooks. | ⚠️ Not verifiable |
| Startup procedure documented and valid | Static — `PRODUCTION_SETUP.md`, `QUICK_START.md`, `ecosystem.config.js` | ✅ Static |
| PM2 configuration correct              | Static — single-instance, `autorestart`, `exp_backoff_restart_delay`, `min_uptime`, `max_restarts`, `max_memory_restart: 512M`, `kill_timeout: 8000` | ✅ Static (Phase 2 §5) |
| Required env vars documented           | Static — `.env.example`, `.env.template`, enumerated in `PHASE0_COMPLETION_REPORT.md` | ✅ Static (T-2 minor duplication accepted) |
| Logging configuration correct          | Static — `logs/edge5.{out,err}.log`; `pm2-logrotate` documented inline | ✅ Static |
| Recovery procedures documented         | Static — `docs/knowledge/13-recovery.md`, `_appendix/operator-runbooks.md` | ✅ Static |
| Restart behaviour understood           | Static — Phase 2 §2 reliability matrix | ✅ Static |
| Deployment blockers                    | None identified statically | ✅ Static |

**Finding:** Deployment artefacts are internally consistent. A live VPS
run remains the only way to prove build + boot end-to-end.

---

## 5. Polymarket Data Flow Verification

Source anchor: `reference/p4/lib/v2/engine/feeds/*`,
`reference/p4/lib/v2/engine/execution/live.ts`,
`reference/p4/lib/v2/engine/reconciler.ts`.

| Stage | Method | Result |
|-------|--------|--------|
| Market discovery         | Static — `feeds/market-discovery.ts` | ✅ Static |
| Market loading           | Static — same | ✅ Static |
| Price updates (REST)     | Static — `feeds/clob-price-feed.ts`, atomic `validatedQuotes` snapshot | ✅ Static |
| WebSocket subscriptions  | Static — `feeds/clob-ws-client.ts`, reconnect backoff verified in `feed-chaos.test.ts` | ✅ Static |
| Market synchronization   | Static — `_appendix/synchronization-matrix.md` (12 surfaces) | ✅ Static |
| Order submission         | Static — `execution/live.ts` post-only + EIP-712 + HMAC + idempotency key | ✅ Static |
| Signal generation        | Static — Edge1..Edge6 registry | ✅ Static |
| Risk evaluation          | Static — `risk.ts` `DEFAULT_LIMITS` + kill switch | ✅ Static |
| Execution flow           | Static + `execution-hardening.test.ts`, `execution-latency.test.ts` (present) | ✅ Static |
| Settlement flow          | Static — `settleTrade` idempotent; scenario 6 orphan refund | ✅ Static |
| Accounting updates       | Static — shared invariant | ✅ Static |
| Dashboard updates        | **Not verifiable** — requires live dashboard | ⚠️ Not verifiable |
| PnL calculations         | Static — 13 fields consistent | ✅ Static |
| **Live Polymarket CLOB / WS connectivity** | **Not attempted** — would require production credentials and would touch a real venue; explicitly out of scope for this environment | ⚠️ Not verifiable |

**Staleness / propagation gaps identified:** none new above Phase 1B
baseline. The reconciler pulls truth every 60s; feed staleness is handled
by the oracle guard (`handlers/oracle-sync-guard.ts`).

---

## 6. Runtime Verification

**All items in this section require a live engine run.** They cannot be
executed against `reference/p4/` from this sandbox.

| Surface | In-repo evidence | Runtime? |
|---------|------------------|----------|
| Errors / warnings / exceptions | `instrumentation-node.ts` crash handlers | ⚠️ Not verifiable |
| Memory leaks | PM2 `max_memory_restart: 512M`; dispose cleanup | ⚠️ Not verifiable |
| Resource leaks | Same as above | ⚠️ Not verifiable |
| Restart stability | PM2 `exp_backoff_restart_delay` + `min_uptime` | ⚠️ Not verifiable |
| Recovery behaviour | Boot SCRATCH sweep + `closeOrphanedOpenTrades` | ⚠️ Not verifiable (unit-tested in `accounting-invariant-scenarios.test.ts` case 6) |
| Background workers | Reconciler (60s), watchdog | ⚠️ Not verifiable (unit-tested in `reconciler.test.ts`, `watchdog.test.ts`) |
| Timers | `engine.ts` phase timers | ⚠️ Not verifiable |
| WebSocket reconnects | `feed-chaos.test.ts` covers | ⚠️ Not verifiable (unit-tested) |
| Database synchronization | WAL + serialized write queue | ⚠️ Not verifiable (see T-1) |

**Finding:** All static safeguards remain in place; unit coverage carries
forward from Stage 1B. Live runtime confirmation must occur on the VPS.

---

## 7. Regression Verification

Re-checked against Phase 3 baseline.

| Item | Evidence | Status |
|------|----------|--------|
| Direction tracing            | `lib/v2/engine/diag/direction-trace.ts` present; env-gated; `direction-trace.test.ts` + `direction-trace-enabled.test.ts` | ✅ Intact |
| Accounting invariants        | `handlers/accounting-invariant.ts` present; wired into `recordSettlement`; `accounting-invariant.test.ts` + `accounting-invariant-scenarios.test.ts` | ✅ Intact |
| Crash recovery (P-3)         | `Edge5Engine.onFill` calls `openTrade`; boot `closeOrphanedOpenTrades` sweep | ✅ Intact |
| Dashboard auth removal       | `dashboard-auth-removed.test.ts` present; `app/login/`, `app/api/auth/**`, `dashboard-auth.ts` absent | ✅ Intact |
| CSRF protection              | Retained in `proxy.ts` (root Next middleware) | ✅ Intact |
| Runtime diagnostics          | Direction tracer + accounting log + P-1 defensive log + reconciler categories + Telegram console — all retained per Phase 3 §2 | ✅ Intact |
| Existing regression tests    | 15 unit suites present under `reference/p4/tests/unit/`; 13 integration suites present under `reference/p4/tests/integration/` — none removed | ✅ Present (last full green: Stage 1B §5) |

No regression detected.

---

## 8. Outstanding Issues

None new. The six Phase 2 T-items (T-1..T-6) remain as **Accepted
Limitations** per Phase 3 §1 — all classified LOW; none affects
correctness, reliability, security, or maintainability with measurable
impact. No new issue was surfaced by this pre-Phase 4 pass.

---

## 9. Items That Could Not Be Verified In This Environment

Enumerated explicitly so nothing is assumed:

1. `pnpm install` and `next build` of `reference/p4/`.
2. Live `next start` — the P4 dashboard UI and every interactive control.
3. PM2 boot + restart + graceful-shutdown cycle on a real host.
4. `vitest run` against `reference/p4/tests/**` (last green captured in `PHASE1_STAGE1B_VALIDATION.md` §5).
5. Live Polymarket CLOB REST + WS connectivity, order submission, fills, settlements.
6. End-to-end Paper V1 and Paper V2 runs against the live venue's market data.
7. Soak / stability run beyond the Stage 1B duration.
8. External alerting delivery (Telegram, PagerDuty, Slack) — no adapter wired beyond Telegram env-gate.
9. Dashboard interactive verification (every button, every panel).

All of the above require the target VPS or a dev host with the full P4
dependency graph installed.

---

## 10. Overall Readiness Verdict

**VERIFIED WITH MINOR ISSUES**

**Justification:**

- Every item that can be statically verified against the repository is
  intact and at the Phase 1B / Phase 2 / Phase 3 baseline (§1–§7).
- No new regression, defect, or safety-critical gap was found.
- The "minor issues" qualifier reflects §9 — a broad set of runtime
  behaviours (dashboard interaction, `next build`, PM2 lifecycle, live
  venue connectivity, soak) cannot be exercised from this sandbox and
  must be re-verified on the VPS before Phase 4 begins any change with
  runtime impact.
- The six Phase 2 T-items remain Accepted Limitations; none blocks
  Phase 4.

**Recommendation:** Proceed to Phase 4 only after the operator confirms,
on the target VPS, that:

1. `pnpm install && pnpm build` completes cleanly.
2. `pnpm test` runs green end-to-end.
3. PM2 boot + `Edge5Engine` phase transitions observed in logs.
4. Dashboard loads, `/api/v2/bot/health` returns healthy, and Paper V2
   completes at least one full trade cycle against the live feed.

Until those four checks are green on the VPS, treat any Phase 4 runtime
claim as unverified.

**Stop.** No code modified. Awaiting explicit approval before any Phase 4
action or any fix related to items in §9.
