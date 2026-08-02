# ARC — Production Readiness Report (M6)

Milestone: M6 — Production Hardening
Verdict: **PRODUCTION READY (companion control plane)** — ready for qualification.

The companion is the control plane. The VPS remains the sole trading authority. Nothing in this
milestone changed that boundary (ADR-0001).

## 1. Readiness gate per subsystem

| Subsystem | Contract | Tests | Replay | Recovery | Observability | Security | Perf | Docs | Deploy | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Configuration | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Production Ready |
| Infrastructure | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Production Ready |
| Market State | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Production Ready |
| Decision | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Production Ready |
| Trade | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Production Ready |
| Platform | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Production Ready |
| Operations | ✅ | ✅ | n/a | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | Production Ready |

## 2. Quality gates

| Gate | Result |
| --- | --- |
| `bun run build` | clean |
| `bun run lint` | clean |
| `bunx tsgo` (typecheck) | clean |
| `bunx vitest run` | 209 tests / 16 files, all passing |
| Architecture conformance | automated, passing |
| Security conformance | automated, passing |

## 3. Configuration completeness

Every business value is environment- or profile-driven and validated at load: TWAP feed provider,
feed id, network (testnet/mainnet), discovery endpoints and slug template, execution windows and
buffers, buffer mode, position size, max trades, compounding, retry count, repricing interval and
attempts, timeouts, tick size and tick policy, exposure limits, trade quota, risk thresholds,
minimum liquidity, maximum spread, IOC/limit mode and precision. An automated test fails the build
if a business default is hardcoded in engine code.

## 4. Observability

Structured JSON logging with correlation ids on every event; a 100+ entry reason-code catalog
covering market, decision, risk, execution, ledger, replay and recovery; a health registry with
staleness detection per engine; Prometheus-compatible metrics; severity-aware notifications; and an
immutable audit trail for configuration, auth and replay actions.

## 5. Supabase validation

13 public tables, RLS enabled on all, owner-scoped policies plus admin read paths, append-only
tables denying UPDATE/DELETE, foreign keys on endpoint references, unique constraints on event id,
idempotency key, ledger record id and replay run id, and 9 new indexes for console query paths.
No runtime execution state is persisted — only durable events, ledger, analytics, replay runs and
operator configuration (ADR-0001 sync policy).

## 6. Known limitations

1. Recovery restores companion-side resumable state; venue-side open-order reconciliation remains
   the VPS's responsibility.
2. Replay and ledger reconstruction are in-memory and linear; paginate above ~250k events.
3. Sign-up hardening (email confirmation, HIBP, operator allow-list) is an operational setting,
   not code, and must be enabled before public exposure.
4. Analytics summaries are computed on demand; no scheduled pre-aggregation yet.

## 7. Ready for qualification

Yes. Reports: `ARCHITECTURE_CONFORMANCE_REPORT.md`, `RECOVERY_VALIDATION_REPORT.md`,
`REPLAY_VALIDATION_REPORT.md`, `SECURITY_AUDIT.md`, `PERFORMANCE_REPORT.md`, `VPS_DEPLOYMENT.md`.
