# ADR-0003 — Configuration synchronization: the VPS activates, the companion records

- Status: Accepted
- Session: M6.7
- Supersedes: none

## Context

Operators edit the execution profile in the companion. Before M6.7 a save wrote
the profile document to the database, and the console reported success. Nothing
proved that the trading engine had ever seen the change, so the console could
display a configuration that the engine was not running — the exact class of
silent divergence that produces unexplained live behaviour.

ADR-0001 freezes the authority model: the VPS is the sole trading authority. It
follows that the companion cannot activate configuration; it can only propose it.

## Decision

Configuration changes follow one mandatory path:

```
operator edit
  → immutable version in `configuration_versions` (status PENDING)
  → dispatch to the trading authority
  → authority validates and activates (or rejects)
  → verdict recorded: ACTIVE / REJECTED / PENDING
  → runtime mirror + canonical events
  → console reads back what the engine reports
```

Binding rules:

1. **Versions are immutable.** Every publish creates a new numbered version.
   Stored versions are never edited; database triggers reject mutation of the
   configuration document and its hash. Replacing the running configuration
   marks the previous one `SUPERSEDED`, never deleted.
2. **Content addressing.** Every version carries a deterministic `cfgh_` hash of
   its canonical form (windows sorted by offset). Identical content re-uses its
   existing version instead of minting duplicates, so a restart or reconnect
   cannot create version churn.
3. **No optimistic success.** A version becomes `ACTIVE` only when the authority
   returns an accepted verdict *and* a runtime snapshot id. An unreachable or
   unregistered authority leaves the version `PENDING`; the console says
   "stored, not yet running".
4. **Saved ≠ running.** `configuration_versions` holds what operators saved;
   `runtime_configuration_state` mirrors what the engine reports it is running.
   The console renders both and surfaces `CFG_RUNTIME_DRIFT` when the hashes
   disagree. Drift is reported, never silently reconciled.
5. **Read-back is authoritative.** On every console load the companion asks the
   authority what it is running and refreshes the mirror. After a PM2 restart
   the engine reloads its own active configuration and the console converges to
   it, not the other way round.
6. **Existing windows are unaffected.** Window instances keep the frozen
   configuration snapshot captured at creation (M2). New configuration applies
   to windows created after activation only.
7. **Split by ownership.** Infrastructure settings (endpoints, credentials,
   ports) stay in environment variables. Trading configuration lives in the
   database and only ever reaches the engine through this pipeline.
8. **Everything is an event.** `ConfigurationChanged`, `ConfigurationValidated`,
   `ConfigurationApplied`, `ConfigurationRejected`, `ConfigurationActivated`,
   `ConfigurationRolledBack`, `ConfigurationArchived` and
   `ConfigurationVersionCreated` are canonical, replayable and audited.

## Alternatives considered

- **Direct database read by the engine.** Rejected: no verdict, no rejection
  path, no activation timestamp, and the console could not distinguish stored
  from running configuration.
- **Console-side activation flag.** Rejected: it makes the companion the
  authority, violating ADR-0001.
- **Overwrite-in-place profile row.** Rejected: destroys the audit trail and
  makes rollback and replay impossible.

## Consequences

- Publishing is slower: the operator waits for the authority verdict. This is
  intentional and non-negotiable.
- The console must always be able to express three outcomes — applied, rejected,
  pending — and never collapse them into "saved".
- Rollback is re-dispatch of a stored version, not an edit.
- The companion layering gains a platform-level module
  (`src/core/platform/configuration-sync.ts`); it may not move into the
  configuration layer because it depends on decision and platform contracts.
