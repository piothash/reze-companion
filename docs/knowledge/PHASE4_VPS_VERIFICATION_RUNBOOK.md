# Phase 4 — VPS Verification Runbook (Operator-Executed)

**Purpose.** Give a single operator a start-to-finish, evidence-based
procedure to validate the production Polymarket trading bot on the
target VPS. Every check produces an artifact (log line, screenshot, or
command output) that the operator pastes into §10 (Acceptance
Checklist) and §11 (Evidence) so the engineering agent can produce a
signed verification report afterwards.

**Scope.** Runtime verification only. Nothing in this runbook modifies
application code, tests, configuration, or accepted technical debt
(Phase 3 §1). The sandbox that authored this document cannot execute
any of the commands below — they must run on the VPS.

**Baseline.** Phase 1B (validated), Phase 2 (audit), Phase 3
(certified), Pre-Phase 4 (static verified). Deviation from these
baselines = **FAIL** for the affected item.

**Conventions.**
- `$P4` = absolute path to the deployed `p4/` checkout on the VPS.
- `$LOG` = `$P4/logs` (matches `ecosystem.config.js`).
- All commands are `bash`, run as the deploy user, from `$P4` unless
  stated otherwise.
- "Capture" = save to `evidence/<section>/<name>.{log,png,json}` under
  an operator-chosen evidence root.

---

## 1. Prerequisites

### 1.1 Required software (host)

| Component | Minimum | Verify |
|-----------|---------|--------|
| OS | Ubuntu 22.04 LTS (or equivalent) | `lsb_release -a` |
| Node.js | 20.x LTS | `node -v` |
| pnpm | 9.x | `pnpm -v` |
| PM2 | latest | `pm2 -v` |
| `pm2-logrotate` | installed | `pm2 list \| grep -i logrotate` |
| build-essential + python3 (for `better-sqlite3`) | installed | `dpkg -l build-essential python3` |
| nginx | 1.18+ (only if fronting dashboard) | `nginx -v` |
| curl, jq, sqlite3 | installed | `curl -V && jq -V && sqlite3 -version` |

### 1.2 Required environment variables

Populate `$P4/.env` from `reference/p4/.env.example` (authoritative
list) and confirm:

- Core: `NODE_ENV=production`, `PORT`, `NEXT_TELEMETRY_DISABLED=1`.
- Engine mode: `ENGINE_MODE` (`paper` or `live`), `BOT_ID`.
- Persistence: `DB_PATH` (points to a writable path with WAL support).
- Polymarket: `POLYMARKET_HOST`, `POLYMARKET_CHAIN_ID`,
  `POLYMARKET_PROXY_ADDRESS` (live only), `POLYMARKET_API_KEY`,
  `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`,
  `POLYMARKET_SIGNER_PRIVATE_KEY` (live only).
- Risk: any override for `DEFAULT_LIMITS` (see
  `reference/p4/lib/v2/engine/risk.ts`); leave unset to accept defaults.
- Diagnostics: `DIRECTION_TRACE` unset (default OFF), `LOG_LEVEL=info`.
- Alerts (optional): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

Verify presence WITHOUT printing values:

```bash
for v in NODE_ENV PORT ENGINE_MODE BOT_ID DB_PATH POLYMARKET_HOST \
         POLYMARKET_API_KEY POLYMARKET_API_SECRET POLYMARKET_API_PASSPHRASE; do
  test -n "${!v}" && echo "$v: set" || echo "$v: MISSING"
done
```

Any `MISSING` = **FAIL** for §1.

### 1.3 Required credentials

- Polymarket API key/secret/passphrase (paper: sandbox account is OK).
- For live only: funded Polymarket proxy wallet + signer private key.
- SSH access to VPS with the deploy user.
- (Optional) Telegram bot token + chat ID for alerts.

Never paste credentials into this runbook or logs; store only in
`$P4/.env` with mode `600`.

### 1.4 Expected repository state

```bash
cd $P4
git status                # -> "working tree clean"
git log -1 --oneline      # -> matches the release SHA
git rev-parse HEAD > evidence/00-prereq/head.txt
```

