## ARC — Session 0: Discovery & Workspace Initialization (revised)

### What I found (read-only inspection, already done)

**Correction to the premise:** the uploaded `arc-main` zip is *not* an existing ARC application. Its `src/` is an untouched Lovable TanStack Start template (59 files, shadcn UI + placeholder `index.tsx`). The real ARC implementation lives inside it as read-only reference material:

- `reference/p4/` — the engine: **Next.js 16**, pnpm, `better-sqlite3`, `@polymarket/clob-client-v2`, `ethers`, `ws`, PM2 (`ecosystem.config.js`), vitest. ~583K of `lib/v2/engine/` (engine.ts, standing-order.ts 2489 LOC, execution live/paper, feeds, handlers, risk, reconciler, settlement/accounting verifiers, telegram, watchdog), 13 API routes under `app/api/v2/bot/*`, 17 `components/v2/*` panels, 30+ test files.
- `docs/knowledge/` — 40+ engineering reports (overview, architecture, engine, SLO, execution, settlement, accounting/PnL, risk, sync, feeds, persistence, recovery, testing, production readiness, audits).
- `data/edge5.db` + WAL/SHM — live VPS trading data. **Excluded permanently.**

**ARC in one line:** an autonomous maker bot for Polymarket rolling 5-minute BTC UP/DOWN markets — single long-lived Node process, phase-driven tick loop (PRIORITY_1/PRIORITY_2/STOPPING), independent Standing Limit Order manager, PAPER/LIVE executors behind one contract, SQLite ledger with crash-recovery refunds, 60s reconciler, KV-persisted kill switch.

**This Lovable project** (`/dev-server`) is also the blank template — no `docs/`, no `reference/`, no backend, no routes beyond the placeholder index.

**Runtime constraint (decisive):** this workspace runs TanStack Start on Cloudflare Workers — no persistent process, no native modules (`better-sqlite3` is a native addon), no long-lived WebSocket client, no PM2, no filesystem DB. The p4 engine cannot run here, and per the frozen architecture it never will.

---

### Frozen architecture statement (written into the charter verbatim)

> The companion is the control plane. The VPS remains the sole trading authority. No trading decisions, market state generation, TWAP calculation, risk evaluation, or order execution will ever be implemented inside Lovable. The companion communicates with the VPS through authenticated APIs and canonical events only.

### Permanent "Do Not Touch" rule (charter + AGENTS.md)

`reference/p4/` is **read-only**: never imported into runtime, never bundled, never modified, never refactored. Permitted uses only: repository discovery, reuse analysis, gap analysis, architecture comparison. All implementation belongs exclusively to `reze-companion`.

---

### Plan for this session

**1. Ingest reference material**

```
docs/
├── ARC_PROJECT_CHARTER.md
├── ARC_DISCOVERY_REPORT.md
├── architecture/          (ADRs: ADR-0001 hybrid control plane, ADR-0002 no engine port)
├── governance/            (two-repo rule, do-not-touch, session workflow, definition of done)
├── knowledge/             (40+ reports from the zip, verbatim)
└── reference/p4/          (p4 source, verbatim, read-only)
```

Copy excludes `.git` metadata (verified: none present) and **all `*.db`, `*.db-wal`, `*.db-shm` and any live data files** — no exceptions. Add `.gitignore` entries for those extensions so they can never be committed later. Exclude `docs/reference/**` from `eslint.config.js` and `tsconfig` so p4's Next.js code can never enter this app's lint, typecheck, or bundle. Append the do-not-touch and two-repo rules to `AGENTS.md`.

**Charter contents:** architecture frozen; hybrid statement above; two-repository rule (source `piothash/reze` = reference, workspace `piothash/reze-companion` = implementation target, never confused); ADR process; engineering workflow; implementation principles (reuse verified logic, no rewrites, no architectural drift, production-grade and deterministic).

**2. Discovery report** — `docs/ARC_DISCOVERY_REPORT.md`, all 9 deliverable sections: GitHub, project summary, repository structure, Supabase, environment audit (every `process.env` key p4 references, marked present/missing here — no invented values), dependency audit (Worker-incompatible packages flagged), architecture understanding, technical issues, readiness assessment.

**3. Enable Lovable Cloud + full foundational schema**

One migration creating all nine tables with GRANTs, RLS enabled, and `auth.uid()`-scoped policies. Structure only — no behavior wired yet:

| Table | Purpose |
|---|---|
| `profiles` | operator profile, auto-created on signup via trigger |
| `user_roles` | separate table + `app_role` enum + `has_role()` security-definer fn |
| `engine_endpoints` | VPS base URL / environment per operator |
| `engine_snapshots` | mirrored engine state (cache only) |
| `event_log` | mirrored canonical engine events |
| `notifications` | operator-facing alerts |
| `feature_flags` | companion-side flags |
| `configuration_profiles` | named companion config presets |
| `audit_log` | companion-side action trail |

Auth: email/password + Google. No secrets invented — the VPS API token is requested via the secure secret form when the first authenticated call is wired, not this session.

**4. Control-plane skeleton (read-only, zero trading behavior)**

- Replace the placeholder `/` with an ARC status page; `/_authenticated/` operator shell.
- Exactly one typed server function: read-only proxy of `GET /api/v2/bot/status` to the configured VPS endpoint, returning a typed DTO. Proves the hybrid link and nothing more. No control/mutation surface.
- Per-route `head()` metadata.

**5. Verification and mandatory close-out report**

Run install, build, lint; confirm the dev server responds. Then report in chat, including this block filled from what the environment actually exposes:

```
Repository Connection
=====================
GitHub Connected: YES / NO
Repository:      https://github.com/piothash/reze-companion
Default Branch:  ...
Push Permission: YES / NO
Pull Permission: YES / NO
Latest Commit:   <hash>
Sync Status:     ...
```

**Known limitation, stated up front:** GitHub connection is a Lovable UI action and git state is managed outside my tooling — I cannot run git commands or read the repo link. If any field cannot be verified, I will state exactly which and why rather than assuming connected. You confirm the link via the chat **+** menu → GitHub.

Plus the four explicit statements: *Repository Discovery Complete. GitHub Connection Verified (or precise reason not). Supabase Status Verified. Project Ready for Engine-by-Engine Implementation.*

### Not in this session

No engine porting, no strategy code, no order path, no risk/TWAP/market-state logic, no changes to `docs/reference/p4`, no dependency upgrades, no live data files.
