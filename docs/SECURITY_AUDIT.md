# ARC — Security Audit (M6)

Status: **PASS with 1 accepted warning**
Enforcement: `tests/unit/security.test.ts` (8 static tests, run in CI)

## 1. Secrets

| Control | Result |
| --- | --- |
| No hardcoded credentials (JWTs, `sb_secret_*`, private keys, key literals) | PASS (automated) |
| Service-role key and DB URL never reachable from the browser bundle | PASS (automated) |
| `process.env` read only in server modules / handlers | PASS (automated) |
| Wallet keys and exchange credentials absent from the repo | PASS — the companion never signs or trades |
| `.env`, `*.db*` git-excluded | PASS |
| No secret values in logs | PASS (automated) |

## 2. Authorization and data access

| Control | Result |
| --- | --- |
| Every server function requires `requireSupabaseAuth` | PASS (automated) |
| Every mutating (`POST`) server function validates input with Zod | PASS (automated) |
| No server function uses the service-role client | PASS (automated) — all app reads run as the user under RLS |
| Roles stored in a dedicated `user_roles` table, never on `profiles` | PASS |
| Role checks use the `SECURITY DEFINER` `has_role()` function | PASS |
| RLS enabled on all 13 public tables | PASS |
| Append-only tables (`platform_events`, `ledger_records`, `analytics_summaries`, `audit_log`) deny UPDATE/DELETE | PASS |
| Public routes expose no user data, no admin client, no credentials | PASS (automated) |

## 3. Input validation

All operator inputs (execution profile fields, replay ranges, list limits) are parsed with Zod
at the server boundary, with bounded ranges and enum-constrained modes. Engine configuration is
parsed with Zod at load time and fails closed — an invalid environment throws rather than
silently defaulting.

## 4. Rate limiting and abuse surface

The only unauthenticated surface is `GET /api/public/health`, which returns static liveness and
version data with no user scope and no database read. Every other endpoint is authenticated and
RLS-scoped, so per-user database policies are the effective rate boundary. No write endpoint is
publicly reachable.

## 5. Accepted linter warning

`0029_authenticated_security_definer_function_executable` — `public.has_role(uuid, app_role)`
is executable by `authenticated`. This is required and intentional: it is the canonical
non-recursive role check used by RLS policies and by privileged server-side verification. It is
`STABLE`, returns only a boolean, and has `search_path = public` pinned. `handle_new_user()` and
`update_updated_at_column()` are **not** granted to `authenticated`.

## 6. Residual risks

- Operator accounts are the trust boundary; there is no admin approval flow for new sign-ups.
  Enable email confirmation and restrict sign-ups before production exposure.
- Leaked-password protection (HIBP) should be enabled in auth settings prior to go-live.
