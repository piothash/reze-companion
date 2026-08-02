# ARC — Implementation Tracker

**Status:** ACTIVE · **Owner:** ARC engineering session loop
**Authority:** bound by `docs/ARC_PROJECT_CHARTER.md`, ADR-0001, ADR-0002.

This file is the **single source of truth for engineering progress**. Every session
updates it. A milestone or engine is never described as complete anywhere else
(chat, report, PR) unless it is marked complete here.

Legend: `⬜` not started · `🟨` in progress · `✅` complete · `N/A` not applicable
· `🚫` blocked

> Scope reminder: the companion is the control plane. Engines listed below are
> tracked for **companion-side surfaces** (read, display, annotate, and — once
> authorised — issue documented control commands). Trading logic itself is never
> implemented here; the VPS remains the sole trading authority.

---

## 1. Milestones

### M0 — Foundation

| Field | Value |
|---|---|
| Status | 🟨 In progress (P0 foundation landed) |
| Dependencies | Session 0 (discovery), Session 0.5 (this baseline) |
| Exit Criteria | Configuration engine surface, event/log ingestion contract, typed engine client, auth + roles enforced end to end, build/lint/typecheck green |
| Acceptance Status | ⬜ |
| Replay Status | N/A |
| Production Status | ⬜ |

### M1 — Market State

| Field | Value |
|---|---|
| Status | ✅ Complete (domain landed) |
| Dependencies | M0 |
| Exit Criteria | Market lifecycle + feed telemetry mirrored and displayed; staleness surfaced; no derived market values |
| Acceptance Status | ✅ 30 market-domain unit tests green (83 total) |
| Replay Status | ✅ Deterministic replay verified (`tests/unit/market-state.test.ts`) |
| Production Status | 🟨 Awaiting live testnet feed wiring |

**M1 evidence log**

- Domain modules: `src/core/market/{types,configuration,events,discovery,lifecycle,feed-engine,twap-engine,ptb-engine,signal-conditioning,market-state,domain,index}.ts`
- Canonical events: `ObservationReceived`, `TWAPUpdated`, `PTBUpdated`, `SignalConditioned`, `MarketLifecycleUpdated`, `AuthoritativeMarketStateUpdated` (frozen envelope, `source=market-state`).
- Configuration-driven only: discovery base URL, slug template, `TWAP_FEED_PROVIDER`, `TWAP_FEED_ID`, `TWAP_NETWORK`, `TWAP_OBSERVATION_INTERVAL`, `TWAP_MAX_STALENESS`, `TWAP_PRECISION`, `TWAP_WINDOW_SECONDS`, `TWAP_MIN_OBSERVATIONS`, `PTB_*`, `SIGNAL_*`. Mainnet switch is `.env`-only.
- Tests: `tests/unit/market-discovery.test.ts`, `tests/unit/market-feed-twap.test.ts`, `tests/unit/market-state.test.ts`.
- Compliance: no decision, risk, order, window-manager or settlement logic; PTB sourced from official market metadata only.


### M2 — Decision Domain

| Field | Value |
|---|---|
| Status | ⬜ Not started |
| Dependencies | M1 |
| Exit Criteria | Decision/signal telemetry rendered read-only with full provenance to engine payloads |
| Acceptance Status | ⬜ |
| Replay Status | ⬜ |
| Production Status | ⬜ |

### M3 — Trade Domain

| Field | Value |
|---|---|
| Status | ⬜ Not started |
| Dependencies | M2 |
| Exit Criteria | Order, settlement and ledger mirrors reconcile against engine reports with zero companion-side arithmetic |
| Acceptance Status | ⬜ |
| Replay Status | ⬜ |
| Production Status | ⬜ |

### M4 — Platform Services

| Field | Value |
|---|---|
| Status | ⬜ Not started |
| Dependencies | M0 |
| Exit Criteria | Health, metrics, notifications, persistence retention and structured logging operational |
| Acceptance Status | ⬜ |
| Replay Status | N/A |
| Production Status | ⬜ |

