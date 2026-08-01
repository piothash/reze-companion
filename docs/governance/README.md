# ARC Governance — Operating Rules

Binding companion to `docs/ARC_PROJECT_CHARTER.md`. These are the day-to-day rules.

## Two-repository rule

- `piothash/reze` → **source of truth for understanding**. Mirrored read-only at
  `docs/reference/p4/`. Never written to, never patched from here.
- `piothash/reze-companion` → **the only implementation target**. All code written
  in this workspace lands here.

If the connected repository ever differs from `reze-companion`, stop and report it
before writing code.

## Do Not Touch

`docs/reference/p4/**` and `docs/knowledge/**` are reference artefacts.

| Action | Allowed |
|---|---|
| Read | yes |
| Cite in a plan or report | yes |
| Import from `src/` | **no** |
| Include in build / lint / typecheck | **no** |
| Modify, rename, reformat | **no** |
| Copy code verbatim into `src/` without an ADR | **no** |

Enforcement: `eslint.config.js` ignores `docs/**`; `tsconfig.json` includes only
`src/**`; `.gitignore` blocks `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite*`, `.env*`.

## Never committed

- Live or sample trading databases and WAL/SHM sidecars
- Wallet keys, CLOB API keys/secrets/passphrases, Telegram tokens
- Any `.env` file with real values
- Exported ledgers, order logs, or account snapshots

## Session workflow

1. Load charter + governance + the knowledge report for the subsystem in scope.
2. Restate the scope in one sentence; confirm it is a single subsystem.
3. Produce a plan; get approval.
4. Implement in `src/` only.
5. Verify: `bun run build`, `bun run lint`, and an actual behavioural check.
6. Update `docs/ARC_DISCOVERY_REPORT.md` or add an ADR if understanding changed.

## Definition of done

A change is done only when all of the following hold:

- [ ] Build passes
- [ ] Lint passes
- [ ] The behaviour was observed, not assumed
- [ ] No trading logic was added to the companion
- [ ] No reference file was modified
- [ ] No secret or live data entered the repository
- [ ] Charter and ADRs still accurately describe the system

## Escalation

Stop and ask rather than guess when:

- A required environment value or credential is unknown (never invent one)
- The requested change would move trading logic into the companion
- The connected repository is not `reze-companion`
- An engine endpoint's contract is undocumented in `docs/knowledge/`
