/**
 * ARC — Supabase backend configuration resolution (M7.4).
 *
 * Pure, isomorphic and provider-agnostic. The control-plane backend is chosen
 * exclusively through environment variables: no project URL, project ref or key
 * is ever compiled into the application, and nothing here assumes a particular
 * hosting provider.
 *
 * Supabase is the control plane only (auth, operator identity, configuration,
 * audit). The VPS remains the sole trading authority (ADR-0001).
 */

export type SupabaseEnvSource = Readonly<Record<string, string | undefined>>;

export interface SupabaseBackendConfig {
  /** Backend provider identifier. Always "supabase" for the control plane. */
  readonly provider: "supabase";
  /** Normalized backend URL, or null when unconfigured/invalid. */
  readonly url: string | null;
  /** Publishable (anon) key, or null when unconfigured. Never a secret key. */
  readonly anonKey: string | null;
  /** Project reference derived from the URL host. */
  readonly projectRef: string | null;
  /** Display-safe URL with the project reference partially redacted. */
  readonly maskedUrl: string;
  /** True when URL and publishable key are present and well-formed. */
  readonly configured: boolean;
  readonly errors: readonly string[];
}

const URL_KEYS = ["SUPABASE_URL", "VITE_SUPABASE_URL"] as const;
const ANON_KEYS = [
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

function firstValue(source: SupabaseEnvSource, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Derives the project reference from a Supabase URL host, when present. */
export function projectRefFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const [ref] = host.split(".");
    return ref && ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

/** Redacts the project reference so a backend URL is safe to render. */
export function maskBackendUrl(url: string | null): string {
  const ref = projectRefFromUrl(url);
  if (!url || !ref) return "not configured";
  try {
    const parsed = new URL(url);
    const visible = ref.slice(0, 4);
    return `${parsed.protocol}//${visible}${"*".repeat(Math.max(ref.length - 4, 0))}.${parsed.hostname
      .split(".")
      .slice(1)
      .join(".")}`;
  } catch {
    return "invalid";
  }
}

/**
 * Resolves the control-plane backend from an arbitrary environment source.
 * Accepts both server (`SUPABASE_*`) and browser (`VITE_SUPABASE_*`) names.
 */
export function resolveSupabaseConfig(source: SupabaseEnvSource): SupabaseBackendConfig {
  const rawUrl = firstValue(source, URL_KEYS);
  const anonKey = firstValue(source, ANON_KEYS);
  const errors: string[] = [];

  let url: string | null = null;
  if (!rawUrl) {
    errors.push("SUPABASE_URL is not configured.");
  } else {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
        errors.push("SUPABASE_URL must use https.");
      } else {
        url = `${parsed.protocol}//${parsed.host}`;
      }
    } catch {
      errors.push("SUPABASE_URL is not a valid URL.");
    }
  }

  if (!anonKey) errors.push("SUPABASE_ANON_KEY is not configured.");

  const projectRef = projectRefFromUrl(url);
  return {
    provider: "supabase",
    url,
    anonKey,
    projectRef,
    maskedUrl: maskBackendUrl(url),
    configured: errors.length === 0,
    errors,
  };
}

/**
 * Optional deployment guard: when `ARC_REQUIRED_SUPABASE_URL` is present the
 * companion refuses to operate against any other backend.
 */
export function backendMatchesRequirement(source: SupabaseEnvSource, url: string | null): boolean {
  const required = source["ARC_REQUIRED_SUPABASE_URL"]?.trim().replace(/\/$/, "");
  if (!required) return true;
  return url !== null && url.replace(/\/$/, "") === required;
}
