# ADR-0001 — Hybrid control plane: the companion never trades

**Status:** Accepted (Session 0)

## Context

ARC's trading engine (`docs/reference/p4/`) is a single long-lived Node.js process
supervised by PM2: a phase-driven tick loop (`PRIORITY_1` / `PRIORITY_2` /
`STOPPING`), an independent Standing Limit Order manager, live and paper executors
behind one `Executor` contract, live BTC and CLOB WebSocket feeds, a `better-sqlite3`
WAL ledger, a 60s reconciler, and a KV-persisted kill switch.

This Lovable workspace is a TanStack Start app deployed to Cloudflare Workers.
It has no persistent process, no native module support, no long-lived socket, and
no local filesystem database.

## Decision

The companion is the **control plane**. The VPS remains the **sole trading
authority**. No trading decisions, market state generation, TWAP calculation, risk
evaluation, or order execution will ever be implemented inside Lovable. The
companion communicates with the VPS through authenticated APIs and canonical
events only.

## Alternatives considered

1. **Port the engine to server functions + Postgres + cron.** Rejected: destroys
   sub-second tick cadence, cannot hold WebSocket feeds, re-implements audited
   money-handling code, and forks the ledger.
2. **Dashboard-only, no backend.** Rejected: no operator auth, no config
   persistence, no event history, no notifications.
3. **Hybrid (chosen).** UI + Cloud auth/config/mirror; VPS keeps the authority.

## Consequences

- Companion Postgres tables are caches and companion-owned metadata only.
- Every engine number displayed is sourced from an engine response, never derived.
- All engine calls are server-side; credentials never reach the browser.
- Loss of the companion has zero effect on trading.
