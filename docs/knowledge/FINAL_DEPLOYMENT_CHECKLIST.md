# Phase 7 — Final Deployment Checklist (VPS)

Companion to `PHASE4_VPS_VERIFICATION_RUNBOOK.md` and
`OPERATOR_RUNTIME_CHECKLIST.md`. Execute on the VPS in order. Each step
has an explicit pass criterion.

## 1. Clone / Update

```
cd /opt && git clone https://github.com/supreme1xxz/foundation-builder-1ad2db70.git p4 || (cd p4 && git pull --ff-only)
cd p4/reference/p4
```
Pass: `git log -1` shows the expected latest commit.

## 2. Install

```
pnpm install --frozen-lockfile
```
Pass: `better-sqlite3` builds; no peer-dep errors.

## 3. Build

```
pnpm build
```
Pass: `.next` produced; no type errors.

## 4. Test

```
pnpm test
```
Pass: 32 files, 0 failures. See `FINAL_TEST_REPORT.md` for inventory.

## 5. Environment Validation

- `.env` exists at `reference/p4/.env`, mode 600.
- Required keys per `.env.template`: `POLYMARKET_SIGNING_KEY`,
  `POLYMARKET_FUNDER_ADDRESS`, `CLOB_API_KEY`, `CLOB_API_SECRET`,
  `CLOB_API_PASSPHRASE`, `DB_PATH`, optional `TELEGRAM_*`.
- `curl -sf http://127.0.0.1:3000/api/v2/bot/diagnostics/credentials`
  after start → all required booleans `true`.

## 6. PM2 Restart

```
pm2 startOrReload ecosystem.config.js
pm2 save
```
Pass: process online, no restart loop within 60s.

## 7. Health Checks

```
curl -sf http://127.0.0.1:3000/api/v2/bot/health
curl -sf http://127.0.0.1:3000/api/v2/bot/status
curl -sf http://127.0.0.1:3000/api/v2/bot/preflight
```
Pass: `health` 200 + `ok:true`; `preflight` reports all subsystems ready.

## 8. Dashboard Verification

- Load dashboard through reverse proxy.
- Command Deck, Engine Status, Startup Error, Ledger, Analytics render.
- No console errors from project code.

## 9. PAPER Verification

- Set mode PAPER_V1, click Start.
- Observe at least one full slot: ARM → FILL → SETTLE.
- `trades` table row appears with `mode='PAPER'` and `status='SETTLED'`.

## 10. LIVE Verification

- Confirm `/diagnostics/credentials` all `true`.
- Set mode LIVE_V2. Structured 400 must NOT appear.
- Small-notional slot: order posts, fill received, settlement recorded.
- Reconciler cycle within 60s reports no UNTRACKED order.

## 11. Standing Limit Order Verification

- Configure SLO via panel with a price that will trigger.
- On trigger fire: majority-side rule executes; verify `explanation.majorityOverride` in `trades` row if applicable.
- Pause / resume / clear all work.

## 12. PnL Verification

- After ≥3 settled trades, run:
  `curl -sf .../api/v2/bot/analytics | jq '.pnl'`
- Cross-check against `SELECT sum(pnl) FROM trades WHERE mode=?`.
- Values must match to the cent.

## 13. Restart Verification

- `pm2 restart p4` mid-slot with an OPEN position.
- After boot: `scratchOrphanedOpenRows` refunds cost; bankroll unchanged.
- `maybeAutoResume` resumes engine if it was running pre-restart.

## Sign-off

Operator initials + timestamp per line. File in `docs/knowledge/_appendix/operator-runbooks.md`.

## Certification

**Production Ready with Accepted Limitations** — see
`FINAL_PRODUCTION_AUDIT.md` for the full disposition.
