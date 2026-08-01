# ADR-0002 — `reference/p4` is permanently read-only and never bundled

**Status:** Accepted (Session 0)

## Context

The p4 source is mirrored into this repository at `docs/reference/p4/` so every
future session has full context without re-uploading an archive. It is a Next.js 16
codebase with a different package manager, different framework, Node-only native
dependencies, and its own ESLint/TypeScript/Vitest configuration.

If that tree entered this project's build graph it would break lint, typecheck, and
the Worker bundle — and any edit to it would silently fork the audited engine.

## Decision

`docs/reference/p4/` is permanently read-only:

- never modified, renamed, reformatted, or refactored
- never imported by anything under `src/`
- never included in lint, typecheck, or the build

Permitted uses: repository discovery, reuse analysis, gap analysis, architecture
comparison.

Live operational data (`*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite*`) is excluded from
the mirror and blocked by `.gitignore`.

## Enforcement

| Mechanism | File |
|---|---|
| Lint ignore | `eslint.config.js` → `ignores: ["docs"]` |
| Typecheck scope | `tsconfig.json` → `include: ["src/**"]` |
| Data exclusion | `.gitignore` → `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite*` |
| Agent rule | `AGENTS.md` + `docs/governance/README.md` |

## Consequences

Reusing p4 logic requires a deliberate, ADR-backed port into `src/` — never a copy,
never an import. Understanding stays free; drift stays expensive.
