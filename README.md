# ARC Companion — Control Plane

ARC is a two-part system.

- **VPS trading authority** — the sole authority for market state, TWAP, decisions,
  risk and order execution. It runs under PM2 on a dedicated host.
- **ARC Companion (this repository)** — the operator **control plane**. It configures,
  observes, audits and qualifies the authority. **No trading logic is ever implemented here.**

The architecture is frozen. Read `docs/ARC_PROJECT_CHARTER.md` before changing anything;
changes require an ADR in `docs/architecture/`.

## Quick start

```sh
git clone <this-repository-url>
cd reze-companion
bun install
cp .env.example .env    # fill in — never commit real values
bun run dev
```

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Local development server |
| `bun run build` | Production build |
| `bun run lint` | ESLint + Prettier |
| `bunx vitest run` | Full test suite (450 tests) |

## Environment

Three templates document every variable, its purpose, default, whether it is required,
and which side owns it:

| Template | Target |
| --- | --- |
| `.env.example` | Local development (companion) |
| `.env.production.example` | Production companion / control plane |
| `.env.vps.example` | Production VPS trading authority |

Required variables are validated at startup by `src/core/configuration/env-validator.ts`.
Missing or invalid values abort startup with an operator-readable explanation — there are
no silent defaults for required variables.

The shared authority signing key (`ARC_AUTHORITY_SIGNING_KEY`) is a **server-side
environment variable only**. It is never committed, logged, stored in the database,
returned to the browser, or displayed anywhere in the UI. The System page shows only
status, last verified timestamp and source.

## Operator surfaces

`/dashboard` · `/markets` · `/signal-tank` · `/windows` · `/execution-profiles` ·
`/trade-monitor` · `/analytics` · `/replay` · `/health` · `/system` · `/operations` ·
`/audit` · `/notifications` · `/engine-registration` · `/ownership` · `/qualification` ·
`/deployment`

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/ARC_PROJECT_CHARTER.md`](docs/ARC_PROJECT_CHARTER.md) | Constitution — frozen architecture |
| [`docs/IMPLEMENTATION_TRACKER.md`](docs/IMPLEMENTATION_TRACKER.md) | Single source of truth for delivery status |
| [`docs/ENGINEERING_ROADMAP.md`](docs/ENGINEERING_ROADMAP.md) | Milestones |
| [`docs/architecture/ADR_INDEX.md`](docs/architecture/ADR_INDEX.md) | Architecture decisions |
| [`docs/AUTHORITY_API_CONTRACT.md`](docs/AUTHORITY_API_CONTRACT.md) | Companion ↔ VPS contract |
| [`docs/VPS_DEPLOYMENT.md`](docs/VPS_DEPLOYMENT.md) | VPS deployment guide |
| [`docs/deployment/M8_PM2_VALIDATION.md`](docs/deployment/M8_PM2_VALIDATION.md) | PM2 validation |
| [`docs/deployment/supabase-cutover.md`](docs/deployment/supabase-cutover.md) | Control-plane cutover |
| [`docs/deployment/PRODUCTION_SETUP.md`](docs/deployment/PRODUCTION_SETUP.md) | End-to-end production setup |
| [`docs/operations/BACKUP_AND_RECOVERY.md`](docs/operations/BACKUP_AND_RECOVERY.md) | RPO / RTO and recovery |
| [`docs/operations/M8_MONITORING.md`](docs/operations/M8_MONITORING.md) | Monitoring and logging |
| [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md) | Day-2 operations |
| [`docs/release/M8_2_RELEASE_SUMMARY.md`](docs/release/M8_2_RELEASE_SUMMARY.md) | Production release summary |
| [`docs/qualification/`](docs/qualification/) | Qualification and readiness reports |

`docs/reference/p4/` and `docs/knowledge/` are **read-only** reference material: never
imported, bundled or modified.

## Security rules

- Never commit `.env`, signing keys, service-role keys, wallet keys or exchange credentials.
- Never commit `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite*`.
- Privileged keys are read only inside server-only modules and never reach the browser bundle.
