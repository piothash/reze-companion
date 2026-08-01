# ARC — Definition of Done

An engine surface is **complete** only when every item below holds. Partial
completion is reported as partial; it is never rounded up.

## Mandatory criteria

1. **Architecture matches the frozen specifications.** Implementation conforms to
   `docs/ARC_PROJECT_CHARTER.md` and the accepted ADRs. No trading logic entered
   the companion. No unratified architectural change shipped.
2. **Engine boundaries are preserved.** The surface owns exactly its own concern,
   talks to other engines through documented contracts, and never reaches into
   another engine's internals or duplicates its state.
3. **Acceptance criteria are satisfied.** Every criterion agreed in the Definition
   of Ready is demonstrably met, with stated evidence.
4. **Unit tests pass.** Meaningful coverage of pure logic, edge cases and failure
   paths; the suite is green.
5. **Integration tests pass.** End-to-end exercise of server functions, auth and
   RLS, including unauthorised and upstream-error paths.
6. **Replay is deterministic where applicable.** Identical inputs produce
   identical output; otherwise the surface is explicitly marked `N/A`.
7. **Structured logging exists.** Stable event names, correlation identifiers,
   upstream status surfaced, and no secret ever logged.
8. **Metrics are exposed.** Call volume, latency and error rate observable by an
   operator without a code change.
9. **Health checks exist.** Upstream reachability and data staleness are reported,
   with degraded and unreachable states distinguishable.
10. **Configuration is externalized.** No hardcoded endpoints, thresholds or
    credentials; server-only values read inside handlers; missing config fails loud.
11. **Documentation is updated.** `docs/IMPLEMENTATION_TRACKER.md` advanced,
    discovery report or ADR updated when understanding changed, operator
    behaviour documented.
12. **Regression tests pass.** The full existing suite is green, plus build, lint
    and typecheck.

## Hard blockers

Done is impossible while any of these is true:

- A file under `docs/reference/p4/` or `docs/knowledge/` was modified.
- Trading logic, money derivation or order execution was added to the companion.
- A secret, key or live database artefact entered the repository.
- Behaviour was claimed but not observed.
