# Errata — Phase 0.5

Per-report corrections gathered during Phase 0.5 self-audit. The 16 existing reports were not rewritten; consumers should treat this file as the authoritative overlay for the citations and wording below.

## Global

- **Class name.** Every mention of `Engine` in Reports 01, 03, 04, 09, 13 refers to the source class `Edge5Engine`. Evidence: `lib/v2/engine/engine.ts:66` `export class Edge5Engine`; `engine.ts:842, 1510, 1538`.
- **`eslint.config.js` → `eslint.config.mjs`.** Report 01's file-listing note used the wrong extension.

## Report 05 (Execution)

- `POST_ONLY = true`: **`execution/live.ts:43`** (was cited as `:33`).
- `TICK_SIZE = "0.01"`: **`execution/live.ts:45`** (was cited as `:35`).
- Credential null-check: constructor guard at `execution/live.ts:57-70` (throw message spans through `:66-69`), followed by `ClobClient` construction `:71-84`.
- `paper.ts:88 priceForSide` — re-check needed against current line numbers; verified only that a `priceForSide` symbol exists in `paper.ts`.

## Report 08 (Risk)

- `DEFAULT_LIMITS`: **`risk.ts:65-71`** (was cited as `:70-76`).

## Report 09 (Synchronization)

- `RECONCILE_MS = 60_000`: **`reconciler.ts:27`** (was cited as `:29`).
- `DRIFT_TOLERANCE_USD = 1`: **`reconciler.ts:28`** (was cited as `:30`).
- Oracle guard threshold now quoted: `STALE_MS = 10_000` at `handlers/oracle-sync-guard.ts:24`; direction logic at `:34-52`.

## Report 12 (Persistence)

- `scratchOrphanedOpenRows`: defined at `db.ts:185`; called at `db.ts:163`. The previously cited range `db.ts:174-206` covered the header comment plus the function body; consumers should use `:185` for the definition line.

## Report 03 (Trading Engine)

- Class name is `Edge5Engine` per above.
- `SPOT_STALE_MS` is a static class field: `private static readonly SPOT_STALE_MS = 10_000` accessed as `Edge5Engine.SPOT_STALE_MS` (`engine.ts:842`).

## Report 15 (Production Readiness)

- Remove the "No documented runbook" gap — factually wrong. `reference/p4/OPERATIONS.md:1-5` is explicitly a live-money runbook. See `_appendix/operator-runbooks.md`.
- Recommendation-shaped sentences in §Watch / §Gaps should be re-read as observations R7 (feed-gap telemetry) and R8 (paper→live acceptance criteria) per `PHASE0_COMPLETION_REPORT.md` §2.

## Report 14 (Testing)

- Test tree exists: 13 unit tests + 13 integration tests + 1 helper + 1 setup file = 28 files. See `_appendix/test-coverage-matrix.md`.

## Report 01 (Architecture)

- Two `proxy.ts` files exist and have distinct purposes:
  - Root `proxy.ts` (Next.js middleware) — dashboard auth surface. Indexed in Report 02.
  - `lib/v2/engine/proxy.ts` — outbound HTTP/WS proxy for restricted networks (India). See `PHASE0_COMPLETION_REPORT.md` §1.1 C5. Full contents: `undici` `ProxyAgent`/`Socks5ProxyAgent`, `setGlobalDispatcher` patch, `createProxiedWebSocket` factory.

## Added cross-references (informational — not applied to report bodies)

- Report 14 → Report 08 (via `tests/unit/risk.test.ts`).
- Report 04 → Report 08 (SLO reuses `RiskManager`).
- Report 10 → Report 05 (strategies produce `Executor` calls).
- Report 01 → `_appendix/operator-runbooks.md`.
- Report 15 → `_appendix/operator-runbooks.md` (retracts "no runbook").
- All reports → `_appendix/*` (five new appendix files added in Phase 0.5).
