# M7.9 — Security Finalization, Authority Activation & Live Gate Completion

**Status:** control-plane work complete · live gates remain PENDING/FAIL until the
operator runs the activation sequence against the real VPS.
**Scope:** operational activation only. No architecture change, no trading logic.
**Authority statement:** the companion is the control plane. The VPS remains the sole
trading authority.

---

## 0. Honest verdict

The acceptance criteria for M7.9 are *environment* outcomes, not code outcomes:
signing key present on both sides, ownership finalized, VPS ACTIVE, live gates green.
None of those can be closed from inside the companion, and none of them were
simulated, stubbed, or force-passed to make the console look green.

What M7.9 delivers is the machinery that closes them and proves when they are closed:

| Criterion | State | Closed by |
| --- | --- | --- |
| Signing authentication active | **Enforced, key not configured** | Operator sets `ARC_AUTHORITY_SIGNING_KEY` on both sides |
| Ownership finalized | **Not finalized** | Operator finalizes at `/ownership` |
| VPS authority ACTIVE | **Not registered** | Engine sends a signed registration + heartbeats |
| Startup PASS | PENDING | Engine startup telemetry |
| Configuration PASS | PENDING | Publish → pull → hash → ACCEPTED round-trip |
| Telemetry PASS | PENDING | Live telemetry with all mandated fields |
| Security PASS | **FAIL** | The first two rows above |
| Tests green | **PASS** | 383 tests, 27 files |

The qualification console reports exactly this. A gate that has no evidence reads
PENDING; a gate whose precondition is provably absent reads FAIL.

---

## 1. Authority signing key validation

Verified against `src/lib/authority-gateway.server.ts`,
`src/core/platform/authority-signature.ts` and `tests/unit/m76-authority-handshake.test.ts`:

| Requirement | Enforcement | Evidence |
| --- | --- | --- |
| VPS must provide signed registration | HMAC-SHA256 over a canonical, key-order-independent payload | "signs a canonical payload independent of key order" |
| Companion verifies signature | Constant-time compare in the gateway before any write | "accepts a correctly signed, fresh message" |
| Unsigned authority rejected | Registration without a signature is refused | "rejects an unsigned registration" |
| Invalid signatures rejected | Wrong key and tampered payload both refused | "rejects a registration signed with the wrong key", "rejects a tampered payload" |
| Replay timestamps rejected | ±60s skew window + `authority_replay_guard` nonce table (15 min) | "rejects a stale registration timestamp", "rejects a replayed registration" |
| No key configured | **Fail-closed** — every message refused with `KEY_UNCONFIGURED`, never accepted unsigned | "never accepts unsigned messages when no key is configured" |

**Key presence:** `ARC_AUTHORITY_SIGNING_KEY` is **not currently configured** on the
companion. This is a *shared* secret: the identical value must exist on the VPS engine.
Because it must be readable by a human to paste into the VPS environment, it cannot be
generated as an opaque managed secret — the operator generates it
(`openssl rand -hex 32`), stores it on the VPS, and saves the same value here.

Until then the gateway is safe but closed: no authority can register, which is why
`register` shows BLOCKED rather than WAITING.

---

## 2. Ownership finalization validation

Lifecycle, as implemented in `handle_new_user()`, `transfer_ownership()` and
`finalize_ownership()`:

```
no owner → first operator account created → OWNER + OPERATOR roles granted
        → /ownership finalize → operator_ownership.finalized = true
        → registration permanently disabled
```

After finalization:

| Requirement | Enforcement |
| --- | --- |
| No signup | `auth-state.server.ts` resolves BOOTSTRAP_OPEN only when there is no owner, ownership is not finalized and signup is enabled; the Create Account path disappears |
| Owner login only | Sign-in remains available; new account creation does not |
| Sessions remain valid | Finalization changes no session state; existing JWTs continue to refresh |
| Audit entry created | `finalize_ownership()` inserts `ownership.finalized` into `audit_log` inside the same transaction |
| Irreversible | `transfer_ownership()` raises once `finalized` is true — migration is disabled in production |

**Current state:** ownership is **not finalized**, so the `security.posture` gate fails.
Finalizing is a one-way operation; it is deliberately left to the operator.

---

## 3–6. Live authority activation, configuration, startup and telemetry

M7.9 adds a pure **activation checklist** (`src/core/qualification/activation.ts`) that
turns the M7.8 evidence snapshot into the ordered operator sequence, with each step
attributed to its owner and each state derived from evidence:

| # | Owner | Step | Closes when |
| --- | --- | --- | --- |
| 1 | OPERATOR | Shared signing key on both sides | Gateway verifies instead of fail-closing |
| 2 | OPERATOR | Ownership finalized | `ownership_finalized()` = true |
| 3 | VPS | Authority registers | Non-revoked registry row |
| 4 | VPS | ACTIVE with fresh heartbeat | Heartbeat within 2× interval, runtime identity + latency present |
| 5 | VPS | Startup chain reported | configuration → feed → discovery → PTB → TWAP → signal → market state → windows armed |
| 6 | OPERATOR | Configuration round-trip | Runtime LIVE, hash match, snapshot id, no drift |
| 7 | VPS | Telemetry complete and current | LIVE source within budget, all 8 mandated fields |

States are `DONE` / `READY` / `WAITING` / `BLOCKED`. Properties enforced by tests:

- VPS steps are `BLOCKED` until *both* operator prerequisites are `DONE` — finalizing
  ownership alone does not unblock registration.
- A step never self-reports `DONE`; it needs the same evidence the M7.8 gate needs.
- Regression reopens steps: a silent heartbeat reopens step 4, configuration drift
  reopens step 6, mirrored (non-live) telemetry reopens step 7.
- Missing telemetry fields are named individually rather than collapsing to a failure.

Observed now (preview, no VPS): **0/7 DONE** — steps 1 and 2 `READY`, steps 3–7 `BLOCKED`.
That is the correct reading of an unactivated environment.

---

## 7. Operator activation runbook

1. `openssl rand -hex 32` → set as `ARC_AUTHORITY_SIGNING_KEY` on the VPS engine, and
   save the identical value on the companion.
2. Sign in as the intended operator, open `/ownership`, finalize. Confirm the
   `ownership.finalized` entry in `/audit`.
3. Start the PM2 engine. It POSTs a signed registration to
   `/api/public/authority/register`, then heartbeats on its declared interval.
4. Confirm `/engine-registry` shows **ACTIVE**, a runtime identity, a fresh heartbeat
   and a reported latency.
5. Publish an execution profile version. The engine pulls it, hash-validates it and
   returns a signed `ACCEPTED`; runtime status becomes LIVE.
6. Reload `/qualification`. The checklist should read **7/7 DONE** and the M7.8 live
   gates should all read PASS — with no code change, because the gates read evidence.

---

## 8. Conformance

- No trading decision, TWAP computation, risk evaluation or order routing added.
- `docs/reference/p4/**` untouched.
- No ADR required — M7.9 implements ADR-0001, ADR-0004 and ADR-0005 operationally.
- Activation checklist is pure and deterministic; the evidence collector is
  authenticated (`requireSupabaseAuth`) and read-only.
- Tests: 383 passing across 27 files.

**Next:** M8.0 — Final Production Audit & Mainnet Qualification, which should begin only
after the seven activation steps read DONE against the live testnet authority.
