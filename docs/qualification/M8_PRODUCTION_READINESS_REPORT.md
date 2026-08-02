# M8.0 — Final Production Audit & Mainnet Qualification

Scope: **verification and hardening only.** No trading strategy was added, no
frozen contract was modified, no domain engine was changed.

Frozen architecture, unchanged:

```
VPS Trading Authority → Trading Engine → Supabase Control Plane → Operator Dashboard
```

The dashboard monitors, publishes configuration, shows audit history and runs
operations. It never executes trades, never owns runtime state, never overrides
the VPS and never stores trading secrets.

---

## 1. Architecture audit — **PASS**

| Check | Result | Evidence |
| --- | --- | --- |
| Dependency direction `shared → contracts → configuration → infrastructure → market → decision → trade → platform` | PASS | `tests/unit/architecture.test.ts` walks every `src/core` file and fails the build on a backward import |
| Engine isolation | PASS | No engine imports another engine's internals; each is reached through its domain contract |
| Strategy isolation | PASS | Decision engine is a pure `f(MarketState, WindowInstance, Config) → Decision`; no I/O, no clock |
| Execution isolation | PASS | Order lifecycle is confined to the trade domain and driven by `ORDER_FSM` |
| Configuration ownership | PASS | Operator edits produce immutable versions; the authority alone activates them |
| Authority ownership | PASS | The companion never mutates runtime state; it mirrors what the authority reports |

Enforced continuously — the architecture suite is part of the test run, so a
violation fails the build rather than the review.

## 2. VPS authority validation — **evidence-gated**

Registration evidence: **Authority Registered · Runtime Identity Present ·
Signature Valid · Heartbeat Fresh.** All four are required.

States: `ACTIVE` · `STALE` · `REVOKED` · `UNREGISTERED`, derived in
`src/core/platform/authority-presentation.ts`. There is no manual override —
the console cannot set a status, only report one.

## 3. PM2 production validation

See `docs/deployment/M8_PM2_VALIDATION.md`. Process supervision, reboot
persistence, environment validation, secret loading, health endpoint, graceful
shutdown and restart-without-duplication are validated on the VPS and reported
to the control plane as telemetry.

## 4. Replay qualification — **PASS (deterministic)**

**Deterministic replay — must be identical.** Same recorded input reproduces
the same market-state progression, window FSM transitions,
`ExecutionIntentCreated` events, risk decisions, order lifecycle, settlement
events, ledger records and trade-quota progression. Verified by the digest
comparison in `replayEvents` with zero mismatches.

**External execution simulation — may differ.** Real exchange fills, latency
and partial fills are external inputs. They are recorded as evidence and
replayed as data; they are never asserted to be reproducible, and a difference
there is not a determinism failure.

## 5. Recovery qualification — **PASS**

Restart recovery restores execution context, active windows, quota state and
exposure reservations, and suppresses duplicate intents, orders, settlements
and ledger entries. Idempotency keys on the canonical event envelope carry the
suppression; `tests/unit/recovery.test.ts` and the M7.7 harness prove it.

## 6. Configuration production audit — **PASS**

```
Operator Edit → Configuration Version → Hash → VPS Pull → Validation → Accepted → Runtime Active
```

- No drift: the runtime hash is compared to the published hash on every read;
  a mismatch reports `DRIFTED` rather than `ACTIVE`.
- No unauthorized changes: versions are immutable (`configuration_versions_immutable`
  trigger); RLS scopes every row to the owning operator.
- Rollback: republishing an earlier configuration creates a new version with the
  earlier body — history is never rewritten.
- Archive: superseded versions remain queryable with their hash and status.

## 7. Security final audit — **PASS (control plane)**

**Secrets** — no secret is present in the frontend bundle, in logs or in the
database. The service role key and the authority signing key are read inside
server handlers only. The registry rejects secret material at the database
level (`authority_registry_reject_secrets`). The System page shows signing-key
*metadata* only.

**Authority security** — HMAC-SHA256 signature validation, a bounded timestamp
window, a persisted replay guard and rejection of revoked authorities. Missing
key ⇒ fail closed (`503 KEY_UNCONFIGURED`).

**Operator security** — ownership finalized and registration permanently
closed; sessions are Supabase-issued and RLS-scoped; the audit trail is
append-only (no UPDATE, no DELETE).

## 8. Dashboard audit — **PASS**

| Surface | Shows |
| --- | --- |
| Dashboard | VPS state, engine state, market state, windows, telemetry |
| Markets | Authoritative market information as published by the engine |
| Execution Profiles | Active configuration, version, hash, runtime status |
| Trade Monitor | Intent → Risk → Order → Fill → Settlement → Ledger |
| Replay | Replay runs, digest, mismatches |
| Qualification | All gates, evidence and blockers |

## 9. Production monitoring

See `docs/operations/M8_MONITORING.md` for metrics (heartbeat latency, event
processing latency, replay duration, recovery duration, memory, error rate) and
the mandatory log fields (correlation ID, authority ID, runtime identity,
event ID, reason code).

## 10. Mainnet readiness gate

`src/core/qualification/mainnet.ts` evaluates eight domains and returns one
verdict. Rendered on `/qualification` as **Mainnet Readiness Gate — M8.0**.

| Domain | Source of truth |
| --- | --- |
| Architecture | Deterministic lifecycle, settlement, window ordering and quota gates |
| Replay | Digest equality with zero mismatches |
| Recovery | Duplicate-suppression gate |
| Security | Live security-posture gate |
| VPS | Authority ACTIVE + startup chain + startup validator |
| Configuration | Dispatch gate + live activation round-trip |
| Telemetry | Observability gate + live telemetry completeness |
| Operations | Activation checklist closed + uptime + monotonic event sequence |

`mainnetVerdict()` returns **QUALIFIED FOR MAINNET** only when all eight are
PASS; anything else is **NOT QUALIFIED**. The function takes no override
argument, no force flag and no operator attestation — a domain can only become
PASS because evidence arrived. `tests/unit/m8-production-audit.test.ts` asserts
that no override path exists and that the results are frozen.

## Current verdict

**NOT QUALIFIED** — as expected before a live mainnet authority runs.

Control-plane audit: **PASS on every item that does not require a running
authority.** Open domains and their owners:

| Domain | Blocker | Owner |
| --- | --- | --- |
| VPS | Authority ACTIVE with a fresh heartbeat and completed startup chain | VPS |
| Configuration | Live activation round-trip LIVE with matching hash | VPS |
| Telemetry | All mandated fields on a current live heartbeat | VPS |
| Security | Signing key present, ownership finalized | Operator |
| Operations | Activation checklist closed, uptime and monotonic sequence reported | VPS |

Each blocker is named with its required action on `/qualification`.

## Acceptance

| Criterion | Result |
| --- | --- |
| Build passes | ✅ |
| Lint passes | ✅ |
| Typecheck passes | ✅ |
| Tests pass | ✅ 429 |
| Security tests pass | ✅ |
| Architecture tests pass | ✅ |
| Documentation updated | ✅ |
| No frozen contract changed | ✅ |
| No trading logic changed | ✅ |
| No legacy strategy references | ✅ (asserted in test) |
| No secrets exposed | ✅ (asserted in test) |

**M8.0 Production Audit Complete — Status: READY** (control plane).
Mainnet gate: **NOT QUALIFIED** until the live authority supplies the five
remaining domains. Remaining work is real VPS operation, not architecture.
