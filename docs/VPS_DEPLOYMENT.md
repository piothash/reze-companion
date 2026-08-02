# ARC — VPS Deployment Guide (Companion Control Plane)

The companion is deployed as a control plane. It never trades. The ARC engine on the VPS remains
the sole trading authority (ADR-0001).

## 1. Build

```bash
bun install --frozen-lockfile
bun run build
```

Output is a production server bundle. No native modules are required — `better-sqlite3` and raw
`ws` are engine-side dependencies and are intentionally absent from the companion.

## 2. Environment

Required (server-only, never `VITE_`-prefixed):

```
SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
ARC_ENVIRONMENT                # development | staging | production
ARC_NETWORK                    # testnet | mainnet
```

Client-visible: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.

Engine-domain keys (market discovery, TWAP feed, execution profile, risk, exposure) are validated
by the Zod configuration loaders at startup; an invalid value aborts the boot with a precise path
and message rather than defaulting silently.

## 3. PM2

```json
{
  "apps": [
    {
      "name": "arc-companion",
      "script": ".output/server/index.mjs",
      "instances": 1,
      "exec_mode": "fork",
      "autorestart": true,
      "max_restarts": 10,
      "restart_delay": 5000,
      "max_memory_restart": "512M",
      "env": { "NODE_ENV": "production", "PORT": "3000" }
    }
  ]
}
```

```bash
pm2 start ecosystem.config.json
pm2 save
pm2 startup
```

Restart is safe at any point: companion state is derived from the append-only event stream and is
rebuilt by `recoverFromEvents` with duplicate suppression (see `RECOVERY_VALIDATION_REPORT.md`).

## 4. Health

`GET /api/public/health` — unauthenticated liveness and version. Suitable for PM2, a load balancer
probe or an external uptime monitor. Returns no user data.

## 5. Logging

Structured JSON to stdout, captured by PM2 (`pm2 logs arc-companion`). Correlation ids are present
on every event line. Secrets are never logged (enforced by `tests/unit/security.test.ts`).

## 6. Error handling

Every route with a loader defines `errorComponent` and `notFoundComponent`; a backend read failure
degrades a panel rather than blanking the console. Configuration errors fail fast at boot.

## 7. Rollback

`pm2 stop arc-companion`, redeploy the previous build directory, `pm2 restart arc-companion`.
Database migrations in this milestone are additive indexes only and require no rollback.
