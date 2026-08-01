# ARC Production Cleanup — Full Repository Audit (V1 + V2 Parity)

Scope: entire repository (`app/`, `components/`, `lib/`, `hooks`, `app/api/`, state,
`data/` + `database` layer, `docs/`, `tests/`, `scripts/`, `deploy/`, config).
Engine subsystems (SLO, Execution, Settlement, Replay, Risk, Bankroll, Sizing,
Restart Recovery, Majority Detection, Watchdog) were **not** modified.

## 1. V1 / V2 architecture finding

There is **no separate V1 codebase**. V1 and V2 are two pipeline modes of the same
code:

- `app/v1/page.tsx` → `<TerminalDashboard pipeline="PAPER_V1" />`
- `app/v2/page.tsx` → `<TerminalDashboard pipeline="LIVE_V2" />`
- `app/page.tsx` redirects to whichever pipeline the engine currently runs.
- One API surface (`app/api/v2/bot/*`), one engine (`lib/v2/engine/*`), one store
  (`components/v2/use-bot.ts`), one SQLite database with mode-namespaced keys.

Therefore the V2 cleanup structurally applied to V1 at the same time: any component,
route, API action, hook, or table removed in V2 no longer exists for V1 either.
**No V1-specific obsolete system was found.**

## 2. Obsolete-system scan (repo-wide)

Terms searched: Strategies, Strategy, EDGE1–EDGE6, "NONE" selector, Optional
Secondary Strategy, Target Grid Configurator, Priority 1 / Priority 2, Absolute Price
Range Constraint, Bands, Price Floor, Price Ceiling, Strategy Registry, Strategy API,
Strategy State, Strategy Hooks.

| Category | Result |
| --- | --- |
| Strategy registry / edge modules | Gone (`lib/v2/engine/strategy-registry/`, `lib/v2/engine/strategy/` deleted) |
| Strategy UI (tab, quick-switcher, target grid, bands, floor/ceiling, NONE selector, secondary strategy, Priority 1/2) | Gone from `components/` |
| Strategy API actions (`set_strategy`, `set_bands`) | Gone from `app/api/v2/bot/control` |
| Strategy Telegram commands (`/strategies`) | Gone |
| `p1Band`, `priceFloor`, `priceCeiling`, `clampBand`, `activeStrategy` | Gone from types/config/state |
| Routes | `/`, `/v1`, `/v2` + API only — no strategy routes (build output confirms) |

Remaining textual matches, reviewed and intentionally kept:

- `edge5` — product/process name only (PM2 app name, DB filename `data/edge5.db`,
  log/backup/export filenames, nginx conf, crash-handler global). Renaming would
  break VPS deployments and existing ledgers.
- `StrategyConfig` / `strategy:config` KV key / `strategy-profiles.ts` /
  `profiles` API + `comparison.ts` — this is the **active engine configuration and
  its saved profiles**, not the removed edge registry. Table/key names are kept for
  database compatibility (documented in the V2 cleanup).
- "Guardrail band" in `limit-order-panel.tsx` / `intel-feed.tsx` — an SLO price
  guardrail, explicitly out of scope (rule 4).
- Incidental comments referencing the historical strategy path in engine internals.

## 3. Files changed (copy/doc only — zero behavioural change)

- `app/layout.tsx` — site description no longer advertises a "6-edge quant strategy registry".
- `components/v2/limit-order-panel.tsx` — help text "Independent of the strategy engine and time window" → "Independent of the engine's time window".
- `.env.example` — removed the "optional strategy edge can consume it" note.
- `OPERATIONS.md` — removed "strategy selection" from the persisted-controls list.
- `TRADING_GUIDE.md` — spot-price bullet rewritten without the strategy-edge clause.
- `EXECUTION_LATENCY_OPTIMIZATION.md` — trace comment "Before strategy decision" → "Before order decision".

## 4. Files removed

None. All obsolete modules were already deleted during the V2 cleanup.

## 5. V1 / V2 parity report

| Surface | V1 (PAPER_V1) | V2 (LIVE_V2) | Parity |
| --- | --- | --- | --- |
| Dashboard shell / tabs | `TerminalDashboard` | same component | ✅ |
| Command Deck, Ops Deck (incl. Profiles panel), Market Monitor, Intel Feed | shared | shared | ✅ |
| Standing Limit Order panel | shared | shared | ✅ |
| API surface | `app/api/v2/bot/*` | same | ✅ |
| Client state (`use-bot.ts`) | shared | shared | ✅ |
| Storage | same SQLite, mode-namespaced keys | same | ✅ |
| Intentional differences | simulated execution, neon theme | real CLOB execution, crimson theme, credential preflight | ✅ by design |

## 6. Scans

- **Dead code:** no orphan modules — every file under `lib/v2/engine` is reachable
  from the engine, an API route, a script, or a test. No unreferenced components in
  `components/v2`.
- **Unused imports / vars (eslint):** 18 warnings, all pre-existing and confined to
  test files plus engine locals (`trace`, `phase`, `prices`, `upAge`, `downAge`,
  `marketIdForSlot`, `tMinusMs`). No cleanup-introduced warnings. Not touched
  because several sit inside engine hot paths that are out of scope.
- **Route verification:** build output lists `/`, `/v1`, `/v2`, `/_not-found` and 13
  API routes — matches the intended post-cleanup surface exactly.
- **API verification:** `control` accepts no strategy actions; `profiles` operates on
  engine-config profiles only.

## 7. Build & regression

- `npx tsc --noEmit` — 2 pre-existing errors only (BigInt target in
  `direction-trace.test.ts`, narrow union arg in `phase6b-credentials.test.ts`).
- `next build` — **success**, all routes compiled.
- `vitest run` — **373 passed / 375**; the 2 failures are the pre-existing
  `tests/integration/accounting-integrity.test.ts` balance-chain cases, unchanged by
  this audit.

## Verdict

V1 already matched V2; **no functional changes were necessary**. Only six stale
strategy-era text strings (UI metadata, one help paragraph, four doc/env comments)
were corrected. Engine, execution, and settlement code untouched.
