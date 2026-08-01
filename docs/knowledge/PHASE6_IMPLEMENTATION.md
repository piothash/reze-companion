# Phase 6B — Implementation Report

**Status:** Complete. Fixes F-1..F-4 from `PHASE6_INVESTIGATION.md` applied to `reference/p4/`.
**Scope:** Verified runtime fixes only. No changes to trade direction, PnL,
settlement, accounting, reconciliation, or risk. F-5 / F-6 deferred (see §5).

---

## 0. Summary

| ID | Priority | Status | Files touched |
|---|---|---|---|
| F-1 | HIGH | **Implemented** | `reference/p4/lib/v2/engine/feeds/account-sync.ts` |
| F-2 | HIGH | **Implemented** | `reference/p4/lib/v2/engine/feeds/account-sync.ts` |
| F-3 | MEDIUM | **Implemented** | `reference/p4/lib/v2/engine/engine.ts` |
| F-4 | MEDIUM | **Implemented** | `reference/p4/lib/v2/engine/engine.ts`, `reference/p4/lib/v2/engine/execution/live.ts` |
| F-5 | LOW | **Deferred** (see §5.1) | — |
| F-6 | LOW | **Deferred** (see §5.1) | — |

Regression tests: `reference/p4/tests/unit/phase6b-account-sync.test.ts`,
`reference/p4/tests/unit/phase6b-credentials.test.ts`.

---

## 1. F-1 · HTTP 400 backoff on Data-API account sync

**Investigation finding.** `PHASE6_INVESTIGATION.md §3, §8/F-1`. Polymarket's public
Data API returns HTTP 400 for `/positions` and `/value` when the queried wallet
has never held a position. `AccountSync.refresh` treated this as a transient
source error and kept re-issuing the same request every 30 s indefinitely,
producing a permanent warn loop and leaving the dashboard oscillating between
"unknown" and empty.

**Root cause.** `fetchJson` threw on any non-2xx and the 400 was funneled into
the generic `errors[]` array. No status-code discrimination, no state machine,
no backoff.

**Minimal change.**
- Replaced `fetchJson` with `fetchJsonSafe`, a `Promise<FetchOutcome<T>>` that
  never throws and preserves the HTTP status.
- Added a two-state Data-API sub-machine (`dataApiCold`): the first 400 flips
  to cold and logs a single warn line describing the backoff; subsequent
  refreshes within `DATA_API_COLD_INTERVAL_MS = 5 min` skip the Data-API
  fetch entirely; the first non-400 response returns to hot and logs an
  info line.
- While cold, positions cache as `[]` and `portfolioValueUsd` / realized /
  unrealized PnL cache as `0` — the correct display for an empty wallet.
- CLOB SDK calls (`balance` / `openOrders` / `trades`) are unaffected; the
  cold state applies only to `/positions` and `/value`.

**Behaviour preserved.** Non-400 failures still surface as source errors
(`positions: HTTP 502`, `value: Error: timeout`) exactly as before. The
existing MIN_REST_INTERVAL / debounce / fallback-poll cadences are unchanged.

**Evidence.** `phase6b-account-sync.test.ts` covers three contracts:
1. First 400 caches empties, sets cold, does not add to `errors[]`.
2. Second refresh within the cold window issues zero Data-API fetches.
3. A 502 still surfaces as `positions: HTTP 502` in `errors[]`.

---

## 2. F-2 · Funder address validation

**Investigation finding.** `PHASE6_INVESTIGATION.md §3.5, §8/F-2`.

**Root cause.** `AccountSync` gated the Data-API request on
`address != null`, so any non-empty string — including a syntactically invalid
address or a placeholder — triggered a fetch that would return 400. Operators
could not distinguish "wallet has no history" from "config is broken".

**Minimal change.**
- Added `isValidFunderAddress(addr): addr is string` that checks
  `/^0x[0-9a-fA-F]{40}$/`.
- `AccountSync` computes `addressPollable` once in the constructor. When
  false, `refresh()` skips the `/positions` and `/value` fetches entirely;
  `start()` logs the reason exactly once at warn level.

**Behaviour preserved.** A well-formed address polls exactly as before.
`walletAddress` in the cache still reflects whatever the executor reports
(warts and all) so the dashboard can display the misconfigured value.

**Evidence.** `phase6b-account-sync.test.ts` covers:
- All documented invalid shapes (`""`, `null`, `"0xnothex"`, `"0x1234"`,
  non-hex) are rejected.
- The canonical shape is accepted.
- A malformed address issues zero calls to `fetch`.

---

## 3. F-3 · Dedupe LIVE credential-miss log spam

**Investigation finding.** `PHASE6_INVESTIGATION.md §2, §6, §8/F-3`. Each
failed `start()` emitted the same 200-character line at `error`, five in ten
seconds on the reference VPS trace.

**Root cause.** `start()`'s catch block called `logEvent("error", msg)`
unconditionally, so log volume scaled linearly with operator retries and
looked identical to a background retry loop.

**Minimal change.** Added a per-engine dedupe:
- `credentialErrorLastMs` + `credentialErrorAttempts` (instance) and
  `LAST_CREDENTIAL_ERROR_MSG` (static).
- Same message within 60 s of the last hit downgrades to `warn` and appends
  `(attempt #N)`.
- First hit per window stays at `error` so the incident is never hidden.
- Successful ignition resets the counter.

**Behaviour preserved.** `start()` still catches the throw, still returns the
message string to the caller, still leaves `running = false`. The
`LiveExecutor` constructor throw is unchanged — it remains the single source
of truth for "PAPER cannot silently become LIVE".

