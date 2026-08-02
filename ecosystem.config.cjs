/**
 * ARC — PM2 process definitions.
 *
 * Two independent processes, deliberately kept separate:
 *
 *   arc-companion : the control plane (this repository's built server).
 *                   Read-only with respect to trading. Safe to restart at any time.
 *   arc-engine    : the trading authority process on the VPS. It is the ONLY
 *                   component permitted to make trading decisions or place orders.
 *
 * Usage on the VPS:
 *   pm2 start ecosystem.config.cjs --only arc-engine --env production
 *   pm2 start ecosystem.config.cjs --only arc-companion --env production
 *   pm2 save && pm2 startup
 *
 * Environment values are NEVER inlined here. Each process reads its own
 * dotenv file (`.env.production` / `.env.vps`) provisioned out-of-band from
 * `.env.production.example` / `.env.vps.example`.
 */
module.exports = {
  apps: [
    {
      name: "arc-companion",
      script: ".output/server/index.mjs",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 5000,
      kill_timeout: 15000,
      wait_ready: false,
      max_memory_restart: "512M",
      time: true,
      out_file: "logs/arc-companion.out.log",
      error_file: "logs/arc-companion.err.log",
      env: { NODE_ENV: "production" },
      env_production: { NODE_ENV: "production", APP_ENV: "production" },
    },
    {
      name: "arc-engine",
      // The trading authority entrypoint as deployed on the VPS.
      // Override with ARC_ENGINE_SCRIPT when the engine lives outside this checkout.
      script: process.env.ARC_ENGINE_SCRIPT || "dist/engine/index.js",
      cwd: process.env.ARC_ENGINE_CWD || __dirname,
      exec_mode: "fork",
      instances: 1, // MUST stay 1 — single trading authority, no clustering.
      autorestart: true,
      max_restarts: 10,
      min_uptime: "60s",
      restart_delay: 5000,
      kill_timeout: 30000, // allow graceful shutdown: drain windows, flush event store
      max_memory_restart: "1G",
      time: true,
      out_file: "logs/arc-engine.out.log",
      error_file: "logs/arc-engine.err.log",
      env: { NODE_ENV: "production", ENGINE_MODE: "OBSERVE" },
      env_production: {
        NODE_ENV: "production",
        APP_ENV: "production",
        // Always start in OBSERVE. Promote to ARMED only after live qualification.
        ENGINE_MODE: "OBSERVE",
      },
    },
  ],
};
