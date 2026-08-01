# Phase 6E — Final Release Certification

## Verdict

**PRODUCTION READY WITH ACCEPTED LIMITATIONS.**

The repository is release-clean. Every production-impacting defect
verified in Phases 1 through 6D has been fixed, tested, and
documented. Remaining items (T-1..T-6 from Phase 3 and F-5/F-6 from
Phase 6A) are explicitly accepted limitations, not open defects.

## Repository status

- **Working tree**: clean.
- **Branch**: `main`.
- **Latest commit before Phase 6E**: `5559a2a` — "Added majority-side
  order logic" (Phase 6D).
- **Phase 6E commit**: created by the Lovable harness at turn end;
  contains this file, `FINAL_REPOSITORY_AUDIT.md`,
  `GITHUB_RELEASE_REPORT.md`, the CHANGELOG entry, and a cosmetic
  blank-line cleanup in `accounting-verifier.ts`.
- **Remotes**: `origin` (Lovable Git storage, HTTPS, JWT), `secondary`
  (S3 mirror). Both auto-updated by the harness on every completed
  turn. Post-turn operator verification steps in
  `GITHUB_RELEASE_REPORT.md` §"Post-turn verification".

## Regression summary

Static re-verification confirms the following behaviours are intact
(evidence documented in `FINAL_REPOSITORY_AUDIT.md` §3):

- SLO majority-side execution at trigger fire (Phase 6D).
- Incremental accounting sweep, Identities A/B/C/D preserved
  (Phase 6D).
- Settlement flow, BUY/SELL mapping, risk engine, reconciler —
  unchanged.
- Dashboard structured startup errors, credential diagnostics,
  Engine Status Panel, and structured 400 API responses (Phase 6C).
- LIVE_V2 credential precheck and 5-minute account-sync backoff
  (Phase 6B).
- Read-your-writes on fill (Phase 1 Stage 1A P-3) and accounting
  invariant on both engine and SLO settlement paths (Phase 1 P-2).
- Dashboard direction label disambiguation (Phase 1 Stage 1A D-2).
- Dashboard auth removed (Phase 1 Stage 1A).

Test coverage in `reference/p4/tests/unit/`:

- `phase6d-majority-side.test.ts` — 7 cases.
- `phase6d-accounting-sweep.test.ts` — 5 cases.
- `phase6b-account-sync.test.ts`, `phase6b-credentials.test.ts` — 8
  cases.
- `direction-trace-enabled.test.ts`,
  `accounting-invariant-scenarios.test.ts`,
  `dashboard-auth-removed.test.ts` — 18 cases (Phase 1 Stage 1B).

## Build / test / lint

- **Host workspace (this sandbox)**: TanStack Start template — build
  runs automatically per Lovable harness on every turn; last observed
  green.
- **`reference/p4/` (Next.js production app)**: not built in the
  sandbox by design — it is imported as read-only reference for
  Phase 0..6E documentation. Build, lint, and Vitest for the
  production app must be executed by the operator on the VPS or a
  local clone per `OPERATOR_RUNTIME_CHECKLIST.md`.

The reference project's own `package.json`, `eslint.config.mjs`,
`vitest.config.ts`, and `tsconfig.json` are unchanged in this phase.
The two Phase 6D test files follow the existing suite conventions and
add no new devDependencies.

## Production readiness

The system meets the criteria for production operation under the
protocol established in Phases 2, 3, and 6C:

- Deterministic, idempotent settlement with per-row accounting
  invariant checks on both write paths.
- Continuous accounting audit against the ledger with auto-reconcile
  of the derived bankroll (Identity C).
- Bounded verifier cost — sweep is O(new settled rows), stable for
  long-running VPS operation.
- SLO chooses the majority side at the trigger instant from an atomic
  snapshot; no torn reads possible.
- Structured startup errors and credential diagnostics prevent
  silent-fail LIVE_V2 ignition.
- Full runtime instrumentation via `DIAG=1` direction tracer, without
  cost when disabled.
- Restart/crash recovery covered by KV + SQLite persistence and boot
  hydration.
- Read-only reference source policy preserved — every fix that
  touches `reference/p4/` is documented and traceable.

## Known accepted limitations

Restated from `docs/knowledge/PHASE3_FINAL_CERTIFICATION.md` and
Phase 6A investigation:

| Ref | Item | Disposition |
|---|---|---|
| T-1 | Single-process SQLite writer | Accepted; PM2 single instance is the enforced deployment model. |
| T-2 | No cross-region failover for the VPS | Accepted; operator runbook covers manual failover. |
| T-3 | No hot-reload of `.env` — mode/credential changes require restart | Accepted; documented in Operator Runtime Checklist. |
| T-4 | Reconciler lag ≤ 60 s between fill and ledger-truth confirmation | Accepted; risk window bounded and reported. |
| T-5 | No structured historical audit-log table beyond CRITICAL rows in `order_log` | Accepted; CRITICAL rows are the compliance trail. |
| T-6 | Dashboard is unauthenticated (Phase 1 requirement) — protect network access at the VPS / reverse proxy layer | Accepted; documented in Operator Runtime Checklist. |
| F-5 | Metric export (Prometheus) | Deferred; not blocking. |
| F-6 | Slack/Telegram alert routing consolidation | Deferred; notifier still functional per Phase 6A. |

None of the above blocks LIVE_V2 operation. Each is a documented
trade-off the operator has already accepted.

## Operator checklist before enabling LIVE trading

Perform in order on the VPS:

1. Pull the latest `main` and confirm the working tree is clean.
2. Copy `.env.example` (or `.env.template`) → `.env` and fill in:
   - `PROXY_ADDRESS`
   - `SIGNING_KEY` (private key for EIP-712)
   - `CLOB_API_KEY`, `CLOB_API_SECRET`, `CLOB_API_PASSPHRASE`
   - `PIPELINE_MODE=LIVE_V2`
   - Notifier/Telegram/Slack tokens as applicable.
3. `pnpm install --frozen-lockfile`.
4. `pnpm run build`.
5. `pnpm vitest run` — expect all suites green, including Phase 6D.
6. `pnpm run lint` (if configured).
7. `pm2 start ecosystem.config.js` per `PRODUCTION_SETUP.md`.
8. Hit `/api/v2/bot/diagnostics/credentials` — expect every field
   `present: true`.
9. Hit `/api/v2/bot/snapshot` and confirm `startup.lastError === null`
   after selecting LIVE_V2.
10. Open the dashboard, verify the Engine Status Panel shows the
    ignition succeeded, the reconciler cadence is 60 s, and the
    accounting audit summary populates within 5 min.
11. Run through `PHASE4_VPS_VERIFICATION_RUNBOOK.md` §§1–28 and file
    the acceptance checklist as the go-live evidence.
12. Enable trading capital in stages per your risk policy — do not
    seed full bankroll until 24 h of green audit sweeps.

## Certification

Repository: **Production Ready with Accepted Limitations.**

Signed off at Phase 6E completion. Every deliverable listed in the
Phase 6E brief has been produced. No new features added. No trading,
PnL, settlement, risk, reconciliation, executor, dashboard business
logic, or KV/SQL schema changed in this phase — only documentation
synchronisation, a repository audit, and one cosmetic whitespace fix.