### 1.5 Required PM2 configuration

Confirm `ecosystem.config.js` matches the audited baseline (Phase 2
§5):

```bash
grep -E "name|script|autorestart|exp_backoff_restart_delay|min_uptime|max_restarts|max_memory_restart|kill_timeout" \
  ecosystem.config.js | tee evidence/00-prereq/pm2-config.txt
```

Expected: single instance, `autorestart: true`,
`exp_backoff_restart_delay: 200`, `min_uptime: 30000`,
`max_restarts: 10`, `max_memory_restart: '512M'`, `kill_timeout: 8000`.

---

## 2. Build Verification

### 2.1 Dependency installation

```bash
cd $P4
pnpm install --frozen-lockfile 2>&1 | tee evidence/02-build/install.log
```

Expected: exit 0, "Done" summary, `better-sqlite3` native build
succeeds.
Common failures: missing `build-essential`/`python3` → install and
retry; corporate proxy blocking `registry.npmjs.org` → set
`HTTPS_PROXY`.

### 2.2 Build

```bash
pnpm build 2>&1 | tee evidence/02-build/build.log
```

Expected: `next build` completes, prints route table, exit 0. No
TypeScript errors. `.next/` populated.
Common failures: missing env vars used at build time → set them in
`.env`; peer-dep warnings are non-fatal.

### 2.3 Test suite

```bash
pnpm test 2>&1 | tee evidence/02-build/test.log
```

Expected: all suites under `tests/unit/**` and `tests/integration/**`
green (baseline: Phase 1B §5). Direction-trace, accounting-invariant,
and dashboard-auth-removed suites MUST pass.
Common failures: `better-sqlite3` binary mismatch after Node upgrade →
`pnpm rebuild better-sqlite3`.

**Success criteria for §2:** all three commands exit 0, artifacts
captured.

---

## 3. PM2 Verification

### 3.1 Start

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 status | tee evidence/03-pm2/status-after-start.txt
```

Expected: process `edge5` (or configured name) status `online`, restart
count `0`, uptime > 30s within a minute.

### 3.2 Logs

```bash
pm2 logs edge5 --lines 200 --nostream | tee evidence/03-pm2/boot.log
```

Expected boot signals (grep to confirm):
- `instrumentation` bootstrap line
- `Edge5Engine` phase transitions `OFFLINE → WAITING → PRIORITY_1`
- `maybeAutoResume` executed (SCRATCH sweep result reported)
- No unhandled promise rejections; no `Error:` at level `fatal`.

### 3.3 Restart

```bash
pm2 restart edge5
sleep 40
pm2 status | tee evidence/03-pm2/status-after-restart.txt
pm2 logs edge5 --lines 200 --nostream | tee evidence/03-pm2/restart.log
```

Expected: single restart increment, uptime resets, boot signals
re-appear, no orphaned open trades reported by
`closeOrphanedOpenTrades`.

### 3.4 Stop

```bash
pm2 stop edge5
pm2 status | tee evidence/03-pm2/status-after-stop.txt
```

Expected: status `stopped`, no zombie child processes
(`ps -ef | grep node`).

### 3.5 Health

```bash
curl -sS http://127.0.0.1:${PORT:-3000}/api/v2/bot/health | jq . \
  | tee evidence/03-pm2/health.json
