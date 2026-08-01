# Operator Runtime Checklist

Follow top-to-bottom after every Phase 6 deployment.

## 0. Prereqs

- VPS user has sudo, git, node ≥ 20, pnpm ≥ 8, pm2 installed globally.
- `.env` on the VPS contains at minimum:
  ```
  PAPER_STARTING_BALANCE=100
  # For LIVE_V2 only:
  WALLET_PRIVATE_KEY=…            # or POLY_PRIVATE_KEY
  FUNDER_ADDRESS=0x…              # or POLY_PROXY_ADDRESS
  CLOB_API_KEY=…                  # or POLY_API_KEY
  CLOB_API_SECRET=…               # or POLY_API_SECRET
  CLOB_API_PASSPHRASE=…           # or POLY_API_PASSPHRASE
  ```
- Never commit `.env`; the repo `.gitignore` covers it.

## 1. Install / build / test

```bash
cd /home/ubuntu/p4
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm test                              # full suite must be green
pnpm test tests/unit/phase6b-account-sync.test.ts
pnpm test tests/unit/phase6b-credentials.test.ts
```

Acceptance:
- [ ] `pnpm install` finishes without errors.
- [ ] `pnpm build` finishes with no TypeScript diagnostics.
- [ ] `pnpm test` reports 0 failing tests.
- [ ] Both Phase 6B suites pass.

## 2. PM2 restart

```bash
pm2 restart edge5 --update-env
pm2 logs edge5 --lines 200
```

Acceptance:
- [ ] Boot log shows `Ignition ON — <MODE> pipeline armed` OR the
      Phase 6B `Refused to switch to LIVE_V2 …` message with the
      specific missing env-var names.
- [ ] No unhandled rejection / uncaught exception.

## 3. PAPER_V1 startup verification

- Dashboard → EXECUTION PIPELINE → `V1 PAPER` → START ENGINE.

Acceptance:
- [ ] Engine badge flips to `ENGINE LIVE`.
- [ ] Engine Status Panel shows Mode = `PAPER_V1`, Startup blocked = NO.
- [ ] Startup Error Panel is absent.
- [ ] Log line `Ignition ON — PAPER_V1 pipeline armed`.

## 4. LIVE_V2 startup verification

### 4a. With incomplete credentials (expected happy-path error UX)

- Remove one LIVE env var from `.env`, `pm2 restart edge5 --update-env`.
- Dashboard → EXECUTION PIPELINE → `V2 LIVE`.

Acceptance:
- [ ] StartupErrorPanel appears with:
      - `STARTUP REJECTED` header
      - the specific missing variable listed with a red ✗
      - recommended action visible
- [ ] Engine Status Panel: Startup blocked = YES, LIVE creds ready =
      `MISSING N`.
- [ ] `/api/v2/bot/control` POST returns HTTP 400 with an `error`
      block containing `code: LIVE_CREDENTIALS_MISSING`.

### 4b. With complete credentials

- Restore the env var, `pm2 restart edge5 --update-env`.
- Dashboard → `V2 LIVE` → START ENGINE.

Acceptance:
- [ ] Engine badge = `ENGINE LIVE`, Startup blocked = NO.
- [ ] StartupErrorPanel is absent.
- [ ] Engine Status Panel: Mode = `LIVE_V2`, LIVE creds ready = YES.

## 5. Dashboard verification

Acceptance:
- [ ] Engine Status Panel renders under the ignition buttons.
- [ ] Credential Diagnostics section is present only when at least one
      credential is missing.
- [ ] `GET /api/v2/bot/diagnostics/credentials` returns a JSON body
      with `items[]`, `missing[]`, `liveReady`.
- [ ] No secret values appear in any dashboard panel or network response.

## 6. Health, status, preflight

```bash
curl -s localhost:3000/api/v2/bot/health   | jq
curl -s localhost:3000/api/v2/bot/status   | jq '{running, mode, startup}'
curl -s localhost:3000/api/v2/bot/preflight | jq '.ready'
```

Acceptance:
- [ ] `/health` returns 200 with a shape matching the operator guide.
- [ ] `/status` includes the `startup` block.
- [ ] `/preflight` reflects the current mode's readiness.

## 7. Account synchronization verification (LIVE_V2 only)

Acceptance:
- [ ] Dashboard Live Account panel populates within 30 s.
- [ ] If the wallet has zero history, logs show ONE cold-state warn and
      then silence — NOT a warn every 30 s.
- [ ] If the funder address is malformed, logs show ONE warn at boot
      about `POLY_PROXY_ADDRESS`, then no Data-API traffic.

## 8. WebSocket / market feed verification

Acceptance:
- [ ] Engine Status Panel → Market feed shows a fresh-seconds value
      < 15 for a running engine.
- [ ] `feed-diagnostics` panel shows an active WS connection.

## 9. Log inspection

```bash
grep -c "LIVE_V2 requires" ~/.pm2/logs/edge5-*.log
grep -c "account sync recovered" ~/.pm2/logs/edge5-*.log
```

Acceptance:
- [ ] Credential-miss `error` count ≤ 1 per hour under normal operation.
- [ ] `account sync recovered` count is not a per-30 s loop.

## 10. Restart recovery verification

- `pm2 restart edge5 --update-env`
- Wait 60 s.

Acceptance:
- [ ] The engine auto-resumes to the previously persisted mode.
- [ ] If the persisted mode is LIVE_V2 but creds are missing, the
      StartupErrorPanel appears without operator interaction.
- [ ] `snap.startup.lastFailureMs` is populated within 5 s of boot.

## 11. Final sign-off

- [ ] All checkboxes above are ticked.
- [ ] The dashboard state matches `curl /api/v2/bot/status` output.
- [ ] Operator has archived `~/.pm2/logs/edge5-*.log` from the
      verification session for the deployment record.