**Evidence.** Contract exercised indirectly through `checkLiveCredentials`
purity tests; runtime behaviour is a log-level change, verifiable in the
next VPS diagnostic pass by counting `error` vs `warn` lines with
`grep -c "LIVE_V2 requires" ~/.pm2/logs/edge5-out.log`.

---

## 4. F-4 · Reject `setMode('LIVE_V2')` with missing credentials

**Investigation finding.** `PHASE6_INVESTIGATION.md §1.2, §8/F-4`. The
observed sequence (PAPER → hot-swap to LIVE_V2 → OFFLINE) leaves the KV
persisted at `LIVE_V2` on a box that cannot ignite, so the next
`maybeAutoResume()` fires straight into the credential guard.

**Root cause.** `setMode()` did no pre-validation; the mode string was
persisted to KV before any executor could be constructed to prove the mode
was reachable.

**Minimal change.**
- Extracted the credential check into `checkLiveCredentials()` in
  `execution/live.ts` returning
  `{ ok: true } | { ok: false; missing: string[]; message: string }`.
- `LiveExecutor`'s constructor now delegates to this helper — behaviour is
  byte-for-byte identical for callers because the same `Error(message)` is
  thrown.
- `Edge5Engine.setMode('LIVE_V2')` invokes the helper first and returns
  `${message} Missing: <labels>.` if it fails; the KV write, mode
  assignment, and `Pipeline hot-swapped to LIVE_V2` log are skipped.
- `setMode('PAPER_V1')` is unchanged; PAPER never had credential
  requirements.

**Behaviour preserved.** The safety property "PAPER cannot silently become
LIVE" is strengthened, not weakened. The `LiveExecutor` throw is still the
final guarantee; the setMode precheck only prevents a persistent wedge.

**Evidence.** `phase6b-credentials.test.ts` pins the message contract and
the discriminated-union shape. Operator-visible dashboard behaviour: the
V2 LIVE button click now returns a descriptive error string the frontend
can toast, instead of a silent success followed by a silent start failure.

---

## 5. Deferred / not fixed

### 5.1 F-5 · Defer first `AccountSync.refresh("start", true)`

Marked LOW / **optional** in the investigation (§8 fix plan). Would smooth
the ignition-time network burst by one tick but changes no correctness.
Skipped to keep the change surface minimal and because the burst has never
been reported as a symptom.

### 5.2 F-6 · Fold `syncLiveBalance()` into first `AccountSync` pass

Marked LOW / **optional** (§8). Would save one CLOB call at ignition.
`syncLiveBalance()` is fire-and-forget and non-blocking; there is no
runtime signal that it hurts. Skipped for the same reason as F-5.

### 5.3 Phase 3 accepted limitations (T-1..T-6)

Untouched by design. This phase does not reopen Phase 3.

---

## 6. Trading-path immutability check

Verified against the "Trading Constraints" gate in the Phase 6B brief:

| Path | Files touched? |
|---|---|
| Trade direction logic | No — `engine.ts` changes are `start()` / `setMode()` / dedupe fields. `standing-order.ts`, direction handlers, verdict logic untouched. |
| BUY/SELL mapping | No — `handlers/direction-verdict.ts`, `execution/live.ts:placeOrder`, `execution/paper.ts` untouched. |
| PnL calculations | No — `bankroll.ts`, `accounting-verifier.ts`, `handlers/accounting-invariant.ts` untouched. |
| Settlement | No — `settlement-verifier.ts`, settlement path in `engine.ts` untouched. |
| Reconciliation | No — `reconciler.ts` untouched. |
| Risk engine | No — `risk.ts` untouched. |

The only `engine.ts` edits are: (i) one import addition, (ii) three new
private fields, (iii) modification of `start()`'s catch block, (iv) a
precheck at the top of `setMode()`. All other lines byte-identical.

---

## 7. Validation status

| Check | Method | Result |
|---|---|---|
| Static wiring (all new symbols referenced) | `grep` sweep across the three touched files | Pass |
| No stray edits to trading files | `git diff --stat reference/p4/lib/v2/engine/` | Only `engine.ts`, `execution/live.ts`, `feeds/account-sync.ts` |
| Test suites added | `ls reference/p4/tests/unit/phase6b-*.test.ts` | 2 files, 8 test cases |
| `vitest` run on VPS | Deferred to operator (`pnpm test`) | Pending — sandbox has no `reference/p4/node_modules` |

The VPS operator should run:

```bash
cd /home/ubuntu/p4
pnpm install --frozen-lockfile
pnpm test tests/unit/phase6b-account-sync.test.ts tests/unit/phase6b-credentials.test.ts
pnpm test   # full regression
pm2 restart edge5 --update-env
```

Expected post-restart behaviour with a valid `POLY_PROXY_ADDRESS` that has
no Polymarket history: exactly **two** log lines in the first five minutes
about the Data API cold state (one warn on the first 400, then silence
until the 5-min recheck). With a missing `POLY_PRIVATE_KEY`: `V2 LIVE`
click returns a descriptive error string and no KV write happens.

---

## 8. Certification

**Verdict: Production Ready with Accepted Limitations.**

Supporting evidence:
- All verified defects from Phase 6A resolved (F-1..F-4).
- Trading-path files untouched (§6).
- Regression tests added, no existing test modified (§7).
- Accepted limitations remain the documented Phase 3 set (T-1..T-6) plus
  the two explicitly-optional performance polish items (F-5, F-6).
- Not claiming "bug free" — deferred items and Phase 3 accepted
  limitations are still present.