```

Expected: HTTP 200, `{"ok":true,...}` with engine phase populated.

---

## 4. V1 Paper Engine Verification

Precondition: `ENGINE_MODE=paper`, `V1` selected in UI, PM2 running.

| Step | Command / Action | Expected Observation | Evidence |
|------|------------------|----------------------|----------|
| Startup | Navigate to `/v1`, press **Start** | Engine phase becomes `PRIORITY_1` within 25s; log line `V1 engine started` | screenshot + `v1-start.log` |
| Signal generation | Wait one full poll cycle (~20s) | `sniper.ts` logs candidate; at least one `signal:evaluated` entry | log excerpt |
| Order lifecycle | Allow one paper order to fill | `paper: place → fill → close` sequence in log; ledger row appears in dashboard | screenshot + `v1-fill.log` |
| Accounting | Inspect Live Account panel after fill | Bankroll, exposure, realized/unrealized PnL update; accounting invariant log SILENT (violation-only) | screenshot |
| PnL | Compare pre/post-fill account snapshot | Δ realized PnL = payout − cost; matches ledger | 2× screenshots |
| Shutdown | Press **Stop** | Phase transitions to `STOPPING` then `OFFLINE` within 8s (`kill_timeout`) | log excerpt |
| Recovery | While an order is open, `pm2 restart edge5`; wait 60s | Reconciler picks up the position; no duplicate order placed; `closeOrphanedOpenTrades` reports 0 or reconciles cleanly | `v1-recovery.log` |

Failure indicators: stuck in `WAITING`, duplicate fills, accounting
invariant log line printed, ledger row missing after fill.

---

## 5. V2 Paper Engine Verification

Precondition: `ENGINE_MODE=paper`, `V2` selected in UI, PM2 running.

| Step | Command / Action | Expected Observation | Evidence |
|------|------------------|----------------------|----------|
| Startup | Navigate to `/v2`, press **Start** | `Edge5Engine` transitions OFFLINE→WAITING→PRIORITY_1→PRIORITY_2 within 40s | screenshot + `v2-start.log` |
| Strategy registry | Open Strategy Configurator | Edge1..Edge6 listed; toggle one on/off; state persists across refresh | 2× screenshots |
| Standing order | Configure one SLO in Limit Order panel | `StandingOrderManager` logs `trigger armed`; on trigger, order placed once (idempotency key visible in log) | log excerpt |
| Signal generation | Wait one full PRIORITY_2 cycle (~30s) | At least one `signal:evaluated` per active strategy | log excerpt |
| Order lifecycle | Allow one paper order end-to-end | `place → fill → settle` in log; ledger + analytics panels update | screenshot |
| Accounting invariant | Inspect log during settlement | No `ACCOUNTING_INVARIANT_VIOLATION` line (silent = pass) | `grep` result |
| PnL (13 fields) | Compare Analytics panel to ledger totals | All 13 tracked fields (Phase 1B §3) reconcile within 1 cent | screenshot + note |
| Settlement | Wait for a market to resolve (or force a paper resolution if supported) | `settleTrade` idempotent; `updateSettledBalance` called exactly once | log excerpt |
| Recovery (P-3) | Restart PM2 with an open V2 trade | On boot, `openTrade` row exists; `closeOrphanedOpenTrades` reconciles; no duplicate order | `v2-recovery.log` |
| Shutdown | Press **Stop** | Timers cancelled, WS sockets closed, phase → OFFLINE within 8s | log excerpt |

Failure indicators: any phase stall > 60s, duplicate SLO trigger,
accounting invariant violation, PnL field drift, orphaned open trade
after boot sweep.

---

## 6. Dashboard Verification

Precondition: dashboard reachable at `http://<vps>/` (or via nginx).
Open browser DevTools (Console + Network) BEFORE clicking anything.

### 6.1 Global

- **No console errors** on any page load (warnings allowed if
  pre-existing baseline).
- **No 4xx/5xx** in Network tab except intentional (e.g., 404 on
  optional endpoint).
- **Auth removed** (Stage 1A) — no login prompt, no `/login` route,
  `/api/auth/*` returns 404.

Capture: full-page screenshot + DevTools Console screenshot + HAR
export per page.

### 6.2 Panels (each panel = one row of evidence)

