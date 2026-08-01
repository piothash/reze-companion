# ARC — Project Charter

**Status:** ACTIVE · **Ratified:** Session 0 · **Amendment:** ADR only (see `docs/architecture/`)

This document is the constitution of the ARC project. Every session, every plan,
and every implementation in this workspace is bound by it. If a request conflicts
with this charter, the charter wins until it is amended by a new ADR.

---

## 1. Architecture Frozen

The ARC architecture is **frozen**. It is not open for redesign, re-platforming,
or "improvement" as a side effect of feature work. Changes to architecture happen
only through the ADR process in section 5 — never inline in a feature session.

## 2. Hybrid Architecture (binding statement)

> The companion is the control plane. The VPS remains the sole trading authority.
> No trading decisions, market state generation, TWAP calculation, risk evaluation,
> or order execution will ever be implemented inside Lovable. The companion
> communicates with the VPS through authenticated APIs and canonical events only.

Corollaries, all binding:

- The VPS SQLite ledger is the **single source of truth**. Anything stored in the
  companion database is a **cache or mirror**, never an authority.
- No dual-write. The companion never computes a number the engine already owns.
- The companion may **read**, **display**, **annotate**, and — once explicitly
  authorised in a later session — **issue control commands** to documented engine
  endpoints. It never replaces engine behaviour.
- Serverless reality: this workspace runs TanStack Start on Cloudflare Workers.
  There is no persistent process, no native module support (`better-sqlite3`), no
  long-lived WebSocket client, and no PM2. The engine physically cannot run here,
  and by this charter never will.

## 3. Two-Repository Rule

| Role | Repository | Permission |
|---|---|---|
| **Source / reference** | `https://github.com/piothash/reze` (mirrored at `docs/reference/p4/`) | READ ONLY |
| **Implementation workspace** | `https://github.com/piothash/reze-companion` | WRITE |

The two are never confused. Nothing is ever written back to the source. All
implementation belongs exclusively to `reze-companion`.

## 4. "Do Not Touch" — `docs/reference/p4/`

`docs/reference/p4/` is permanently:

- **Read-only** — never modified
- **Never imported** into runtime code
- **Never bundled** — excluded from lint, typecheck, and the build graph
- **Never refactored**, renamed, reformatted, or "cleaned up"
- **Never a dependency** of anything under `src/`

Permitted uses, and only these:

1. Repository discovery
2. Reuse analysis
3. Gap analysis
4. Architecture comparison

Live operational data (`*.db`, `*.db-wal`, `*.db-shm`, exports, key material) is
**never** committed to this repository under any circumstance. It belongs to the VPS.

## 5. ADR Process

Architectural decisions are recorded in `docs/architecture/ADR-NNNN-<slug>.md`.

1. Proposal states context, decision, alternatives, and consequences.
2. Status is one of `Proposed`, `Accepted`, `Superseded by ADR-NNNN`.
3. An accepted ADR amends this charter; the charter references it.
4. No architectural change ships without an accepted ADR.

## 6. Engineering Workflow

Each session follows the same loop:

1. **Read** — load the charter, governance rules, and the relevant knowledge report.
2. **Understand** — trace the existing behaviour in `docs/reference/p4/` before proposing anything.
3. **Plan** — a written plan, approved before implementation.
4. **Implement** — the smallest correct change in `src/`, following existing patterns.
5. **Verify** — build, lint, and behavioural check; no "should work" claims.
6. **Record** — update the discovery report or an ADR when understanding changes.

Sessions are engine-by-engine. One subsystem at a time; no wide refactors.

## 7. Implementation Principles

- **Reuse verified logic.** p4 has been audited across seven phases. Mirror its
  semantics; do not reinvent them.
- **No rewrites of working behaviour.** Preserve names, states, and invariants.
- **No architectural drift.** New abstractions require justification in the plan.
- **Deterministic and production-grade.** No hidden randomness, no silent fallbacks,
  no swallowed errors.
- **Secrets never in source.** All credentials are runtime secrets; never hardcoded,
  never in the client bundle, never logged.
- **Fail loud.** Surface upstream status and error bodies rather than a generic 500.
- **Money-correctness is not a UI concern.** The companion never derives a balance,
  P&L, or position; it displays what the engine reports.
