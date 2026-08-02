# M7.8 — Live Authority Qualification & Production Audit Preparation

**Status:** Framework complete · live gates PENDING until a VPS authority reports in
**Scope:** verification only. No trading logic, no strategy, no architecture change.
**Authority statement:** the companion is the control plane. The VPS remains the sole
trading authority. Every value on this page is *reported by* the authority — the
companion never computes, infers, or substitutes engine state.

---

## 1. What M7.8 adds

M7.7 proved the deterministic harness (lifecycle, multi-window, replay, recovery)
in-process. Those gates pass without a VPS. The gates M7.7 left `PENDING` are the
ones that can only be closed by a *real* authority: registration, startup chain,
configuration activation, telemetry completeness, and security posture.

M7.8 makes those gates measurable:

| Artifact | Purpose |
| --- | --- |
| `src/core/qualification/live-gates.ts` | Pure evidence model + gate evaluator (no I/O) |
| `src/lib/qualification.functions.ts` | Authenticated server fn that collects live evidence |
| `src/routes/_authenticated/qualification.tsx` | "Live Authority Gates — M7.8" panel |
| `tests/unit/m78-live-authority.test.ts` | 23 tests over the evaluator and startup chain |

The evaluator is a pure function of an `LiveEvidenceSnapshot`. It cannot reach the
network, so gate outcomes are reproducible from a recorded snapshot — the same
property M7.7 established for replay.

---

## 2. Gate definitions

### 2.1 `authority.active` — VPS authority is ACTIVE

Requires a registered authority reporting `ACTIVE`, with:
- a runtime identity (PM2 process identity), proving the handshake carried process provenance;
- a heartbeat within **2× the reported heartbeat interval** (floor 30s, ceiling 120s);
- a measured round-trip latency.

`PENDING` when no authority row exists. `FAIL` when a registered authority is stale,
anonymous, or silent — a registered-but-dead engine is a failure, not an absence.

### 2.2 `startup.chain` — Startup chain completes

The mandated order:

```
configuration → feed → discovery → PTB → TWAP → signal → market state → windows armed
```

Derived by `deriveStartupChain()` strictly from telemetry the authority publishes.
An unreported step is **not** ok — the companion never infers a step it was not told
about. Control-plane (companion) startup problems are recorded as notes and never
presented as a VPS verdict; conflating the two was the defect this milestone removed.

### 2.3 `configuration.activation` — Configuration activation round-trip

Requires runtime status `LIVE`, a runtime config hash equal to the published hash, a
non-null snapshot id, matching versions, and no drift. This closes the M6.7 contract:
UI → immutable version → VPS validation → activation → event → UI refresh.

### 2.4 `telemetry.complete` — Telemetry is complete and current

Requires `source = LIVE` (mirrored/cached telemetry cannot qualify an engine), an
emission within the sync budget, and every mandated field present:

`runtimeStatus · runtimeIdentity · engineVersion · activeMarket · activeWindows ·
eventSequence · configurationVersion · latencyMillis`

### 2.5 `security.posture` — Control-plane security posture

Requires signature-verified handshakes (`ARC_AUTHORITY_SIGNING_KEY` configured),
finalized operator ownership, and the registry trigger rejecting secret material.

---

## 3. Current observed result (preview environment, no VPS registered)

| Gate | Status | Evidence |
| --- | --- | --- |
| `authority.active` | PENDING | No authority registered |
| `startup.chain` | PENDING | No engine telemetry |
| `configuration.activation` | PENDING | No runtime mirror |
| `telemetry.complete` | PENDING | No live telemetry source |
| `security.posture` | FAIL | Signing key not configured; ownership not finalized |
| **Live verdict** | **FAIL** | Security posture must be closed before cutover |

This is the correct reading. `PENDING` never silently becomes `PASS`: absence of
evidence is never evidence of qualification.

Deterministic M7.7 gates remain green: 368 tests across 26 files pass.

---

## 4. Production audit preparation — remaining operator actions

These are environment actions, not code changes:

1. **Configure `ARC_AUTHORITY_SIGNING_KEY`** on both the companion and the VPS
   (shared HMAC secret). Closes half of `security.posture`.
2. **Finalize operator ownership** at `/ownership` after the intended owner account
   exists. Closes the other half.
3. **Register the VPS authority** against `/api/public/authority/register` with a
   signed payload. Moves `authority.active` off PENDING.
4. **Start the PM2 engine** and let it publish heartbeats and telemetry. Moves
   `startup.chain` and `telemetry.complete`.
5. **Publish a configuration version** and confirm the authority activates it.
   Moves `configuration.activation`.

When all five are done, the live panel reports `PASS` with no code change — the gates
read live evidence, they are not toggled.

---

## 5. Conformance

- No trading decision, TWAP computation, risk evaluation, or order routing was added.
- `docs/reference/p4/**` untouched.
- No architecture change; no ADR required (M7.8 is an implementation of ADR-0004 and ADR-0005).
- Evaluator is pure and deterministic; server fn is authenticated (`requireSupabaseAuth`).
