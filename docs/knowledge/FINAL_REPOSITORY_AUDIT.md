# Final Repository Audit — Phase 6E

Read-only sweep across the entire repository (host workspace + the
imported `reference/p4/` production codebase) to confirm the tree is
release-clean. No behavioural code was modified in this audit.

## 1. Scope

Directories reviewed:

- `reference/p4/lib/v2/engine/**` — engine, SLO, executor, reconciler,
  bankroll, accounting-verifier, settlement, db, risk, handlers, diag.
- `reference/p4/app/api/v2/**` — control, snapshot, diagnostics.
- `reference/p4/components/v2/**` — dashboard, command deck, status
  panels.
- `reference/p4/tests/**` — Phase 1..6D regression suites.
- `docs/knowledge/**` — all knowledge-base reports.
- Host root: `.gitignore`, `.prettierignore`, `eslint.config.js`,
  `.lovable/plan.md`, `CHANGELOG.md`.

## 2. Audit checklist and findings

| Category | Result | Notes |
|---|---|---|
| Dead code | None found | Every module reachable from `Edge5Engine` boot, `StandingOrderManager`, or an API route. |
| Duplicate logic | None material | `computeMajority` is single-source; `bookedPayout` centralised in `settlement-repair.ts`. |
| Obsolete utilities | None | `diag/direction-trace.ts` is env-gated (`DIAG=1`); kept intentionally. |
| Unused imports | None flagged | `accounting-verifier.ts` imports `exportSettledTradesAfterId` (Phase 6D) alongside `exportTrades` (fallback). Both used. |
| Unreachable branches | None | Post-Phase-6D majority override is guarded by `lockedDirection === null`; else-branch is the pre-Phase-6D fallback and remains reachable when snapshot is null. |
| Stale TODO/FIXME/XXX | 0 matches | `rg -c "TODO\|FIXME\|XXX" reference/p4/lib/v2/engine` returned no counts. |
| Obsolete feature flags | None | `DIAG`, `PIPELINE_MODE`, `LIVE_V2_*` env flags all live and documented. |
| Duplicate helper functions | None | Audited `bankroll`, `bookedPayout`, `computeMajority`, `checkAccountingInvariant`. |
| Redundant wrappers | None | `recordSettlement` on engine and SLO share the invariant helper; no shim layer. |
| Unnecessary polling | None new | Reconciler 60 s, accounting 5 min (now incremental), snapshot poll 1 s — all documented. |
| Unnecessary timers | None | Every `setInterval` has a corresponding stop path (`stop()`, `setMode`, boot re-entry). |
| Unnecessary allocations | Reduced in 6D | `exportTrades` full-scan replaced by `exportSettledTradesAfterId` on the hot verifier loop. |
| Stale documentation refs | Fixed | `PHASE6D_STANDING_ORDER_UPDATE.md` and `PNL_HARDENING_REPORT.md` cross-linked from `REGRESSION_REPORT.md` and this file. |
| Inconsistent naming | None | KV keys `acctverify:<mode>:watermark_id` / `:prev_balance` follow the existing `acctverify:*` namespace. |
| Outdated comments | Fixed | SLO "trigger race" comments updated in `standing-order.ts:1424-1449`; DIRECTION LOCK log wording reflects majority selection. |

Cosmetic fix applied this phase: removed a stray double blank line
introduced in `reference/p4/lib/v2/engine/accounting-verifier.ts`
between the watermark seed block and the identity loop. No behavioural
change.

## 3. Regression re-verification (static)

Confirmed unchanged, by re-reading the relevant symbol and its
touch-points:

- SLO majority-side execution — `standing-order.ts:1424-1449`, `1520`.
- PnL / accounting incremental sweep — `accounting-verifier.ts:94-217`,
  `db.ts:783`.
- Settlement invariant on both engine and SLO paths — Phase 1 P-2
  wiring intact; `checkAccountingInvariant` still called from
  `engine.ts:recordSettlement` and `standing-order.ts:recordSettlement`.
- BUY/SELL mapping — `execution/live.ts` unchanged; UI label
  disambiguation in `live-account.tsx` intact (Phase 1 Stage 1A D-2).
- Risk engine — `risk.ts` untouched since Phase 6B.
- Reconciler — `reconciler.ts` 60 s cadence unchanged.
- Dashboard startup diagnostics — `startup-error-panel.tsx`,
  `engine-status-panel.tsx`, `use-bot.ts` intact (Phase 6C).
- Credential diagnostics — `app/api/v2/bot/diagnostics/credentials/route.ts`
  intact and read-only.
- Structured API errors — `app/api/v2/bot/control/route.ts` still
  returns `{ ok:false, message, error, startup }` on failure.
- Engine Status Panel — snapshot poll every 1 s still fed by
  `EngineSnapshot.startup`.

## 4. Documentation cross-check

| Document | Status |
|---|---|
| `docs/knowledge/README.md` | Current index; Phase 6D and 6E docs linked in this phase. |
| `CHANGELOG.md` | Updated with Phase 6E entry below Phase 6D. |
| `OPERATOR_RUNTIME_CHECKLIST.md` (Phase 6C) | Still authoritative for VPS operator flow; no contradictions with 6D changes. |
| `PHASE4_VPS_VERIFICATION_RUNBOOK.md` | Still authoritative for live connectivity checks. |
| `PHASE6D_STANDING_ORDER_UPDATE.md` | Authoritative for majority-side execution. |
| `PNL_HARDENING_REPORT.md` | Authoritative for incremental accounting sweep. |
| `REGRESSION_REPORT.md` | Authoritative for the new Phase 6D test coverage. |
| `PHASE3_FINAL_CERTIFICATION.md` | T-1..T-6 still the accepted-limitations list; no change. |

Contradictions found: **none**.

## 5. Repository hygiene

- `.gitignore` (both host root and `reference/p4/`) excludes `.env`,
  `.env.*` (with `!.env.example` / `!.env.template`), `node_modules/`,
  `data/`, `*.sqlite`, `*.sqlite-journal`, PM2 runtime state, and the
  `v0` sandbox internal files.
- No secrets present in tracked files (spot-checked the entries under
  `reference/p4/deploy/`, `scripts/`, `.env.example`, and root docs).
- No generated artifacts tracked: no `dist/`, `.next/`, `out/`, or
  compiled JS under `reference/p4/`.
- No debug commits or temporary files in the working tree.

## 6. Outcome

Repository is release-clean. No behavioural changes required. The
single cosmetic fix (stray blank line) is included in the Phase 6E
commit alongside the deliverable documentation.
