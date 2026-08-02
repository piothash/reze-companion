#!/usr/bin/env node
/**
 * ARC — environment preflight.
 *
 * Fails fast, before any process starts, when a required environment variable
 * is missing. Prints an operator-actionable report; never prints a value.
 *
 *   node scripts/check-env.mjs companion
 *   node scripts/check-env.mjs vps
 */

const ROLE = (process.argv[2] || "companion").toLowerCase();

/** key -> { required, why } */
const COMPANION = {
  NODE_ENV: "Runtime mode. development | production.",
  APP_ENV: "Deployment label shown in diagnostics.",
  SUPABASE_URL: "Control-plane database URL.",
  SUPABASE_PUBLISHABLE_KEY: "Server-side publishable key for anon reads.",
  VITE_SUPABASE_URL: "Browser-visible control-plane URL.",
  VITE_SUPABASE_PUBLISHABLE_KEY: "Browser-visible publishable key.",
  ARC_ENVIRONMENT: "Runtime environment tag.",
  ARC_NETWORK: "testnet | mainnet.",
};

const COMPANION_PROD = {
  ARC_AUTHORITY_SIGNING_KEY:
    "HMAC-SHA256 shared key. Without it the authority gateway fail-closes (KEY_UNCONFIGURED).",
  ARC_REQUIRED_SUPABASE_URL: "Cutover guard. Must equal SUPABASE_URL.",
};

const VPS = {
  NODE_ENV: "Runtime mode.",
  ARC_ENVIRONMENT: "Runtime environment tag.",
  ARC_NETWORK: "testnet | mainnet.",
  ARC_AUTHORITY_ID: "Stable authority identifier used by the registry.",
  ARC_AUTHORITY_SIGNING_KEY: "HMAC-SHA256 shared key. Must match the companion exactly.",
  ARC_COMPANION_BASE_URL: "https URL of the companion control plane.",
  SUPABASE_URL: "Control-plane database URL.",
  ENGINE_MODE: "OBSERVE | ARMED | DISABLED. Start in OBSERVE.",
  ENGINE_ENVIRONMENT: "development | staging | production.",
};

const required =
  ROLE === "vps"
    ? VPS
    : process.env.NODE_ENV === "production"
      ? { ...COMPANION, ...COMPANION_PROD }
      : COMPANION;

const missing = Object.entries(required).filter(([key]) => {
  const value = process.env[key];
  return value === undefined || value.trim() === "";
});

if (missing.length === 0) {
  console.log(
    `ARC preflight OK — ${Object.keys(required).length} required ${ROLE} variables present.`,
  );
  process.exit(0);
}

console.error(`\nARC preflight FAILED — ${missing.length} required ${ROLE} variable(s) missing.\n`);
for (const [key, why] of missing) {
  console.error(`  ✗ ${key}\n      ${why}`);
}
console.error(
  `\nAction: copy ${ROLE === "vps" ? ".env.vps.example" : ".env.production.example"} to your ` +
    `environment file, fill the variables above, then restart.\n` +
    `Recovery: the process refuses to start on purpose — a partial start would ` +
    `run the control plane against an unverified backend or an unsigned authority.\n`,
);
process.exit(1);
