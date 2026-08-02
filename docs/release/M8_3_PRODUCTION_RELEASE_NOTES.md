# ARC Production Release v1.0 — Release Notes

Date: 2026-08-02 · Scope: final engineering pass before live VPS activation.
Architecture frozen — no domain, contract, gate or authority-model change in this release.

## What this release is

The single repository `piothash/reze-companion` now fully represents the ARC platform:
the trading engine domains, the operator control plane, the complete Supabase schema,
the deployment assets and the full documentation set.

## Changes in this pass (M8.3)

| Area | Change |
| --- | --- |
| Scripts | Added `typecheck`, `test`, `test:watch`, `test:coverage`, `check:env`, `verify` — the documented commands now exist |
| PM2 | Added `ecosystem.config.cjs`: `arc-companion` (control plane) and `arc-engine` (single, non-clustered, starts in `OBSERVE`) |
| Environment | Added `scripts/check-env.mjs` fail-fast preflight; completed templates with `SUPABASE_PUBLISHABLE_KEY`, `ARC_AUTHORITY_ID`, `ARC_COMPANION_URL` |
| Docs | Added `CHANGELOG.md`; rewrote `README.md` as a fresh-clone runbook; extended `docs/IMPLEMENTATION_TRACKER.md` |
| Tests | Added `tests/unit/m83-final-release.test.ts` — scripts, deployment assets, 18 operator routes, full schema provisioning, env-coverage, secret sweep |

## Verification

| Check | Result |
| --- | --- |
| `typecheck` | PASS |
| `lint` | 0 errors (3 pre-existing react-refresh warnings) |
| `test` | 465 / 465 PASS across 32 files |
| `build` | PASS |
| Secret sweep | PASS — no signing key, service-role key or JWT in tracked files |
| Frozen domains | Unchanged |

## Verdicts

- **Repository completeness — YES.** Engine domains, 18 operator routes, 12 migrations
  (schema + RLS + grants + functions + triggers), PM2, preflight, runbooks, ADRs,
  contracts and qualification reports all live in this repository.
- **Fresh-clone deployment — YES.** `clone → install → cp .env.example .env →
  check:env → dev` works with no hidden engineering work; production follows
  `docs/deployment/PRODUCTION_SETUP.md`.
- **Production readiness — YES (control plane).** Live authority qualification remains
  an operator activity against a running VPS.

## Remaining manual production actions

1. Provision environment variables from `.env.production.example` / `.env.vps.example`.
2. Apply `supabase/migrations/` to the production project.
3. Set `ARC_AUTHORITY_SIGNING_KEY` identically on companion and VPS.
4. Register the first operator and finalize ownership at `/ownership`.
5. Start the engine: `pm2 start ecosystem.config.cjs --only arc-engine --env production`.
6. Complete live authority qualification at `/qualification`, then promote `ENGINE_MODE`
   from `OBSERVE` to `ARMED`.

Nothing else is required.
