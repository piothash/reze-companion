# M8.1 — Production Hardening Final Pass (Post Audit)

**Status:** Complete
**Scope:** Operational hardening only. No architecture change, no strategy
change, no live VPS activation.
**Authority model:** unchanged — the VPS is the sole trading authority; the
companion is a read-only control plane (ADR-0001).

---

## 1. What M8.1 addressed

The M8.0 audit returned `READY (control plane)` with the remaining gaps all
operational rather than architectural: an operator facing a real production
fault had evidence scattered across `/qualification`, `/health` and the engine
registry, error surfaces that stated *what* failed but not *what to do*, and
audit records whose shape varied by call site.

M8.1 closes those gaps.

| # | Deliverable | Surface |
| --- | --- | --- |
| 1 | Incident & diagnostics center | `/operations` |
| 2 | Actionable production error model | `src/core/platform/operator-incident.ts` |
| 3 | Normalized audit records | `src/core/platform/audit-record.ts`, `src/lib/audit-trail.server.ts` |
| 4 | Backup & recovery documentation | `docs/operations/BACKUP_AND_RECOVERY.md` |
| 5 | Final security sweep | automated tests |
| 6 | Deployment checklist | `/deployment` |
| 7 | This report | `docs/operations/M8_1_PRODUCTION_HARDENING_REPORT.md` |

---

## 2. Production incident & diagnostics center (`/operations`)

A single read-only surface answering "what is wrong right now, and what do I
do about it".

- **Authority** — registration, environment, runtime identity, last heartbeat,
  heartbeat age against the reported interval, event sequence.
- **Configuration** — published version and hash versus runtime version and
  hash, with explicit drift detection.
- **Startup chain** — the ordered VPS startup steps from M7.8, each `PASS`,
  `WAITING` or `FAILED`.
- **Open incidents** — every detected problem rendered as the mandated
  five-field structure.

The page issues no commands. It cannot start, stop, restart or reconfigure the
engine.

### Incident derivation is pure

`deriveOperationsDiagnostics(snapshot)` is a pure function over the same
evidence snapshot the qualification console already consumes. No incident is
invented, and — critically — **absent evidence never becomes a passing
verdict**. An unregistered authority produces an incident, not silence.

---

## 3. Production error handling

Every incident carries all five mandated fields:

| Field | Meaning |
| --- | --- |
| **Problem** | What is broken, in operator language |
| **Reason** | Why the control plane believes it |
| **Missing evidence** | The specific observation that is absent |
| **Required action** | What the operator must do, on which system |
| **Expected recovery** | The observable signal that proves it worked |

Incidents are severity-ranked `CRITICAL` → `WARNING` → `INFO`. Severity
reflects operational impact, not diagnostic confidence.

Covered failure classes: authority never registered, heartbeat stale,
authority revoked, configuration never published, configuration pending
activation, configuration rejected, configuration drift, incomplete startup
chain, failed startup gates, missing telemetry, event sequence regression.

Every "required action" targets the VPS or the operator — never the companion —
because the companion cannot remediate a trading-authority fault.

---

## 4. Audit log normalization

Previously each call site wrote its own `audit_log` shape. All operator-visible
writes now pass through `recordOperatorAudit`, which builds a normalized record:

```
actor · action · resource · resourceId · result · correlationId · timestamp · detail
```

Normalized call sites: configuration publish/activate/reject, configuration
archive apply, execution profile update, authority registration, authority
revocation, authority handshake (accepted and rejected), engine endpoint
lifecycle.

Two properties matter:

- **Rejections are recorded.** A refused handshake or rejected configuration is
  an audit fact. Only recording successes would make the trail useless for
  incident review.
- **Secrets are redacted at the model layer.** `audit-record.ts` strips
  key-like fields from `detail` before it reaches the database, so a careless
  caller cannot leak signing material into the audit trail.

Correlation IDs propagate from the configuration sync flow, so a publish can be
traced end to end.

---

## 5. Backup & recovery

`docs/operations/BACKUP_AND_RECOVERY.md` documents the backed-up asset
inventory, schedule and retention, RPO/RTO targets, and step-by-step recovery
for: VPS process crash, VPS host loss, Supabase corruption, event sequence
regression, signing key compromise, and ownership record loss.

Three constraints are stated explicitly because they are easy to get wrong
under pressure:

- Never `cp` a live SQLite file — use the online backup API or stop the engine.
- Control-plane loss does not stop trading and must never be used as an
  emergency stop.
- If ownership was finalized, restore it — never re-bootstrap, which would hand
  owner rights to whoever registers next.

Backups are verified on a monthly cadence; an unverified backup is treated as
no backup.

---

## 6. Final security sweep

Automated checks (in the test suite, so they run on every change rather than
once):

| Check | Result |
| --- | --- |
| No hardcoded secrets, private keys or service-role keys in `src/` | PASS |
| Service-role key confined to server-only modules | PASS |
| No Supabase project ID hardcoded outside generated integration files | PASS |
| Audit detail redacts key-like fields | PASS |
| Authority handshake requires a valid HMAC signature | PASS |
| Replayed signatures rejected by the replay guard | PASS |
| `authority_registry` rejects private-key-shaped material | PASS |
| Roles stored in a separate `user_roles` table, never on profiles | PASS |
| Role checks go through the `has_role` security-definer function | PASS |
| Ownership finalization is irreversible | PASS |
| Signups locked after bootstrap | PASS |
| RLS enabled with explicit grants on every public table | PASS |
| Event, ledger and configuration tables reject `UPDATE`/`DELETE` | PASS |

No exposure of `SUPABASE_SERVICE_ROLE_KEY`, signing secrets, wallet keys or
exchange credentials to client code was found.

---

## 7. Deployment checklist (`/deployment`)

A read-only checklist across four sections — Environment, VPS Authority,
Trading Readiness, Qualification — each item `PASS`, `PENDING` or `FAIL` with
the evidence that decided it.

**Nothing on the page is tickable by hand.** An item closes only on observed
evidence. This is deliberate: a checklist an operator can tick under deployment
pressure records intent, not readiness.

Expected state before live activation: Environment and Qualification `PASS`;
VPS Authority and Trading Readiness `PENDING` until the real engine registers.

---

## 8. Verification

- Full test suite green, including new coverage for incident derivation, audit
  normalization and redaction, deployment checklist evaluation, and the
  security sweep.
- Architecture conformance tests still pass: no trading logic, no order
  placement, no risk evaluation in the companion.
- `/operations` and `/deployment` verified to render correctly with authority
  evidence absent — the pre-activation state — without loading forever or
  reporting false green.

---

## 9. Standing limitations

- Every VPS-dependent item stays `PENDING` until the real trading authority
  registers. That is the honest state, not a defect.
- The companion cannot remediate faults. Every required action names the VPS.
- Analytics and ledger data mirrored from the VPS are only as complete as what
  the VPS reports.

---

## 10. Verdict

**M8.1 — Production Hardening Final Pass: COMPLETE.**

The control plane is operationally ready: faults are diagnosable, actions are
stated, the audit trail is uniform and rejection-inclusive, recovery is
documented and rehearsable, and deployment readiness is evidence-derived rather
than self-attested.

Live VPS activation remains outstanding and is deliberately out of scope.
