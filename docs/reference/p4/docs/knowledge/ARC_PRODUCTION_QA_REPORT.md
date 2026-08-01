# ARC Production QA & Release Certification

Scope: full-surface QA of the SLO-only trading bot (UI, API, config, sync, buttons,
error handling, dead code, regression). Read-write phase — only defects found were fixed.

## Part 1 — UI audit (Playwright, http://localhost:3100/v1)

- All 5 tabs (OPS DECK, SIGNAL TANK, LEDGER, ANALYTICS, SYSTEM) mount and switch
  cleanly; `aria-selected=true` confirmed for each. 0 console errors, 0 page errors.
- All three ARC Phase 3 toggles flip and hold state:
  `Use COMPOUNDING true→false`, `Use TRIGGER PRICE true→false`, `Use LIMIT PRICE true→false`.
- START/STOP: STOP correctly disabled while idle. ARM shows `CHECK PARAMETERS`
  when `canArm` is false instead of failing silently.
- Dead auth surface removed: `LOGOUT` button (called the non-existent
  `/api/auth/logout`), `redirectToLogin()`/`logout()` in `use-bot.ts`, and the orphan
  `components/login-form.tsx`. 401s now surface as normal errors, not 404 redirects.

## Part 2-4 — API, config and sync audit

### Defect D-1 (FIXED) — silent success on refused control actions

`POST /api/v2/bot/control` returned `HTTP 200 {ok:true}` even when the engine
refused the action, because engine methods report refusals as plain strings:

| Action | Old response | New response |
| --- | --- | --- |
| `set_balance` outside PAPER_V1 | `200 {ok:true,"Balance can only be set in PAPER_V1"}` | `400 {ok:false}` |
| `set_balance` with amount <= 0 | `200 {ok:true,"Amount must be positive"}` | `400 {ok:false}` |
| `set_limit_order` refused (e.g. missing LIVE creds) | `200 {ok:true, <reason>}` | `400 {ok:false, <reason>}` |
| `pause/resume/clear_limit_order` with no order armed | `200 {ok:true}` | `400 {ok:false}` |

Refusal is detected from **engine state** (mode, `snapshot().standingLimitOrder`),
never by parsing message text. Verified live against the running dev server.

### Config round-trip + restart persistence (PASS)

Armed via API with `entryWindowSec:7, compounding:false, useTriggerPrice:true,
useLimitPrice:false`; `/api/v2/bot/status` echoed
`entryWindowMs:7000, compounding:false, useTriggerPrice:true, useLimitPrice:false`.
After a full process restart the same values, `mode=PAPER_V1`, `balance=500` and
`status=WINDOW_WAITING` were restored from KV. Pause/resume round-tripped.

## Part 5 — Defect D-2 (FIXED) — phantom balance-chain break after ledger reset

`clearLedger()` deleted trades and order logs but left the accounting verifier's
incremental sweep pointers (`acctverify:<mode>:watermark_id`,
`acctverify:<mode>:prev_balance`) in KV. The next sweep chained the first new trade
onto a **deleted** trade's `balance_after` and reported a CRITICAL
`BALANCE_CHAIN` violation on a perfectly healthy ledger — reachable in production
through the operator `reset_ledger` action. Fixed by clearing both pointers inside
`clearLedger()`.

## Part 8 — Dead code / debug scan

- `TODO` / `FIXME` / `HACK` in `lib`, `app`, `components`, `scripts`: **0**.
- `console.log` in product code: 4, all intentional structured logging
  (`events.ts` logger sink, `latency-trace.ts` latency line, 2 proxy-init lines
  with credentials redacted). No debug leftovers.

## Part 9 — Regression

Full suite after fixes: **41 files, 406/406 tests pass** (223s, includes the
10,000-rollover and PM2-churn certification soaks). `tsc --noEmit` clean.
Two previously "known failing" suites were root-caused rather than accepted:
`accounting-integrity` was the D-2 product defect; `db-chaos` was a test that
assumed per-test isolation of same-UTC-day risk stats and now asserts the delta.

## Part 10 — Release certification

| Gate | Result |
| --- | --- |
| UI interaction (tabs, toggles, buttons) | PASS |
| No silent success on any control action | PASS (after D-1) |
| Config round-trip + restart persistence | PASS |
| Accounting integrity after ledger reset | PASS (after D-2) |
| Dead code / debug output | PASS |
| Full regression 406/406 | PASS |

**Verdict: CERTIFIED FOR PAPER DEPLOYMENT.** LIVE_V2 remains gated on operator
credentials, which the API now reports as an explicit failure.
