/**
 * ARC — server-side Supabase access (M7.4), server-only by filename.
 *
 * Provides the publishable-key client used for unauthenticated control-plane
 * reads, plus backend diagnostics. Service-role material is never returned,
 * logged or rendered; only its presence is reported.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveSupabaseConfig, type SupabaseBackendConfig } from "./config";
import { backendMatchesRequirement } from "./config";

function serverEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? { ...process.env } : {};
}

/** Resolves the backend configuration from server environment only. */
export function getServerSupabaseConfig(): SupabaseBackendConfig {
  return resolveSupabaseConfig(serverEnv());
}

/** True when the deployment guard is unset or satisfied by the active backend. */
export function serverBackendMatchesTarget(): boolean {
  const env = serverEnv();
  return backendMatchesRequirement(env, resolveSupabaseConfig(env).url);
}

/** True when privileged operations (session revocation) are available. */
export function hasServiceRoleKey(): boolean {
  const value = serverEnv()["SUPABASE_SERVICE_ROLE_KEY"];
  return typeof value === "string" && value.length > 0;
}

/**
 * Publishable-key client for server-side, unauthenticated control-plane reads.
 * RLS applies as `anon`. Never used for privileged work.
 */
export function createPublishableServerClient(): SupabaseClient | null {
  const config = getServerSupabaseConfig();
  if (!config.url || !config.anonKey) return null;
  const key = config.anonKey;

  return createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        // New-format Supabase keys are opaque strings, not bearer JWTs.
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export interface BackendDiagnostics {
  readonly provider: "supabase";
  readonly projectRef: string | null;
  readonly maskedUrl: string;
  readonly configured: boolean;
  readonly matchesDeploymentTarget: boolean;
  readonly databaseConnected: boolean;
  readonly authReachable: boolean;
  readonly serviceRoleConfigured: boolean;
  readonly environment: string;
  readonly network: string;
  readonly errors: readonly string[];
}

/** Read-only backend connection diagnostics for the System/Health surfaces. */
export async function probeBackend(): Promise<BackendDiagnostics> {
  const env = serverEnv();
  const config = getServerSupabaseConfig();
  const base = {
    provider: "supabase" as const,
    projectRef: config.projectRef,
    maskedUrl: config.maskedUrl,
    configured: config.configured,
    matchesDeploymentTarget: backendMatchesRequirement(env, config.url),
    serviceRoleConfigured: hasServiceRoleKey(),
    environment: env["ARC_ENVIRONMENT"] ?? "development",
    network: env["ARC_NETWORK"] ?? "testnet",
    errors: config.errors,
  };

  const client = createPublishableServerClient();
  if (!client || !config.url) {
    return { ...base, databaseConnected: false, authReachable: false };
  }

  const [dbResult, authResponse] = await Promise.all([
    client.rpc("operator_bootstrapped").then(
      (result) => !result.error,
      () => false,
    ),
    fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.anonKey ?? "" },
    }).then(
      (response) => response.ok,
      () => false,
    ),
  ]);

  return { ...base, databaseConnected: dbResult, authReachable: authResponse };
}