| Panel | File | Interactive controls to exercise | Expected | Failure indicator |
|-------|------|----------------------------------|----------|-------------------|
| Terminal Dashboard | `components/v2/terminal-dashboard.tsx` | Tab switching | All tabs render | Blank tab, XHR 500 |
| Command Deck | `command-deck.tsx` | Start / Stop / Pause | Buttons toggle engine phase; state matches `/api/v2/bot/status` | Button no-op, state desync |
| Live Account | `live-account.tsx` | — | CLOB label present (D-2 fix); balances update | SIDE label reappears |
| Ledger | `ledger.tsx` | Filter, paginate, expand row | Rows load; direction column matches bot direction, not CLOB side | Direction mismatch |
| Analytics | `analytics-panel.tsx` | Date range picker | 13 PnL fields render; totals reconcile with ledger | NaN, mismatch |
| Market Monitor | `market-monitor.tsx` | Search, select market | Selected market subscribes; price ticks visible | Static prices > 10s |
| Intel Feed | `intel-feed.tsx` | Scroll | New signals stream in during PRIORITY_2 | No new items in 2 min |
| Feed Diagnostics | `feed-diagnostics.tsx` | — | WS status `open`; last-tick age < 5s per subscribed market | `closed` / age > 30s |
| Profiles | `profiles-panel.tsx` | Load / save profile | Profile round-trips to `/api/v2/bot/profiles` | 500 error |
| Strategy Configurator | `strategy-configurator.tsx` | Toggle each Edge1..Edge6 | Toggle persists across reload | Reset on reload |
| System Panel | `system-panel.tsx` | — | Uptime, memory, phase visible | Blank |
| Limit Order (SLO) | `limit-order-panel.tsx` | Create / edit / cancel SLO | Round-trip to `StandingOrderManager` log | Silent failure |
| Trade Replay | `trade-replay-view.tsx` | Open a settled trade | Replay renders; timings monotonic | Missing frames |
| Top Nav | `top-nav.tsx` | Every route link | Navigates without full reload; no console error | Console error |
| Number Field | `number-field.tsx` | Type + and − | Debounced updates fire once | Multiple duplicate submits |

### 6.3 API surface probe

For each of the 12 endpoints under `app/api/v2/bot/**`:

```bash
for ep in health status analytics audit control database notifications \
          preflight profiles strategies system trades; do
  echo "== $ep =="
  curl -sS -o /dev/null -w "%{http_code}\n" \
    "http://127.0.0.1:${PORT:-3000}/api/v2/bot/$ep"
done | tee evidence/06-dashboard/api-surface.txt
```

Expected: all GETs return 200 (or 405 for POST-only where applicable);
none return 500. Auth endpoints (removed) return 404 — capture that
too:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:${PORT:-3000}/api/auth/session" \
  | tee evidence/06-dashboard/auth-removed.txt
# expect 404
```

---

## 7. Polymarket Connectivity

### 7.1 Market discovery

```bash
pm2 logs edge5 --lines 500 --nostream \
  | grep -iE "market-discovery|discovered [0-9]+ markets" \
  | tee evidence/07-polymarket/discovery.log
```

Expected: at least one `discovered N markets` line within 60s of boot;
N > 0.

### 7.2 WebSocket connection

```bash
pm2 logs edge5 --lines 500 --nostream \
  | grep -iE "clob-ws|ws:open|ws:close|ws:reconnect" \
  | tee evidence/07-polymarket/ws.log
```

Expected: `ws:open` after subscription; no `ws:close` unless followed
by `ws:reconnect` with exponential backoff (feed-chaos.test.ts
baseline). No hot reconnect loop (< 1 reconnect / 30s sustained).

### 7.3 Market updates

Feed Diagnostics panel: last-tick age < 5s per subscribed market during
US market hours. Capture screenshot.

### 7.4 Reconnect behaviour (induced)

On a low-value paper market only:

```bash
# Simulate transient network loss (10s)
sudo iptables -A OUTPUT -p tcp -d clob.polymarket.com --dport 443 -j DROP
sleep 10
sudo iptables -D OUTPUT -p tcp -d clob.polymarket.com --dport 443 -j DROP
```

Expected: `ws:close` → `ws:reconnect` (backoff 200ms → …) → `ws:open`
within 30s. Feed Diagnostics returns to `open`. Capture
`evidence/07-polymarket/reconnect.log`.

### 7.5 Data freshness

Reconciler runs every 60s. Confirm:

```bash
pm2 logs edge5 --lines 500 --nostream \
  | grep -iE "reconciler:" | tail -n 20 \
  | tee evidence/07-polymarket/reconciler.log
