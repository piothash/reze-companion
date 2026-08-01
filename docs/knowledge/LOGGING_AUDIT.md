# Phase 6 Logging Audit

Reviewed every logging site touched or introduced in Phase 6A/6B/6C.

## 1. Credential-miss path (F-3)

**Before Phase 6B:** every failed `start()` emitted an identical
200-char `error` line. Repeated operator clicks or persisted-LIVE
auto-resume attempts produced N `error` lines per window.

**After:**
- First failure per 60 s window: `error` (unchanged).
- Repeats: `warn` with `(attempt #N)` suffix.
- Successful ignition resets the counter.

Result: **no duplicate credential spam**. The first incident always
stays visible at `error`.

## 2. Data-API HTTP 400 (F-1)

**Before:** each `AccountSync.refresh` on an empty wallet emitted
`account sync recovered with 2 source error(s)` at `warn` every 30 s.

**After:**
- First 400 → single `warn` describing the 5-minute backoff.
- Subsequent refreshes inside the cold window → no log line.
- Recovery (200 response) → single `info` line.

Result: **no unnecessary retries and no repeated logging** while a
wallet is uninitialised.

## 3. Address validation (F-2)

New logging site:
- `AccountSync.start()` when `addressPollable === false` → one `warn`
  identifying `POLY_PROXY_ADDRESS` as malformed; zero further Data-API
  traffic for the session.

Result: **actionable operator message**; distinguishes misconfiguration
from a wallet that just has no history.

## 4. LIVE_V2 setMode rejection (F-4)

New logging site:
- `Edge5Engine.setMode('LIVE_V2')` refused → one `error` line
  `Refused to switch to LIVE_V2 — <detail>` identifying missing vars.

Result: **concise startup diagnostics** that name the exact env vars
needing operator attention.

## 5. Phase 6C startup lifecycle

No new logs added. The startup lifecycle is exposed through structured
snapshot state (`snap.startup`) and structured API responses, not via
additional log lines. Rationale: the console already tells the story
after F-3/F-4; the dashboard now carries the visual equivalent.

## 6. Consistency check

All engine-lifecycle logs go through `logEvent(level, message, category?)`
so they land in the SQLite `events` table with a uniform shape. No raw
`console.error` was introduced inside the engine core in Phase 6.

Two `console.error` calls remain, both in API route wrappers
(`app/api/v2/bot/control/route.ts`, `app/api/v2/bot/status/route.ts`)
— these predate Phase 6 and are intentional so a broken engine module
graph still logs at the HTTP boundary.

## 7. Log-level policy (unchanged)

| Level | Meaning | Example |
|---|---|---|
| `error` | Operator attention required | First credential-miss per window |
| `warn`  | Notable but non-fatal, or noise-controlled repeat | Data-API cold entry, repeat credential-miss |
| `info`  | Lifecycle transitions | `Ignition ON`, cold-state recovery |
| `debug` | Trace only | Direction-trace under `DIAG=1` |

## 8. Verified reductions

| Class | Before (per hour, empty wallet) | After |
|---|---|---|
| Data-API 400 warns | 120 | 1 warn + 11 silent + 1 info-on-recovery |
| Credential-miss errors (12 retries) | 12 error | 1 error + 11 warn |

Only verified duplicate logging was reduced. No informational log line
was removed.
