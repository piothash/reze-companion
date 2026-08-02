# M7.10 — Production Activation Readiness & Operator Finalization Hardening

Status: **Complete (control-plane side)** · Scope: activation readiness only.
No architecture change. No strategy change. The VPS remains the sole trading
authority; the companion never executes trades and never overrides VPS runtime.

---

## 1. Operator activation flow hardening

Lifecycle: **Bootstrap → OWNER claimed → Finalized → Registration closed.**

`public.handle_new_user()` was hardened so that:

- the first real operator account to sign up claims `owner` and is written into
  `operator_ownership.owner_user_id`;
- once `operator_ownership.finalized` is true, **no** newly created account can
  claim ownership *or* receive the `operator` role;
- there is no seed, no hidden owner and no service-role backdoor that can create
  an owner without a real account;
- email verification is not required for the bootstrap operator.

`resolveOperatorBootstrapState()` remains the single authority for whether
registration is open (`BOOTSTRAP_OPEN`) or permanently closed
(`OWNER_FINALIZED`).

## 2. Signing key validation — metadata only

`src/lib/security.functions.ts` exposes `getAuthoritySigningStatus`, an
authenticated read that reports **metadata only**:

| Field | Meaning |
| --- | --- |
| `configured` | a key is present |
| `meetsMinimumLength` | ≥ 16 chars — the gateway's verification floor |
| `meetsRecommendedLength` | ≥ 32 chars |
| `securityStatus` | `ENFORCED` / `WEAK` / `FAIL_CLOSED` |
| `lastVerificationIso` | last verified authority message, from the audit trail |
| `ownershipFinalized`, `registrationOpen` | ownership lifecycle |

The key value is never returned, never logged, never persisted and never sent to
the browser. Only its length is read, and only to classify strength. Surfaced on
**System → Authority Signing**.

## 3. Authority activation diagnostics

`buildActivationChecklist()` now returns, for every step:
`reason` (current state), `evidence` (what is missing), `required` (the exact
call/page/command that produces it) and `transition` (what the console will show
next). `/qualification` renders those four lines for every step that is not
DONE. No step can be ticked by hand; all seven close on observed evidence only.

## 4. Engine registry

`src/core/platform/authority-presentation.ts` derives exactly one display status
per authority: **ACTIVE / STALE / REVOKED / UNREGISTERED**.

ACTIVE requires all three: signature verification enforced, a heartbeat inside
2× the declared interval, and a reported runtime identity. Anything else is
STALE with named blockers. The panel shows authority id, runtime identity,
engine version, heartbeat age, staleness deadline and latency.

## 5. Configuration activation visibility

`src/core/platform/configuration-activation.ts` collapses the publish round-trip
into **NOT_PUBLISHED → PENDING → ACCEPTED → ACTIVE**, with **REJECTED** and
**DRIFTED** as terminal reports. `ACTIVE` is returned only when the authority
confirms the running hash and snapshot on a *live* read; a mirrored value or a
stored `ACTIVE` row can never produce it.

## 6. VPS startup evidence

The startup chain is now nine ordered steps:

1. engine-online · 2. configuration-loaded · 3. feed-connected ·
4. market-discovery-ready · 5. ptb-available · 6. twap-running ·
7. signal-conditioning-ready · 8. authoritative-market-state · 9. windows-armed

Rendered by `StartupEvidencePanel` on `/qualification`. An unreported step shows
PENDING — the console never infers engine progress it was not told about.

## 7. Security tests

`tests/unit/m710-activation-readiness.test.ts` (25 tests) covers:

- unsigned message rejected (`MISSING_SIGNATURE`);
- no key configured → fail-closed (`KEY_UNCONFIGURED`);
- wrong-key signature rejected (`SIGNATURE_INVALID`);
- stale timestamp rejected;
- replayed signature rejected (`SIGNATURE_REPLAYED`);
- authority never ACTIVE without signature enforcement, fresh heartbeat and identity;
- configuration never ACTIVE without live authority confirmation;
- startup chain never infers unreported steps;
- every blocked activation step carries reason / required / transition.

Full suite: **408 tests green (28 files).**

## 8. Architecture compliance

- No trading logic added. No order placement, sizing, risk or TWAP computation.
- New modules are pure and evidence-only: `authority-presentation.ts`,
  `configuration-activation.ts`.
- No forbidden imports: routes import server functions, never `*.server.ts`;
  `docs/reference/p4/**` untouched.
- No secret material is displayed, stored or logged.

## 9. Remaining blockers (owned outside the control plane)

| Blocker | Owner |
| --- | --- |
| `ARC_AUTHORITY_SIGNING_KEY` set on companion + VPS | Operator |
| Ownership finalized at `/ownership` | Operator |
| Engine registration + heartbeat | VPS |
| Startup chain telemetry | VPS |
| Configuration pull → ACCEPT → LIVE | VPS |

`/qualification` names each of these with its required action.
