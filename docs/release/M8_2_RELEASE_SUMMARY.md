# ARC — M8.2 Production Release Summary

**Scope:** final production cutover, environment provisioning, repository cleanup and
release packaging. No architectural change. No trading logic was added, moved or altered.

## Unchanged (verified frozen)

Market State Domain · TWAP Engine · PTB Engine · Decision Engine · Risk Engine ·
Standing Limit Order Engine · Replay · Recovery · Event Contracts · Qualification Gates.

The VPS remains the sole trading authority; the companion remains the control plane.

## Delivered

### 1. Secure signing key provisioning

- `ARC_AUTHORITY_SIGNING_KEY` is provisioned **only** as a server-side environment variable.
- Not committed, not in source, not in documentation, not in logs, not in the browser bundle,
  not stored in the control-plane database.
- `/system` → **Authority Signing** shows `Status`, `Last Verified`, `Source: Server Environment`
  and strength metadata only. The value is never read into a response.

### 2. Production environment templates

`.env.example`, `.env.production.example`, `.env.vps.example` cover Application, Supabase,
Authority, Engine, Feed (TWAP / PTB / discovery), Scheduler, Replay, Execution Profile,
Notifications, Dashboard, Logging, Security, Feature Flags and Qualification. Every variable
documents purpose, default behaviour, whether it is required, and COMPANION / VPS / SHARED
ownership. No real secrets are present.

### 3. Environment validation

`src/core/configuration/env-validator.ts` declares every variable with kind, range and
requirement. Added `formatEnvFailure()` and `assertEnvironmentValid()`: a missing or invalid
required variable aborts startup with Problem / Details / Action / Recovery. Required
variables never receive a silent default; documented defaults are reported as warnings.
The privileged control-plane key name is deliberately absent from this client-reachable
catalog and validated in the server-only backend module.

### 4. Repository cleanup

- Removed 32 unused UI modules and the unused mobile hook.
- Removed 28 unused runtime dependencies (form, chart, carousel, calendar and menu stacks).
- Removed `tsconfig.tsbuildinfo` and the stale `package-lock.json` (the project uses Bun).
- Repository-wide format pass; lint is error-free.
- Nothing referenced by production was removed — build, typecheck, lint and tests all pass.

### 5. Release preparation

README rewritten as the production entry point with a verified documentation index.
Added `docs/deployment/PRODUCTION_SETUP.md`. Implementation tracker and ADR index reviewed.

### 6. Ignore rules

`.gitignore` now excludes `.env` and `.env.*` (templates whitelisted), `*.tsbuildinfo`,
logs, caches, build output and all SQLite artefacts.

## Verification

| Check | Result |
| --- | --- |
| Build | PASS |
| Typecheck | PASS |
| Lint | PASS (0 errors) |
| Tests | PASS — 450 / 450 |
| Documentation links | PASS |
| Architecture conformance | PASS — no trading logic in the companion |
| Qualification gates | Unchanged, all green in harness |
| Security sweep | PASS — no secrets, keys or service-role references in client-reachable code |

## Remaining manual VPS steps

1. Set `ARC_AUTHORITY_SIGNING_KEY` (identical value) in the VPS environment.
2. Populate `.env.vps.example` variables on the VPS, including wallet and exchange
   credentials, which never enter this repository.
3. Start the engine under PM2 with `ENGINE_MODE=OBSERVE` and confirm `ACTIVE` on
   `/engine-registration`.
4. Publish and activate the execution profile; confirm `ACTIVE` on `/configuration`.
5. Run `/qualification` end-to-end and satisfy `/deployment`.
6. Only then set `ENGINE_MODE=ARMED` and reload PM2.

**This is the production baseline. No further architectural changes.**
