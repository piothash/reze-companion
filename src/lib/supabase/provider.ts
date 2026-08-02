/**
 * ARC — Supabase provider entry point (M7.4).
 *
 * Single, isomorphic place that answers "which control-plane backend are we
 * talking to?". Safe for browser and server: it only ever exposes the backend
 * URL, project reference and publishable key — never a service-role key.
 */
import {
  backendMatchesRequirement,
  resolveSupabaseConfig,
  type SupabaseBackendConfig,
  type SupabaseEnvSource,
} from "./config";

export type { SupabaseBackendConfig } from "./config";

function readEnvSource(): SupabaseEnvSource {
  const source: Record<string, string | undefined> = {};

  try {
    Object.assign(source, import.meta.env as unknown as Record<string, string | undefined>);
  } catch {
    /* import.meta.env unavailable — fall through to process.env */
  }

  if (typeof process !== "undefined" && process.env) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) source[key] = value;
    }
  }

  return source;
}

/** Resolves the active control-plane backend from the runtime environment. */
export function getSupabaseBackend(): SupabaseBackendConfig {
  return resolveSupabaseConfig(readEnvSource());
}

/** True when no deployment guard is set, or the active backend matches it. */
export function backendMatchesDeploymentTarget(): boolean {
  const source = readEnvSource();
  return backendMatchesRequirement(source, resolveSupabaseConfig(source).url);
}

export interface BackendIdentity {
  readonly provider: "supabase";
  readonly projectRef: string | null;
  readonly maskedUrl: string;
  readonly configured: boolean;
  readonly matchesDeploymentTarget: boolean;
  readonly errors: readonly string[];
}

/** Display-safe backend identity for diagnostics surfaces. */
export function getBackendIdentity(): BackendIdentity {
  const source = readEnvSource();
  const config = resolveSupabaseConfig(source);
  return {
    provider: config.provider,
    projectRef: config.projectRef,
    maskedUrl: config.maskedUrl,
    configured: config.configured,
    matchesDeploymentTarget: backendMatchesRequirement(source, config.url),
    errors: config.errors,
  };
}
