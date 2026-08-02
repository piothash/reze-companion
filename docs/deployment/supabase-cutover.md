# ARC — Production Supabase Cutover

Status: ready to execute · Milestone M7.5 · Owner: single operator

This procedure moves the ARC Companion control plane from the development
backend to the production Supabase project. It changes **nothing** about the
architecture: the companion stays the control plane and the VPS remains the
sole trading authority (ADR-0001).

Production target:

```
https://wwapjpucrmrocnmkvjkm.supabase.co
```

This URL is deliberately **not** compiled into the application. It is supplied
at deployment time and enforced through `ARC_REQUIRED_SUPABASE_URL`
(`tests/unit/m75-cutover-authority.test.ts` fails the build if any project
reference is hard-coded).

---

## 1. Required environment variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | server | Control-plane backend URL. |
| `SUPABASE_ANON_KEY` | server | Publishable key for unauthenticated reads (RLS applies as `anon`). |
| `SUPABASE_SERVICE_ROLE_KEY` | server, secret | Privileged operations only: ownership migration and global session revocation. Never sent to the browser. |
| `ARC_REQUIRED_SUPABASE_URL` | server | Cutover guard. When set, every other backend is refused. |
| `VITE_SUPABASE_URL` | browser | Same URL, browser client. |
| `VITE_SUPABASE_ANON_KEY` | browser | Same publishable key, browser client. |
| `ARC_ENVIRONMENT` / `ARC_NETWORK` | server | Reported on System and in the status strip. |

Optional: `ARC_GIT_COMMIT`, `ARC_DEPLOYED_AT`, `ARC_FEED_PROVIDER`, `ARC_FEED_ID`.

The service-role key and the database password are **never** read by browser
code, never logged and never rendered. The System page reports only whether a
privileged key is present.

---

## 2. Migration order

Execute in this order. Do not skip step 2 — the Data API returns permission
errors without `GRANT`s, even with correct RLS.

1. **Create the project** and record its URL and publishable key.
2. **Apply the ARC schema migrations** in chronological order. Every
   `CREATE TABLE` in `public` is followed by `GRANT`, then
   `ENABLE ROW LEVEL SECURITY`, then policies.
3. **Verify the required tables** with the checklist in section 4 (System →
   Control Plane Migration). Never recreate an existing table.
4. **Configure auth**: email/password only, `auto_confirm_email = true`,
   signups **enabled** (bootstrap needs one registration).
5. **Set the environment variables** from section 1, including
   `ARC_REQUIRED_SUPABASE_URL` pointing at the production URL.
6. **Deploy** the companion.
7. **Bootstrap the operator**: open `/auth`, create the intended production
   operator account. That first account becomes `owner`.
8. **Finalize ownership** at `/ownership`. This demotes any provisional owner,
   revokes prior sessions, and closes public registration permanently.
9. **Disable signups** in the auth provider settings as a second lock.
10. **Register the VPS trading authority** (M7.6): the engine calls
    `POST /authority/register`, then keeps its record live with
    `POST /authority/heartbeat`.

---

## 3. Verification steps

Every check is observable from the running app — no dashboard access required.

| # | Check | Where | Expected |
| --- | --- | --- | --- |
| 1 | Backend identity | System → Backend Connection | `Project` = production ref, `URL` masked |
| 2 | Cutover guard | System → Backend Connection | `Expected Backend` set, `Match` = **PASS** |
| 3 | Database reachable | System → Backend Connection | `Database` = HEALTHY |
| 4 | Auth reachable | System → Backend Connection | `Auth` = HEALTHY |
| 5 | Privileged key | System → Backend Connection | `Privileged Key` = CONFIGURED |
| 6 | Schema complete | System → Control Plane Migration | every row `PRESENT`/`SATISFIED` |
| 7 | Ownership | System → Backend Connection | `Ownership` = FINALIZED after step 8 |
| 8 | Registration closed | `/auth` | "Operator finalized — registration closed" |
| 9 | Session persistence | reload the console | no repeated sign-in |
| 10 | Configuration path | Execution Profiles → publish | version stored, verdict returned by the VPS |
| 11 | Authority registry | Engine Registry → Trading Authority Registry | registered authority visible, `Last Seen` advancing |
| 12 | Audit trail | `/audit` | ownership + configuration + authority entries present |

**Fail-closed behaviour.** If `ARC_REQUIRED_SUPABASE_URL` does not match the
active backend, the companion refuses:

- sign-in and bootstrap registration (`/auth` shows the mismatch banner),
- ownership transfer and finalization,
- configuration publish, activate and archive,
- trading authority registration and revocation.

Reads remain available so an operator can diagnose the mismatch.

---

## 4. Required control-plane tables

The checklist is evaluated live by `arc_schema_report()` and rendered on the
System page. Logical names come from the cutover specification; where an
existing table already implements the contract it is reused rather than
duplicated.

| Logical name | Implemented by | Notes |
| --- | --- | --- |
| `operator_ownership` | `operator_ownership` | Ownership record + finalization flag. |
| `configuration_versions` | `configuration_versions` | Immutable versions. |
| `audit_log` | `audit_log` | Append-only operator trail. |
| `operator_sessions` | `user_roles` | Session material stays in `auth.sessions`; only operator identity/capabilities are mirrored into `public`. |
| `authority_registry` | `authority_registry` | Public identity of VPS authorities (M7.5). |
| `configuration_dispatch` | `configuration_versions` | Dispatch verdict fields (`status`, `reason_code`, `correlation_id`, `applied_at`) live on the version row — one source of truth, no divergence. |
| `runtime_mirrors` | `runtime_configuration_state` | Read-only mirror of what the VPS reports as running. |

A missing table is **reported**, never silently recreated.

---

## 5. Rollback procedure

The cutover is reversible until ownership is finalized on the new backend.

1. **Stop writes.** Set `ARC_REQUIRED_SUPABASE_URL` to the old backend URL. All
   mutating actions on the new backend fail closed immediately.
2. **Repoint** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   and the `VITE_` equivalents to the previous project.
3. **Redeploy.** No code change is required — the backend is environment-driven.
4. **Verify** section 3 checks 1–6 against the old backend.
5. **Reconcile configuration.** Immutable versions written on the new backend
   are not migrated automatically: republish the intended profile from the
   console so the VPS issues a fresh verdict.
6. **Leave the new project intact** for forensic comparison. Nothing is dropped.

After ownership is finalized on the new backend, rollback additionally requires
re-finalizing ownership on the old backend, because registration there is
already closed.

---

## 6. Non-goals

This procedure never:

- moves trading logic, decision-making or order execution into the companion,
- stores VPS private keys, wallet keys, exchange credentials or execution
  secrets in Supabase or the browser,
- lets the dashboard write authoritative runtime trading state (ledger records
  and platform events originate from the VPS).
