# Open Questions & Unverified Items — Phase 0.5 (updated)

Every item from Phase 0 either resolved with `path:line` evidence in `PHASE0_COMPLETION_REPORT.md` or explicitly retained as Unverified. This file is now the authoritative status table.

## Resolution status

| # | Original claim | Status | Resolution / evidence |
|---|-----------|--------|-----------------------|
| U1 | `LOOP_MS` in `config.ts` | **Resolved** | No such named constant. Tick cadence is `P1_OPEN_MS = 20_000` / `P2_OPEN_MS = 10_000` / `HOLD_MS = 2_000` at `config.ts:99-102`. |
| U2 | `driftPaddingUsd = 12` | **Resolved** | `config.ts:73`. |
| U3 | `minShares = 5` | **Resolved** | `config.ts:74`. |
| U4 | `strategy/sniper.ts` "legacy, kept alongside registry" | **Resolved** | Neither is default at boot; `activeStrategy: null` at `config.ts:81`. See completion report §1.1 C6. |
| U5 | PM2 exponential backoff / memory ceiling / SIGINT | **Resolved** | `ecosystem.config.js:26-46` — all flags quoted in completion report §1.3 U5. |
| U6 | Test tree not enumerated | **Resolved** | 28 files enumerated in `_appendix/test-coverage-matrix.md`. |
| U7 | Session/CSRF details | **Resolved** | Full HMAC + cookie-attribute quote in completion report §4.1 from `dashboard-auth.ts`. |
| U8 | `computeSpotFallback` body | **Partially resolved** | Behavior is: BTC reference feed price at slot end vs strike drives winner when official resolution unavailable; `settlement-verifier.ts:1-32` re-checks and upgrades once official appears. Line-by-line quote deferred to Phase 1 read. |
| U9 | `DiscoveredMarket` fields | **Resolved** | `types.ts:26-27, 464-465, 526-527`; `feeds/market-discovery.ts:129-150`. |
| U10 | Oracle guard thresholds | **Resolved** | `handlers/oracle-sync-guard.ts:24, 34-52`; padding `$12` at `config.ts:73`. |
| U11 | `notifier.ts` call sites in `risk.ts` | **Resolved** | Import at `risk.ts:26` confirmed; call-site enumeration is a mechanical grep, not a KB claim. |
| U12 | `SIGNATURE_TYPE` semantics | **Resolved** for the enum (`config.ts:29-31`); **partially resolved** for behavioral effects (inside vendored SDK — R1 in completion report). |
| U13 | Accounting verifier formula | **Resolved** | Identities A–D quoted at `accounting-verifier.ts:12-21`. |
| U14 | Watchdog thresholds | **Resolved** | `watchdog.ts:29-32, 37`. |
| U15 | Orphan cleaner call sites | **Resolved** | `handlers/orphan-cleaner.ts:26-30, 32-46`. |
| U16 | SLO state machine `ARMED → TRIGGERED → RESTING → FILLED` | **Unverified (R3)** | `standing-order.ts` (2,489 LOC) not traced line-by-line in Phase 0 or 0.5. |
| U17 | SLO stuck-RESTING guard | **Partially resolved** | Watchdog side quoted (`SLO_STALL_MS = 30_000`, `watchdog.ts:37, 189`); SLO-internal detection remains unquoted (R4). |
| U18 | Boot sequence ordering | **Partially resolved** | Entry points cited (`installProcessGuards()` `engine.ts:1525-1548`; `maybeAutoResume()` `engine.ts:247`). Full statement ordering not walked (R6). |

## Open questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Which strategy is default at boot? | **Resolved** — neither; `activeStrategy: null` (`config.ts:81`). |
| Q2 | Behavior of `SIGNATURE_TYPE` variants | **Enum resolved** (`config.ts:29-31`); **SDK behavior Unverified (R1)**. |
| Q3 | Reconciliation of P1/P2 comment bands vs `setBands` | **Resolved** — defaults in `config.ts:71-72` seed `DEFAULT_STRATEGY`; `setBands` overwrites at runtime. |
| Q4 | "one per 5-min window ≈ 288/day" — upper or typical? | **Resolved** — upper bound per `risk.ts:55-63` comment. |
| Q5 | Do all `app/api/v2/bot/*` routes enforce `checkControlAuth`? | **Unverified (R2)** — deferred to a route-by-route Phase 1 grep. |
| Q6 | Interaction of `settlement-verifier.ts` and `settlement-repair.ts` | **Resolved** — verifier auto-calls `repairTrade` on official-evidence mismatch; not operator-gated. `settlement-verifier.ts:1-32`. |
| Q7 | Additive tables outside `db.ts` migration block | **Partially resolved** — `comparison.ts` read-only; `strategy-profiles.ts` creates its own tables. Full DDL enumeration deferred (R5). |
| Q8 | `env.DB_PATH` default | **Resolved** — `"data/edge5.db"` at `config.ts:66`. |
| Q9 | Eight operator markdown docs authoritative? | **Resolved** — yes; all summarized in `_appendix/operator-runbooks.md`; Report 15 "no runbook" retracted. |
| Q10 | `gen-creds.js` role | **Resolved** — standalone argv-based credential-derivation CLI; sibling of `scripts/derive-clob-credentials.mjs`. |
| Q11 | `scripts/` mutation surface | **Resolved** — `audit-ledger.ts` READ-ONLY (mutates only with `--repair`); `replay-trade.ts` READ-ONLY; `verify-all.mjs` READ-ONLY. |
| Q12 | `UP/DOWN` → `YES/NO` mapping | **Resolved** — `YES`/`NO` do not exist in P4 source. Token-id mapping is label-based (`Up`/`Down`) at `feeds/market-discovery.ts:129-142`. Full trace in `_appendix/direction-matrix.md`. |
| Q13 | Class name `Engine` vs `Edge5Engine` | **Resolved** — `Edge5Engine` (`engine.ts:66`). |

## Remaining Unverified (recorded as R-items in `PHASE0_COMPLETION_REPORT.md` §2)

| R# | Item | Reason it stays Unverified from source alone |
|---|---|---|
| R1 | Full behavioral effects of `SIGNATURE_TYPE=0/1/2` on order routing/settlement | Inside the vendored `@polymarket/clob-client-v2` SDK. |
| R2 | Every `app/api/v2/bot/*` route enforces `checkControlAuth` | Not exhaustively grepped in Phase 0.5. |
| R3 | SLO state constants + transition table | `standing-order.ts` (2,489 LOC) not traced line-by-line. |
| R4 | SLO-internal stuck-RESTING detection | Same. |
| R5 | Full DDL of additive tables in `strategy-profiles.ts` | Not enumerated. |
| R6 | Exact statement ordering of boot sequence | Constructor not walked line-by-line. |
| R7 | 99p BTC feed-gap distribution vs `SPOT_STALE_MS = 10_000` | Requires production telemetry. |
| R8 | Live-vs-paper promotion verdict criteria | Not encoded in source; requires operator policy. |
