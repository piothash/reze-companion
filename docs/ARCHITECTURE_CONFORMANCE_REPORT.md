# ARC — Architecture Conformance Report (M6)

Status: **PASS**
Scope: full `src/` tree. Reference mirror `docs/reference/p4/**` excluded (read-only, ADR-0002).
Enforcement: `tests/unit/architecture.test.ts` — conformance is executable and fails CI on regression.

## 1. Frozen dependency direction

```text
configuration → infrastructure → market → decision → trade → platform → operations
```

Implemented as `src/core/{shared,contracts,configuration,infrastructure,market,decision,trade,platform}`
plus the operations layer in `src/core/platform/operations-view.ts`, `src/lib/*.functions.ts`,
`src/components/arc/**` and `src/routes/**`.

| Check | Result |
| --- | --- |
| No layer imports a layer above it | PASS (automated) |
| No reverse imports | PASS |
| No cross-layer shortcuts (e.g. operations → trade internals) | PASS — UI consumes projections only |
| Core imports no routes/components/hooks/integrations | PASS (automated) |
| No circular dependencies | PASS — the layer test is acyclic by construction; no cycle detected in module graph |

## 2. Engine boundaries

| Engine | Location | Purity | Boundary verdict |
| --- | --- | --- | --- |
| Configuration | `core/configuration`, per-domain `configuration.ts` | pure, env-driven | conformant |
| Infrastructure | `core/infrastructure` | ports only, no domain logic | conformant |
| Market State | `core/market` | pure projections, feed adapters at edge | conformant |
| Decision | `core/decision` | pure `f(state, window, config) → Decision` | conformant |
| Trade | `core/trade` | pure risk/exposure/FSM, venue behind port | conformant |
| Platform | `core/platform` | pure reconstruction; Supabase behind `*.server.ts` | conformant |
| Operations | `lib/`, `components/arc`, `routes/` | read-only projections | conformant |

## 3. Charter conformance

| Rule | Result |
| --- | --- |
| Companion is control plane only; VPS is sole trading authority | PASS — no venue client, no order placement, no signer in `src/` (automated) |
| No legacy majority/crowd/confidence strategy identifiers | PASS (automated) |
| `docs/reference/p4/**` never imported or bundled | PASS (automated import check) |
| No TODO/FIXME markers in production code | PASS (automated) |
| Service-role client only in `*.server.ts` or lazy handler import | PASS (automated) |

## 4. Duplication and dead code

- No duplicate implementations of event envelopes, FSMs, ledger or replay found.
- Every `src/core` module is reachable from a barrel export, a server function or a test.
- No unused database tables: all 13 public tables are read or written by platform adapters or the UI.
- No unused API surface: every export in `src/lib/*.functions.ts` is bound to a route.
