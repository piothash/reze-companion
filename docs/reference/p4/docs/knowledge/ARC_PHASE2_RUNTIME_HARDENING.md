# ARC Production Reliability — Phase 2 (Runtime Hardening)

Evidence-based hardening pass. Three real defects found and fixed; everything else
verified and left untouched. `standing-order.ts` was **not** modified.

---

## ROOT CAUSES FOUND

### R-1 (Task 1) — Bot does not resume after a process restart until someone opens the dashboard
**Evidence.** `Edge5Engine`'s constructor is the only caller of `maybeAutoResume()`
(`lib/v2/engine/engine.ts:252`, `:270-279`), which re-ignites trading when
`kv[engine:running] === "1"`. The constructor only runs from `getEngine()`, and before
this phase `getEngine()` was reached **exclusively from HTTP route handlers**
(`app/api/v2/bot/*`) or a Telegram command (`telegram-console.ts:155`).
`instrumentation.register()` installed crash handlers and the Telegram console but
never touched the engine.

Consequence on a headless VPS: after any `pm2 restart`, deploy, OOM restart, or
`uncaughtException` exit, the Node process comes back up, serves HTTP, reports healthy
to PM2 — and **trades nothing** until a human loads a page. From the operator's seat
this is exactly "the bot stopped by itself", and it also explains why the bot appeared
to "come back to life" whenever the dashboard was opened.

**Fix** — `instrumentation.ts`: construct the engine in `register()` (nodejs runtime
only, skipped when `NEXT_PHASE === "phase-production-build"` so prerender workers never
open the ledger or start feeds; wrapped in try/catch so a construction failure logs
instead of killing boot). No engine logic changed — auto-resume, preflight gating and
the 5s grace period are the existing verified paths.

### R-2 (Task 1/6) — Duplicate crash handlers truncated the forensics of every stop
**Evidence.** Two independent registrations existed:
`installCrashHandlers()` (`instrumentation-node.ts`, guard `__edge5CrashHandlersInstalled`)
and `installProcessGuards()` (`engine.ts:1655`, guard `__botProcessGuards`). Different
flags → both installed. Node runs all `uncaughtException` listeners; the engine's
listener calls `process.exit(1)` **synchronously**, so the instrumentation handler's
richer diagnostics (stack + pid/uptime/RSS/heap) and its deliberate 2-second
stdout-flush grace period were cut off — the crash lines that would have explained an
unattended stop never reached PM2's log files.

**Fix** — `engine.ts`: `installProcessGuards()` now returns early when
`__edge5CrashHandlersInstalled` is set, before registering any listener. It remains a
full fallback for contexts where instrumentation never ran (tests, scripts, `tsx`).
Policy is unchanged: unhandled rejection → log + stay alive; uncaught exception → log +
exit(1) for a clean PM2 restart.

### D-1 (Tasks 3, 4, 5) — Opening/refreshing the dashboard mutated engine state
**Evidence.** `components/v2/terminal-dashboard.tsx` ran a mount effect:

```ts
if (snap.mode !== pipeline && !snap.running) {
  void sendControl({ action: "set_mode", mode: pipeline })
}
```

`Edge5Engine.setMode()` (`engine.ts:505-547`) is **not** a display toggle. It:
* persists `kv["v2:pipeline-mode"]`,
* constructs a **new `Bankroll(mode)`** (different namespace → the displayed and
  compounding balance changes),
* seeds the paper bankroll when its starting balance is 0,
* calls `standingOrders.onModeChanged()`, which **rebuilds the SLO executor**
  (`standing-order.ts:766-773`) — i.e. swaps the live/paper execution target underneath
  a configured standing order.

