# Operator Runbooks — Phase 0.5

Summaries of the eight top-level markdown documents in `reference/p4/` plus `docs/production-certification.md`. This closes contradiction C4 (Report 15 claimed "no documented runbook"; multiple runbooks exist).

## Inventory

| File | LOC | Kind | Purpose (from headers) |
|---|---|---|---|
| `README.md` | 205 | Overview | Repo intro; dual-pipeline V1 Paper / V2 Live BTC 5m maker-snipe engine; disclaimer that LIVE_V2 places real on-chain orders. |
| `QUICK_START.md` | 159 | Getting started | 60-second onboarding: what the bot does, how to launch it. |
| `SETUP.md` | 652 | Comprehensive setup | "Complete Beginner Setup Guide"; explicitly states "Everything in this guide is taken directly from the project's actual files. No generic examples — every command, file name, and variable name is the real one." |
| `PRODUCTION_SETUP.md` | 177 | Live production deploy | "v2 LIVE Trading - Production Setup Guide"; requirements checklist for VPS deployment. |
| `OPERATIONS.md` | 110 | Live-money runbook | **Authoritative live-money runbook.** "Live-money runbook for the V2 engine. Assumes the VPS setup from PRODUCTION_SETUP.md (PM2 app name P4, port 3000)." Documents architecture safety layers (outermost first). |
| `TRADING_GUIDE.md` | 317 | Trading semantics | "Edge 5 Trading Guide"; explains candle/slot, direction, edges. |
| `DERIVE_CREDENTIALS.md` | 150 | Credential derivation | "Deriving Polymarket CLOB API Credentials" using the official SDK; matches `scripts/derive-clob-credentials.mjs`. |
| `EXECUTION_LATENCY_OPTIMIZATION.md` | 252 | Retrospective / design note | Records the async write-queue change that eliminated blocking DB ops from the 50ms tick loop. |
| `docs/production-certification.md` | 61 | Phase 6 certification | Full-system certification audit; verdict CERTIFIED; documents "acceptance gates below; all pass mechanically." Dated 2026-07-14. |

## Consequence for Report 15

Report 15 §Gaps' "No documented runbook" and "No live/paper comparison verdict" claims should be read as follows after Phase 0.5:

- **"No documented runbook" — retracted.** `OPERATIONS.md` is a live-money runbook. `PRODUCTION_SETUP.md` is a VPS deploy runbook. See `PHASE0_COMPLETION_REPORT.md` §8.2.
- **"No live/paper comparison verdict yet" — reclassified.** `comparison.ts` supplies stats but not a promotion verdict. Recorded as observation R8 in the completion report.

## Cross-references from runbooks to source

Where the runbooks make source-level claims:

- `OPERATIONS.md:1-5` references `PM2 app name P4, port 3000` — matches `ecosystem.config.js:19` (`name: 'edge5'` — note: the PM2 name in source is `edge5`, whereas the runbook says `P4`. Minor drift within the runbook itself; source is authoritative).
- `DERIVE_CREDENTIALS.md` and `gen-creds.js` / `scripts/derive-clob-credentials.mjs` are three redundant paths to the same task (argv-based, .env-based, and documented walkthrough).
- `EXECUTION_LATENCY_OPTIMIZATION.md` matches the async write-queue behavior in `db.ts` write-queue block referenced by Report 12.
- `docs/production-certification.md`'s verdict (CERTIFIED) predates Phase 0 KB creation and represents the source repo's own assessment.
