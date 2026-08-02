# ADR-0004 — VPS authority registration, runtime handshake and mirror staleness

- **Status:** Accepted
- **Session:** M6.8 (tracker section M6.10)
- **Supersedes:** none
- **Amends:** ADR-0001 (control plane), ADR-0003 (configuration synchronization)

## Context

The companion needed a defined way to discover, authenticate against and stay
synchronized with the VPS trading engine. Before this ADR the console inferred
connectivity from a health probe, and no contract existed for *who the engine
is*, *what it is running*, or *whether what the operator saved is what the
engine is actually executing*. Absent that contract, a dashboard can silently
show plausible values while the trading authority is unreachable — the single
most dangerous failure mode for a control plane.

## Decision

1. **Registration stores public identity only.** `engine_endpoints` holds name,
   environment, base URL, API/engine/platform version, handshake and health
   paths, an optional public identifier and a sync interval. Registration input
   is rejected when it contains credential-shaped material (bearer tokens, hex
   keys, mnemonics, URL userinfo). The companion authenticates to the engine
   with a server-side bearer credential read from the runtime environment; it is
   never persisted in the database and never reaches the browser.

2. **One canonical handshake.** `GET {handshakeEndpoint}` must return the
   document validated by `handshakeResponseSchema`: engine id, environment,
   network, versions, uptime, running configuration (version, hash, snapshot id
   and hash), scheduler status, feed status, current market and per-subsystem
   health. A non-conforming answer is `PROTOCOL_MISMATCH`, never success.

3. **The dashboard never invents runtime facts.** Connection state is derived
   only from the transport outcome and the engine's own answer:
   `UNREGISTERED`, `CONNECTING`, `CONNECTED`, `DISCONNECTED`, `UNAUTHORIZED`,
   `CONFIGURATION_PENDING`, `CONFIGURATION_APPLYING`, `CONFIGURATION_ACTIVE`,
   `CONFIGURATION_REJECTED`. Unreported fields render as `—`.

4. **Verification is explicit.** Saved configuration (latest `ACTIVE`
   `configuration_versions` row) is compared field-by-field against the running
   configuration reported by the engine. Any difference is `DRIFT` with a
   per-field reason; a missing engine answer is `UNKNOWN`, never `MATCH`.

5. **Mirror staleness policy.** Each successful handshake upserts
   `engine_runtime_identity`. When a handshake fails, the console returns the
   mirrored values with `connection.live = false` and labels them as mirrored
   from the last successful sync. A mirror is never presented as a live read,
   never satisfies verification, and never marks the engine connected.

6. **Continuous synchronization.** The console re-handshakes on load, on the
   registered per-engine interval, on window focus and on network reconnect, so
   a PM2 restart, VPS reboot, refresh or connectivity loss recovers with no
   operator action.

7. **Role separation.** Registration, activation and deletion require the
   operator or admin role; viewers may read runtime state only. Every mutation
   is written to the audit trail.

## Alternatives considered

- **Health probe only.** Rejected: liveness is not identity, and it cannot
  answer what configuration the engine is running.
- **Engine pushes state to Supabase.** Rejected: it would make the database the
  apparent authority and allow stale rows to look live (ADR-0001).
- **Storing engine credentials in `engine_endpoints`.** Rejected outright:
  credentials never enter the control-plane database.

## Consequences

- The dashboard can distinguish "no engine", "engine down", "credential
  rejected", "protocol mismatch" and "configuration drift" — each with a reason
  code and operator next action.
- Trading behaviour is unchanged. The companion still executes nothing; M7 live
  connectivity plugs into this handshake without re-architecting.
- Every runtime field on screen is traceable to either a live handshake or an
  explicitly labelled mirror.
