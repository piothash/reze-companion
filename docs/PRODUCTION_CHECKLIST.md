# ARC — Production Readiness Checklist

Applied **per engine surface**, not once per project. Copy this list into the PR
that promotes a surface to production. Nothing reaches **Production Ready**
until every required item is complete; `N/A` is allowed only with a one-line
justification.

Engine: `__________________`  ·  Milestone: `______`  ·  Date: `__________`

## 1. Architecture compliance

- [ ] Matches the frozen architecture in `docs/ARC_PROJECT_CHARTER.md`
- [ ] No trading decision, market state generation, TWAP, risk evaluation or order execution added to the companion
- [ ] No value derived that the engine already owns (no dual-write, no companion arithmetic on money)
- [ ] Engine boundaries preserved; no cross-engine reach-through
- [ ] No file under `docs/reference/p4/` or `docs/knowledge/` modified or imported
- [ ] Any architectural change is backed by an accepted ADR

## 2. Acceptance criteria

- [ ] Acceptance criteria written before implementation (see Definition of Ready)
- [ ] Every criterion demonstrably satisfied, with stated evidence
- [ ] Behaviour observed at runtime, not assumed

## 3. Unit tests

- [ ] Unit tests cover the surface's pure logic and edge cases
- [ ] Failure paths asserted, not only happy paths
- [ ] Suite passes locally and in CI

## 4. Integration tests

- [ ] Server functions exercised end to end against a stub or real endpoint
- [ ] Auth and RLS behaviour asserted (authorised, unauthorised, wrong role)
- [ ] Upstream error and timeout handling asserted

## 5. Replay validation

- [ ] Replay is deterministic for identical inputs, or documented `N/A`
- [ ] No hidden randomness, wall-clock dependence or ordering nondeterminism

## 6. Health checks

- [ ] Surface reports health/reachability of its upstream dependency
- [ ] Degraded and unreachable states are distinguishable in the UI
- [ ] Staleness of mirrored data is displayed, never silently hidden

## 7. Metrics

- [ ] Request count, latency and error rate captured for engine calls
- [ ] Metrics reachable by operators without a code change

## 8. Structured logging

- [ ] Logs are structured with a stable event name and correlation identifier
- [ ] No secret, credential, token or key value is ever logged
- [ ] Upstream status codes and error bodies surfaced, not swallowed

## 9. Configuration externalization

- [ ] No endpoint, threshold or credential hardcoded in source
- [ ] Server-only values read inside handlers via `process.env`
- [ ] Browser-visible values limited to publishable `VITE_*` keys
- [ ] Missing required configuration fails loud at call time with a clear message

## 10. Security review

- [ ] RLS enabled with policies scoped to `auth.uid()`; GRANTs present for every touched table
- [ ] Role checks use the `has_role` security-definer function, never client state
- [ ] Service-role access limited to verified privileged paths
- [ ] Security scan reviewed; findings resolved or explicitly accepted

## 11. Performance validation

- [ ] No unbounded query; every list is paginated or limited
- [ ] Polling cadence justified and backoff on failure implemented
- [ ] Worker runtime constraints respected (no native modules, no long-lived sockets)

## 12. Recovery validation

- [ ] Upstream outage degrades the UI gracefully; no blank screen, no fake data
- [ ] Partial or malformed engine payloads handled explicitly
- [ ] Retries are bounded and idempotent

## 13. Restart validation

- [ ] No in-memory server state assumed across requests
- [ ] Cold start renders correctly with an empty cache
- [ ] Session restored correctly after a hard refresh

## 14. Documentation updated

- [ ] `docs/IMPLEMENTATION_TRACKER.md` cells advanced with evidence
- [ ] `docs/ARC_DISCOVERY_REPORT.md` updated if understanding changed
- [ ] Operator-facing behaviour documented
- [ ] ADR added if an architectural decision was taken

## Sign-off

- [ ] Definition of Done (`docs/governance/DEFINITION_OF_DONE.md`) fully satisfied
- [ ] Build passes · Lint passes · Typecheck passes
- [ ] Tracker row set to `Production ✅`
