import {
  createPublishableServerClient,
  getServerSupabaseConfig,
  serverBackendMatchesTarget,
} from "./supabase/backend.server";

export interface OperatorBootstrapState {
  readonly mode: "BOOTSTRAP_OPEN" | "OWNER_FINALIZED" | "AUTH_CONFIGURATION_ERROR";
  readonly bootstrapped: boolean;
  readonly resolved: boolean;
  readonly ownerExists: boolean;
  readonly ownershipFinalized: boolean;
  readonly signupEnabled: boolean;
  /**
   * True unless an explicit `ARC_REQUIRED_SUPABASE_URL` deployment guard is set
   * and the active backend does not match it. No backend URL is compiled in.
   */
  readonly backendMatchesProduction: boolean;
  readonly detail: string;
}

export async function resolveOperatorBootstrapState(): Promise<OperatorBootstrapState> {
  const config = getServerSupabaseConfig();
  const client = createPublishableServerClient();
  if (!config.url || !config.anonKey || !client) {
    return errorState("Authentication configuration is unavailable.");
  }

  const [ownerResult, finalizedResult, settingsResponse] = await Promise.all([
    client.rpc("operator_bootstrapped"),
    client.rpc("ownership_finalized"),
    fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.anonKey } }),
  ]);

  let signupEnabled = false;
  if (settingsResponse.ok) {
    const settings = (await settingsResponse.json()) as { disable_signup?: boolean };
    signupEnabled = settings.disable_signup === false;
  }

  const ownerExists = ownerResult.data === true;
  const ownershipFinalized = finalizedResult.data === true;
  const backendMatchesProduction = serverBackendMatchesTarget();
  const resolved = !ownerResult.error && !finalizedResult.error && settingsResponse.ok;
  const common = {
    ownerExists,
    ownershipFinalized,
    signupEnabled,
    backendMatchesProduction,
    resolved,
  };

  if (resolved && backendMatchesProduction && ownershipFinalized) {
    return {
      ...common,
      mode: "OWNER_FINALIZED",
      bootstrapped: true,
      detail: "Operator ownership is finalized. Registration is closed.",
    };
  }

  // Registration stays open until ownership is explicitly finalized: a
  // provisional development owner must never lock out the intended operator.
  if (resolved && backendMatchesProduction && !ownershipFinalized && signupEnabled) {
    return {
      ...common,
      mode: "BOOTSTRAP_OPEN",
      bootstrapped: false,
      detail: ownerExists
        ? "Bootstrap registration is available. Ownership is provisional until finalized."
        : "Bootstrap registration is available.",
    };
  }

  const detail = !backendMatchesProduction
    ? "The application is not connected to the required backend."
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
