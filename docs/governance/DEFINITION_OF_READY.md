# ARC — Definition of Ready

No subsystem enters implementation until every item below is written down. If an
item cannot be answered, the correct action is to escalate (see
`docs/governance/README.md` §Escalation) — never to guess.

## Readiness criteria

1. **Responsibility defined.** One sentence stating what this subsystem is
   accountable for — and an explicit statement of what it is *not*.
2. **Inputs defined.** Every input named, with source, shape, cadence and
   trust level (engine-authoritative vs companion-owned metadata).
3. **Outputs defined.** Every output named, with consumer, shape and whether it
   is displayed, stored as a mirror, or forwarded as a control command.
4. **Events defined.** Canonical events consumed and emitted, with names,
   payload shape and ordering/idempotency expectations.
5. **Dependencies identified.** Upstream engines, companion tables, secrets,
   environment values and prerequisite milestones — all listed.
6. **Acceptance criteria written.** Observable, testable statements. "Works" is
   not an acceptance criterion.
7. **Test strategy defined.** Which behaviour is unit-tested, which is
   integration-tested, what is stubbed, and whether replay applies.
8. **Rollback strategy identified.** How the change is reverted or disabled — a
   feature flag, a revert, or a documented manual step — and what state, if any,
   must be cleaned up afterwards.

## Ready checklist

- [ ] Responsibility (and non-responsibility) written
- [ ] Inputs listed with source and trust level
- [ ] Outputs listed with consumers
- [ ] Events listed with payload shape
- [ ] Dependencies listed, all available
- [ ] Acceptance criteria written and reviewable
- [ ] Test strategy agreed
- [ ] Rollback strategy identified
- [ ] Engine contract documented in `docs/knowledge/` (or escalated)
- [ ] Scope is a single subsystem
