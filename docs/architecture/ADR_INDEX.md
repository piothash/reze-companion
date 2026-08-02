# ARC — ADR Index

Architectural decisions live in `docs/architecture/ADR-NNNN-<slug>.md`. This index
is authoritative for numbering. **No architectural change is permitted without a
new ADR.**

## Accepted

| ADR | Title | Status | Session |
|---|---|---|---|
| [ADR-0001](./ADR-0001-hybrid-control-plane.md) | Hybrid control plane: the companion never trades | Accepted | 0 |
| [ADR-0002](./ADR-0002-reference-readonly.md) | `reference/p4` is permanently read-only and never bundled | Accepted | 0 |
| [ADR-0003](./ADR-0003-configuration-synchronization.md) | Configuration synchronization: the VPS activates, the companion records | Accepted | M6.7 |
| [ADR-0004](./ADR-0004-authority-handshake.md) | VPS authority registration, runtime handshake and mirror staleness | Accepted | M6.8 |
| [ADR-0005](./ADR-0005-feed-provider-abstraction.md) | Feed provider abstraction: V1 testnet → V2 mainnet by environment only | Accepted | M7.0 |

## Reserved numbering

Numbers are claimed in order at proposal time and never reused, even if a
proposal is withdrawn.

| ADR | Reserved for |
|---|---|
| ADR-0003 | *Claimed — configuration synchronization (accepted)* |
| ADR-0004 | *Claimed — authority registration, runtime handshake, mirror staleness (accepted)* |
| ADR-0005 | *Claimed — feed provider abstraction (accepted)* |
| ADR-0009 | Control-command authorisation, audit and kill-switch semantics |
| ADR-0006 | Replay determinism boundary |
| ADR-0007 | Observability: metrics, structured logging and health contract |
| ADR-0010 | Next available |

## Statuses

`Proposed` · `Accepted` · `Superseded by ADR-NNNN` · `Withdrawn`

## Process

1. Claim the next free number in the reserved table.
2. Write context, decision, alternatives considered, and consequences.
3. Open with status `Proposed`; move to `Accepted` only on approval.
4. On acceptance, update this index and any charter section it amends.
5. Superseding an ADR never edits the original beyond its status line.
