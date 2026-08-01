# ARC — Engineering Roadmap

Bound by `docs/ARC_PROJECT_CHARTER.md`. Progress is tracked in
`docs/IMPLEMENTATION_TRACKER.md`; this file explains **order, risk and intent**.

## Current milestone

**M0 — Foundation** (not yet started; unblocked by Session 0.5).

Goal: the smallest correct base every later engine builds on — externalised
configuration, a typed authenticated engine client, an event/log ingestion
contract, and operator auth with roles enforced end to end.

## Upcoming milestone

**M1 — Market State.** Mirror market lifecycle and feed telemetry from the engine
and render it read-only with explicit staleness. No value is ever derived here.

## Dependency graph

```text
Session 0 (discovery) ──► Session 0.5 (baseline) ──► M0 Foundation
                                                       │
                                    ┌──────────────────┴──────────────────┐
                                    ▼                                     ▼
                              M1 Market State                    M4 Platform Services
                                    │                                     │
                                    ▼                                     │
                              M2 Decision Domain                          │
                                    │                                     │
                                    ▼                                     │
                              M3 Trade Domain ◄───────────────────────────┘
                                    │
                                    ▼
                              M5 Operations
                                    │
                                    ▼
                              M6 Production Hardening
                                    │
                                    ▼
                              M7 Testnet Qualification
                                    │
                                    ▼
                              M8 Mainnet Qualification
```

## Estimated implementation order

| # | Milestone | Engines in scope (companion surface) |
|---|---|---|
| 1 | M0 | Configuration Engine, Persistence Layer, API Layer, Event Bus |
| 2 | M4 | Health Engine, Metrics Engine, Notification Engine, Scheduler |
| 3 | M1 | Market Lifecycle Engine, Feed Engine, Signal Tank |
| 4 | M2 | Signal Conditioning, PTB, TWAP, Execution Window Manager, Decision Engine, Risk Engine |
| 5 | M3 | Execution Engine, Settlement Engine, Ledger, Analytics |
| 6 | M5 | Trade Inspector, Replay Engine, Ops Deck |
| 7 | M6 | all — hardening pass against `docs/PRODUCTION_CHECKLIST.md` |
| 8 | M7 / M8 | qualification only, no new surfaces |

M4 runs early and in parallel-friendly fashion because health, metrics and
notification plumbing is a prerequisite for observing every later milestone.

## Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R-1 | Engine endpoint contracts undocumented in `docs/knowledge/` | Blocks M1+ | Escalate per governance §Escalation; document before coding |
| R-2 | Drift toward re-implementing engine logic in the companion | Charter violation | DoD check "engine boundaries preserved"; PR template question |
| R-3 | Worker runtime limits (no persistent process, no native modules, no long-lived sockets) | Design dead-ends | Poll + server functions only; never plan socket-resident features |
| R-4 | Mirror tables treated as authority | Money-correctness | Charter §2 corollary; every displayed number cites an engine field |
| R-5 | Secrets reaching the browser bundle | Security incident | Server functions only; `VITE_*` reserved for publishable values |
| R-6 | GitHub sync unverified from the sandbox | Delivery risk | Verified in the Lovable UI each session; recorded in the tracker |
| R-7 | Reference tree entering build/lint graph | Build breakage + engine fork | ADR-0002 enforcement (eslint ignore, tsconfig scope) |

## Exit criteria (roadmap level)

The roadmap is complete when M0–M8 all show `Production Status ✅` in the
tracker, every engine row has `Security ✅`, and the charter and ADRs still
describe the shipped system accurately.