So simply loading `/v1` while the engine sat stopped in `LIVE_V2` flipped the whole
engine's pipeline. Every browser refresh and every newly opened tab re-armed the
one-shot `autoSwitched` ref, and having `/v1` and `/v2` open simultaneously produced a
mode ping-pong driven purely by page views. This is a direct violation of Task 3 and is
the credible mechanism behind the reported bankroll jumps (Task 5: the balance shown
and compounded comes from whichever namespace the last page view selected) and
unexpected SCRATCH outcomes (Task 4: an open position whose executor/bankroll namespace
changed mid-slot settles against the other pipeline's state).

**Fix** — UI only. The mount effect is deleted. The mismatch banner is always shown and
now carries an explicit `SWITCH ENGINE TO …` button, offered only when the engine is
stopped. Navigation, refresh, polling, focus and multi-tab are inert.

---

## FILES MODIFIED (3 + 1 test)

| File | Change | Task |
| --- | --- | --- |
| `instrumentation.ts` | Boot the engine at process start (build-phase guarded, try/catch) | 1 |
| `lib/v2/engine/engine.ts` | `installProcessGuards()` stands down when instrumentation handlers exist (10 lines, guard only) | 1, 6 |
| `components/v2/terminal-dashboard.tsx` | Removed mount-time `set_mode`; explicit switch button instead | 3, 4, 5 |
| `tests/unit/arc-phase2-runtime-hardening.test.ts` | **New** — 14 regression assertions for R-1, R-2, D-1 + read-only API routes | — |

No other file was touched. `standing-order.ts`, `live.ts`, `executor.ts`,
`settlement-verifier.ts`, `settlement-repair.ts`, `bankroll.ts`, `risk.ts`,
`trade-replay.ts`, `order-events.ts`, `clob-ws-client.ts`, `clob-price-feed.ts`,
`watchdog.ts` are **byte-identical**.

---

## TASK-BY-TASK FINDINGS

### Task 1 — Bot stops by itself
| Vector | Verdict |
| --- | --- |
| Process exit paths | Only `uncaughtException` → `exit(1)` and SIGTERM/SIGINT graceful dispose. No other `process.exit` outside CLI scripts. |
| Unhandled rejections | Logged, process kept alive (both handlers). Verified by test. |
| Duplicate handlers truncating diagnostics | **DEFECT R-2 — fixed** |
| Restart recovery not firing headlessly | **DEFECT R-1 — fixed** |
| Memory pressure | Watchdog samples RSS every 30s, warns at 400MB; PM2 `max_memory_restart` 512MB; health endpoint fails at 460MB. OK. |
| PM2 lifecycle | `ecosystem.config.js` restart-on-failure + graceful dispose on SIGTERM. OK. |
| Watchdog interactions | Repair-only: reconnects sockets, kicks a stalled SLO chain after 30s. It never stops trading, never touches orders. OK. |
| REST retry / WS reconnect loops | Backoff-limited; watchdog rate-limits repairs. OK. |
| Timer cancellation / tick starvation | SLO uses a self-scheduling adaptive chain with epoch invalidation + watchdog `kickLoop`. OK. |
| Emitter leaks | F-4 (Phase 4D) consolidated the duplicate WS open handler; no re-growth found. OK. |
| Deadlocks / state-machine stalls | `ROLLING_OVER` is time-bounded; `busy` flags are released in `finally`. OK. |

### Task 2 — Skipped trades
No silent-skip path found. `logWithheld()` (`standing-order.ts:1019-1044`) writes a
permanent `WITHHELD` `order_log` row for **every** in-window non-action, throttled to
one row per reason-kind per slot, covering readiness gates, window state, majority
confidence, cooldowns, pending placement and restart reconciliation. Executed orders
produce ledger rows; intentional rejections produce structured errors. Every eligible
trigger therefore lands in EXECUTED / REJECTED / WITHHELD-with-reason. **No change.**

One indirect cause of real skips was D-1: a page-view-triggered `set_mode` rebuilds the
SLO executor, which can lose an in-flight arming window. Closed by the D-1 fix.

### Task 3 — Dashboard isolation
Post-fix audit of every dashboard-reachable GET:
`status`, `health`, `analytics`, `trades`, `trades/[id]/replay`, `system`, `preflight`,
`audit`, `database`, `notifications`, `profiles`, `diagnostics/credentials`.
* `engine.snapshot()` (`engine.ts:1518+`) is pure: reads feeds, stats, sub-snapshots. No
  `kvSet`, no settle, no order call.
* `Watchdog.snapshot()`, `risk.snapshot()`, `standingOrders.snapshot()`,
  `clobPriceFeed.diagnostics()` are read-only accessors.
* `preflight` issues outbound read probes only (`eth_call`, CLOB GETs) — no order, no
  state write.
* Writes are confined to explicit POSTs (`control`, `profiles`, `notifications`,
  `database` import) that require an operator action.
* Polling is bounded and visibility-gated (status 1s, trades 2s, analytics 10s,
  `revalidateOnFocus: false`, SWR pauses on hidden tabs).
**Result: dashboard is read-only. Regression-locked by the new test.**

### Task 4 — Unexpected SCRATCH
Settlement remains as certified in Phase 2 Settlement Hardening: official resolution is
authoritative, spot fallback removed for WIN/LOSS, SCRATCH-from-pending held in a 5-min
re-verification window with a per-uid KV lock. The only non-exchange mechanism that
could produce an unexpected SCRATCH was the D-1 mid-slot pipeline/bankroll swap — now
impossible from a page view. No settlement code changed.

### Task 5 — Bankroll correctness
`Bankroll = startingBalance + realized PnL` is enforced by `accounting-verifier.ts` and
the per-uid settlement lock (no double credit; late/duplicate credits suppressed —
`standing-order.ts:2521`, `:2582`). The observed "incorrect bankroll" is explained by
D-1: page views swapped the bankroll namespace (paper ↔ live) and reseeded the paper
balance. With D-1 closed, the displayed and compounded balance follows the engine's own
mode only. No accounting code changed.

### Task 6 — Long-run stability
* Timers: every interval/timeout is tracked and cleared in `dispose()`
  (main loop, SLO chain, price feed, watchdog, db maintenance, db kickoff, settlement
  verifier). Version-bump disposal prevents duplicate loops after HMR.
* Sockets: watchdog zombie detection (90s market / 60s user) + rate-limited repair.
* Listeners: single WS open handler (F-4); no per-tick `addEventListener`.
* Memory: RSS/heap sampled every 30s and surfaced to `/health`.
* Orphans/overlap: `pendingPlacement` marker + novelty adoption (B-1/F-1), remainder
  cancel with retry and authoritative re-read (F-3), `orderID` validation (F-2).
No leak or degradation vector required a change.

---

## VALIDATION

| Gate | Result |
| --- | --- |
| `next build` | ✅ pass — routes `/`, `/v1`, `/v2`, `/_not-found`, 13 API routes. Engine boot correctly skipped during build. |
| `tsc --noEmit` | 2 pre-existing errors only (BigInt target in `direction-trace.test.ts`; narrow union arg in `phase6b-credentials.test.ts`). No new errors. |
| Tests | **387 / 389 pass** (was 373/375; +14 new). The 2 failures are the pre-existing `accounting-integrity.test.ts` balance-chain cases, unchanged. |
| Dead-code scan | No orphan modules; removing the mount effect left no unreachable code (`useEffect` import dropped). |
| Unused-import scan (eslint) | 18 pre-existing warnings, unchanged; zero introduced. |
| Runtime verification | Build output + engine-boot path traced; `register()` boot is guarded and non-fatal. |

**Performance impact:** none on the trading path. One extra engine construction at
process boot (work previously done on the first HTTP request — now earlier, not extra).
One fewer `process.on` pair. The dashboard now issues **fewer** requests (no automatic
`set_mode` POST on load).

**Proof the SLO execution path is unchanged:** `lib/v2/engine/standing-order.ts`,
`lib/v2/engine/execution/*`, `lib/v2/engine/settlement-*.ts`, `bankroll.ts`, `risk.ts`,
`trade-replay.ts` and all feed modules were not edited in this phase; all Phase 1–4D and
B-1 test suites pass unchanged.

Not pushed to GitHub.
