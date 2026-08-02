import { createClient } from "@supabase/supabase-js";

export interface OperatorBootstrapState {
  readonly mode: "BOOTSTRAP_OPEN" | "OWNER_FINALIZED" | "AUTH_CONFIGURATION_ERROR";
  readonly bootstrapped: boolean;
  readonly resolved: boolean;
  readonly ownerExists: boolean;
  readonly ownershipFinalized: boolean;
  readonly signupEnabled: boolean;
  readonly backendMatchesProduction: boolean;
  readonly detail: string;
}

/**
 * Optional deployment guard. When `ARC_REQUIRED_SUPABASE_URL` is set, the
 * companion refuses to bootstrap against any other backend. No backend URL is
 * ever compiled into the application.
 */
function requiredBackend(): string | null {
  const value = process.env["ARC_REQUIRED_SUPABASE_URL"];
  return value ? value.replace(/\/$/, "") : null;
}

export async function resolveOperatorBootstrapState(): Promise<OperatorBootstrapState> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    return errorState("Authentication configuration is unavailable.");
  }

  const normalizedUrl = url.replace(/\/$/, "");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });

  const [ownerResult, finalizedResult, settingsResponse] = await Promise.all([
    client.rpc("operator_bootstrapped"),
    client.rpc("ownership_finalized"),
    fetch(`${normalizedUrl}/auth/v1/settings`, { headers: { apikey: key } }),
  ]);

  let signupEnabled = false;
  if (settingsResponse.ok) {
    const settings = (await settingsResponse.json()) as { disable_signup?: boolean };
    signupEnabled = settings.disable_signup === false;
  }

  const ownerExists = ownerResult.data === true;
  const ownershipFinalized = finalizedResult.data === true;
  const backendMatchesProduction = normalizedUrl === REQUIRED_PRODUCTION_BACKEND;
  const resolved = !ownerResult.error && !finalizedResult.error && settingsResponse.ok;
  const common = {
    ownerExists,
    ownershipFinalized,
    signupEnabled,
    backendMatchesProduction,
    resolved,
  };

  if (resolved && backendMatchesProduction && ownerExists && ownershipFinalized) {
    return {
      ...common,
      mode: "OWNER_FINALIZED",
      bootstrapped: true,
      detail: "Operator ownership is finalized. Registration is closed.",
    };
  }

  if (resolved && backendMatchesProduction && !ownerExists && !ownershipFinalized && signupEnabled) {
    return {
      ...common,
      mode: "BOOTSTRAP_OPEN",
      bootstrapped: false,
      detail: "Bootstrap registration is available.",
    };
  }

  const detail = !backendMatchesProduction
    ? "The application is not connected to the required production backend."
    : !resolved
      ? "Authentication or ownership state could not be verified."
      : !signupEnabled && !ownershipFinalized
        ? "Authentication configuration mismatch. Bootstrap registration is unavailable."
        : "Ownership and authentication configuration are inconsistent.";

  return { ...common, mode: "AUTH_CONFIGURATION_ERROR", bootstrapped: true, detail };
}

function errorState(detail: string): OperatorBootstrapState {
  return {
    mode: "AUTH_CONFIGURATION_ERROR",
    bootstrapped: true,
    resolved: false,
    ownerExists: false,
    ownershipFinalized: false,
    signupEnabled: false,
    backendMatchesProduction: false,
    detail,
  };
}