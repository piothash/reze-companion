<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## ARC project rules (binding)

Read `docs/ARC_PROJECT_CHARTER.md` before planning or writing any code.

- **Hybrid architecture.** The companion is the control plane. The VPS remains the
  sole trading authority. No trading decisions, market state generation, TWAP
  calculation, risk evaluation, or order execution will ever be implemented inside
  Lovable. The companion communicates with the VPS through authenticated APIs and
  canonical events only.
- **Two repositories.** `piothash/reze` is the read-only source of truth for
  understanding (mirrored at `docs/reference/p4/`). `piothash/reze-companion` is the
  only implementation target. Never confuse them.
- **Do not touch `docs/reference/p4/`.** Read-only: never imported into runtime,
  never bundled, never modified, never refactored. Permitted uses only: repository
  discovery, reuse analysis, gap analysis, architecture comparison.
- **Never commit** `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite*`, real `.env` values,
  wallet keys, or exchange credentials.
- **Architecture is frozen.** Changes require an ADR in `docs/architecture/`.