### M5 — Operations

| Field | Value |
|---|---|
| Status | ⬜ Not started |
| Dependencies | M3, M4 |
| Exit Criteria | Ops Deck, trade inspector and audit trail complete; every control command authenticated and audited |
| Acceptance Status | ⬜ |
| Replay Status | ⬜ |
| Production Status | ⬜ |

### M6 — Production Hardening

| Field | Value |
|---|---|
| Status | ⬜ Not started |
| Dependencies | M5 |
| Exit Criteria | `docs/PRODUCTION_CHECKLIST.md` fully satisfied for every shipped engine surface |
| Acceptance Status | ⬜ |
| Replay Status | ⬜ |
| Production Status | ⬜ |

### M7 — Testnet Qualification

| Field | Value |
|---|---|
| Status | ⬜ Not started |
| Dependencies | M6 |
| Exit Criteria | Companion verified against a non-production engine endpoint through a full session lifecycle |
| Acceptance Status | ⬜ |
| Replay Status | ⬜ |
| Production Status | ⬜ |

### M8 — Mainnet Qualification

| Field | Value |
|---|---|
| Status | ⬜ Not started |
| Dependencies | M7 |
| Exit Criteria | Read-only mainnet observation soak, then explicitly authorised control-command enablement |
| Acceptance Status | ⬜ |
| Replay Status | ⬜ |
| Production Status | ⬜ |

---

## 2. Engine Tracker

| Engine | Discovery | Build | Unit | Integration | Replay | Security | Production |
|---|---|---|---|---|---|---|---|
| Configuration Engine | ✅ | ✅ | ✅ | ⬜ | N/A | 🟨 | ⬜ |
| Event Bus | ✅ | 🟨 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| Scheduler | ✅ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ⬜ |
| Health Engine | ✅ | ✅ | ✅ | ⬜ | N/A | ⬜ | ⬜ |
| Metrics Engine | ✅ | ✅ | ✅ | ⬜ | N/A | ⬜ | ⬜ |
| Persistence Layer | ✅ | 🟨 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Market Lifecycle Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Feed Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| PTB Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| TWAP Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Signal Conditioning Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Execution Window Manager | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Decision Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Risk Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Execution Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Settlement Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Ledger | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Replay Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Analytics | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Notification Engine | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| API Layer | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Signal Tank | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Trade Inspector | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Ops Deck | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

Column meaning:

- **Discovery** — behaviour traced in `docs/reference/p4/` + `docs/knowledge/`, written up.
- **Build** — companion-side surface implemented in `src/`.
- **Unit** — unit tests pass.
- **Integration** — integration tests pass against a stubbed or real engine endpoint.
- **Replay** — deterministic replay verified (or `N/A` for stateless subsystems).
- **Security** — RLS, secret handling and authz reviewed for that surface.
- **Production** — every item in `docs/PRODUCTION_CHECKLIST.md` satisfied.

---

## 3. Update Protocol

1. A cell only moves forward on **observed** evidence — never on "should work".
2. The session that changes a cell states the evidence in its report or PR.
3. Regressions move cells backwards; they are never left stale.
4. Milestone status is derived from its engines, not asserted independently.

---

## 4. P0/M0 Evidence Log

| Claim | Evidence |
|---|---|
| Foundation modules implemented | `src/core/{shared,contracts,configuration,infrastructure}/*`, `src/core/runtime.ts` |
| Unit suite green | `bunx vitest run` — 53 tests / 5 files passing |
| Lint + typecheck green | `bun run lint` exit 0, `bunx tsgo --noEmit` exit 0 |
| Health surface observable | `GET /api/public/health` returns status, dependencies and version manifest |
| Migration audit written | `docs/migration/reze-audit.md` |
| No trading logic added | Audit §1 classifies every engine trading component as REMOVE |