```

Expected: `reconciler:tick` within the last 90s; category counters
sane; no `reconciler:error`.

### 7.6 Order pipeline

Place one small paper order (V2). Confirm log sequence:

```
place → sign(EIP-712) → hmac → submit → ack → fill → settle
```

Capture `evidence/07-polymarket/order-pipeline.log`. Confirm the
idempotency key appears exactly once.

---

## 8. Runtime Stability (Soak)

**Recommended duration:** 4 hours minimum for release-candidate; 24
hours preferred for a first production deployment.

Start soak:

```bash
date -u +%FT%TZ > evidence/08-soak/started_at.txt
```

Every 30 minutes, capture:

```bash
pm2 status                                > evidence/08-soak/pm2-$(date -u +%H%M).txt
pm2 describe edge5 | grep -E "uptime|mem|restart" \
                                          >> evidence/08-soak/describe.txt
ps -p $(pm2 pid edge5) -o %cpu,%mem,rss,vsz,etime \
                                          >> evidence/08-soak/proc.txt
curl -sS http://127.0.0.1:${PORT:-3000}/api/v2/bot/health | jq . \
                                          >> evidence/08-soak/health.jsonl
pm2 logs edge5 --lines 1 --nostream       >> evidence/08-soak/heartbeat.log
```

Monitor:

- **CPU:** steady-state < 30% on a 2-vCPU host; transient spikes OK.
- **Memory (RSS):** stable; must not approach `max_memory_restart: 512M`.
- **Restart count:** unchanged for the duration.
- **WS health:** Feed Diagnostics `open`; reconnects rare and
  successful.
- **Logs:** `grep -iE "error|fatal|violation|orphan" evidence/08-soak/*` returns nothing unexpected.
- **Recovery:** halfway through soak, `pm2 restart edge5` once and
  confirm post-restart state (§9).

Any of: PM2 restart not triggered by operator, RSS growth > 20% per
hour without bound, ACCOUNTING_INVARIANT_VIOLATION, sustained WS
reconnect loop = **FAIL** for §8.

---

## 9. Restart Verification

```bash
pm2 restart edge5
sleep 60
pm2 status                                | tee evidence/09-restart/status.txt
pm2 logs edge5 --lines 300 --nostream     | tee evidence/09-restart/boot.log
curl -sS http://127.0.0.1:${PORT:-3000}/api/v2/bot/health | jq . \
                                          | tee evidence/09-restart/health.json
```

Expected post-restart state:

1. PM2 status `online`; restart counter +1; uptime resets.
2. `Edge5Engine` phases replay OFFLINE→WAITING→PRIORITY_1→PRIORITY_2.
3. `maybeAutoResume()` runs; SCRATCH sweep result logged.
4. `closeOrphanedOpenTrades` reports 0 orphans OR reconciles them with
   a logged reason.
5. Feed Diagnostics returns to `open` within 30s.
6. No duplicate orders placed for pre-restart open positions.
7. Ledger totals identical to pre-restart snapshot (modulo new fills).
8. `/api/v2/bot/health` returns 200 with correct phase.

Any deviation = **FAIL** for §9.

---

## 10. Production Acceptance Checklist

Mark each row `PASS`, `FAIL`, or `NOT VERIFIED`. Paste the completed
table back to the engineering agent.

| # | Item | Section | Result |
|---|------|---------|--------|
| 1 | Host software matches §1.1 table | 1.1 | ☐ |
| 2 | All required env vars present | 1.2 | ☐ |
| 3 | Credentials present, `.env` mode 600 | 1.3 | ☐ |
| 4 | Repo clean, HEAD matches release SHA | 1.4 | ☐ |
| 5 | PM2 config matches audited baseline | 1.5 | ☐ |
| 6 | `pnpm install` exit 0 | 2.1 | ☐ |
| 7 | `pnpm build` exit 0 | 2.2 | ☐ |
| 8 | `pnpm test` all green | 2.3 | ☐ |
| 9 | PM2 start → online > 30s | 3.1 | ☐ |
| 10 | Boot log signals present | 3.2 | ☐ |
| 11 | PM2 restart clean | 3.3 | ☐ |
| 12 | PM2 stop clean | 3.4 | ☐ |
| 13 | `/api/v2/bot/health` 200 | 3.5 | ☐ |
| 14 | V1 startup + signal + fill + accounting + PnL + recovery + shutdown | 4 | ☐ |
| 15 | V2 startup + strategies + SLO + fill + settle + PnL (13) + recovery + shutdown | 5 | ☐ |
| 16 | All 15 dashboard panels behave per §6.2 | 6.2 | ☐ |
| 17 | 12 API endpoints per §6.3 | 6.3 | ☐ |
| 18 | Auth-removed endpoints 404 | 6.3 | ☐ |
| 19 | No browser console errors | 6.1 | ☐ |
| 20 | Market discovery reports N > 0 | 7.1 | ☐ |
| 21 | WS steady `open`, no reconnect loop | 7.2 | ☐ |
| 22 | Market updates fresh (< 5s) | 7.3 | ☐ |
| 23 | Induced reconnect recovers < 30s | 7.4 | ☐ |
| 24 | Reconciler tick < 90s | 7.5 | ☐ |
| 25 | Order pipeline sequence intact + idempotency key unique | 7.6 | ☐ |
| 26 | Soak ≥ 4h, CPU/mem stable, 0 unexpected restarts | 8 | ☐ |
| 27 | No accounting invariant violations during soak | 8 | ☐ |
| 28 | Post-restart state matches §9 (all 8 items) | 9 | ☐ |

---

## 11. Evidence Collection

Directory layout the operator must produce and archive
(`tar czf p4-vps-evidence-<date>.tgz evidence/`):

```
evidence/
  00-prereq/     head.txt, pm2-config.txt, env-presence.txt
  02-build/      install.log, build.log, test.log
  03-pm2/        status-after-start.txt, boot.log, restart.log,
                 status-after-restart.txt, status-after-stop.txt,
                 health.json
  04-v1/         v1-start.log, v1-fill.log, v1-recovery.log,
                 screenshots/*.png
  05-v2/         v2-start.log, v2-fill.log, v2-recovery.log,
                 screenshots/*.png, pnl-snapshots/*.png
  06-dashboard/  screenshots/*.png, console/*.png, network/*.har,
                 api-surface.txt, auth-removed.txt
  07-polymarket/ discovery.log, ws.log, reconnect.log,
                 reconciler.log, order-pipeline.log
  08-soak/       started_at.txt, pm2-*.txt, describe.txt, proc.txt,
                 health.jsonl, heartbeat.log, ended_at.txt
  09-restart/    status.txt, boot.log, health.json
  10-checklist/  checklist.md    (the filled §10 table)
  11-verdict/    verdict.txt     (one of the three §12 values +
                                  one-paragraph justification)
```

Redact any secrets before archiving (`.env` MUST NOT be included).

---

## 12. Final Operator Verdict

The operator writes exactly one of the following into
`evidence/11-verdict/verdict.txt`, followed by a one-paragraph
justification that references the checklist row numbers from §10:

- **RELEASE READY** — every §10 row `PASS`.
- **RELEASE READY WITH MINOR ISSUES** — all correctness / safety rows
  (6–8, 13–15, 20–28) `PASS`; only cosmetic rows (16 sub-items,
  19 warnings) `FAIL` or `NOT VERIFIED`, each with a captured
  workaround.
- **NOT RELEASE READY** — any of rows 6–8, 13–15, 20–28 `FAIL`, OR
  more than three rows `NOT VERIFIED`.

The engineering agent will accept only the operator's collected
evidence as the basis for the final Phase 4 verification report. No
verdict inferred without the archive from §11.

---

**Stop here.** Await operator evidence archive + verdict before any
further engineering work.
