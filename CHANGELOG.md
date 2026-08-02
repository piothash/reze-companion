# Changelog

All notable changes to the ARC companion control plane.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning: semantic.

## [1.0.0] — 2026-08-02 — ARC Production Release

First production-ready release of the ARC companion control plane. The
architecture is frozen: the VPS remains the sole trading authority and this
repository never makes trading decisions.

### Added

- **Core foundation (P0/M0)** — clock abstraction, deterministic IDs, reason-code
  catalog, Zod event envelopes, configuration schema, deterministic scheduler, FSM
  framework.
- **Market State Domain (M1)** — venue discovery, feed engine, TWAP engine, PTB,
  signal conditioning, immutable `AuthoritativeMarketState` snapshots.
- **Decision Domain (M2)** — pure decision engine `f(MarketState, Window, Config)`,
  execution profiles, execution window manager, window FSM, multi-window execution,
  trade quota.
- **Trade Domain (M3)** — pure risk engine, exposure reservations, standing limit
  order engine, order FSM, retry/repricing, settlement.
- **Platform Services (M4)** — event store with mutation guards, replay engine,
  analytics, ledger, audit trail, Supabase sync policy.
- **Operations Platform (M5/M6.6)** — 18 operator routes: dashboard, markets,
  execution profiles, active windows, trade monitor, signal tank, replay, analytics,
  health, notifications, configuration, operations, deployment, qualification,
  ownership, engine registry, audit, system.
- **Hardening (M6/M6.5)** — startup validator (14 gates), watchdogs and heartbeats,
  graceful shutdown, deterministic recovery, operations runbook.
- **Configuration synchronization (M6.7)** — immutable configuration versions,
  deterministic hashing, saved-vs-active runtime state (ADR-0003).
- **Authority handshake (M6.8/M7.5/M7.6)** — authority registry, HMAC-SHA256 signed
  gateway with replay guards, PM2 restart detection (ADR-0004).
- **Feed provider abstraction (M7.0)** — environment-only V1 testnet → V2 mainnet
  switch (ADR-0005).
- **Single-operator auth (M7.1–M7.3)** — first registration becomes OWNER,
  bootstrap lockout, ownership finalization.
- **Supabase provider abstraction (M7.4)** — fully environment-driven backend, no
  hardcoded project identifiers, backend identity diagnostics.
- **Qualification (M7.7–M7.10)** — deterministic scenario harness, live authority
  gates, activation checklist, startup evidence.
- **Production audit (M8.0/M8.1)** — mainnet readiness gate, incident and
  diagnostics center, normalized audit records, backup and recovery guide.
- **Release engineering (M8.2/M8.3)** — environment templates for companion, VPS
  and production; environment preflight (`scripts/check-env.mjs`); PM2 definitions
  (`ecosystem.config.cjs`); `test` / `typecheck` / `verify` scripts; automated
  security sweep; production setup guide.

### Security

- Authority signing key, service-role key and VPS tokens are server-only; the
  system page reports status and source, never a value.
- Automated tests assert no committed secrets, no service-role or signing-key
  exposure in client-reachable modules, and no authority bypass path.
- RLS enabled with explicit grants on every public table; roles stored in a
  dedicated `user_roles` table behind a security-definer `has_role`.

### Notes

- Live VPS activation, PM2 start, and live authority qualification are deliberately
  manual production steps and are not claimed as complete by this release.
