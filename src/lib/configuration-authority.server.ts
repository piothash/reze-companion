/**
 * ARC — trading authority configuration client (M6.7).
 *
 * Server-only by filename. The companion never activates configuration itself:
 * it dispatches to the VPS trading authority and reports back exactly what the
 * authority answers. Absence of an answer is never treated as success.
 */
import {
  authorityConfigurationSchema,
  interpretAuthorityReply,
  type AuthorityConfiguration,
  type AuthorityOutcome,
  type ConfigurationDispatch,
} from "@/core/configuration/runtime-sync";

const DEFAULT_TIMEOUT_MILLIS = 8_000;

export interface AuthorityEndpoint {
  readonly id: string | null;
  readonly name: string | null;
  readonly baseUrl: string;
  readonly environment: string | null;
}

function timeoutMillis(): number {
  const raw = Number(process.env["ARC_VPS_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MILLIS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MILLIS;
}

function authHeaders(): Record<string, string> {
  const token = process.env["ARC_VPS_API_TOKEN"];
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function call(
  url: string,
  init: RequestInit,
): Promise<{ reply: AuthorityConfiguration | null; detail: string; latencyMillis: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMillis());
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const latencyMillis = Date.now() - startedAt;
    const text = await response.text();
    if (!response.ok && response.status >= 500) {
      return {
        reply: null,
        detail: `Trading authority responded ${response.status}.`,
        latencyMillis,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { reply: null, detail: "Trading authority returned a non-JSON body.", latencyMillis };
    }
    const result = authorityConfigurationSchema.safeParse(parsed);
    if (!result.success) {
      return {
        reply: null,
        detail: `Trading authority response did not match the configuration contract: ${result.error.issues[0]?.message ?? "invalid"}.`,
        latencyMillis,
      };
    }
    return { reply: result.data, detail: "ok", latencyMillis };
  } catch (error) {
    return {
      reply: null,
      detail:
        (error as Error).name === "AbortError"
          ? "Trading authority timed out."
          : `Trading authority unreachable: ${(error as Error).message}`,
      latencyMillis: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Dispatches a configuration version and waits for the authority verdict. */
export async function dispatchConfiguration(
  endpoint: AuthorityEndpoint | null,
  dispatch: ConfigurationDispatch,
): Promise<{ outcome: AuthorityOutcome; latencyMillis: number | null }> {
  if (!endpoint) {
    return {
      outcome: interpretAuthorityReply(null, {
        kind: "UNREGISTERED",
        detail:
          "No active trading authority endpoint is registered. The version is stored and stays pending until the VPS applies it.",
      }),
      latencyMillis: null,
    };
  }

  const { reply, detail, latencyMillis } = await call(
    join(endpoint.baseUrl, "/api/configuration/apply"),
    { method: "POST", headers: authHeaders(), body: JSON.stringify(dispatch) },
  );

  return {
    outcome: reply
      ? interpretAuthorityReply(reply)
      : interpretAuthorityReply(null, { kind: "UNREACHABLE", detail }),
    latencyMillis,
  };
}

/** Reads the configuration the engine reports it is currently running. */
export async function readActiveConfiguration(endpoint: AuthorityEndpoint | null): Promise<{
  reply: AuthorityConfiguration | null;
  detail: string;
  latencyMillis: number | null;
}> {
  if (!endpoint) {
    return { reply: null, detail: "No trading authority endpoint registered.", latencyMillis: null };
  }
  const { reply, detail, latencyMillis } = await call(
    join(endpoint.baseUrl, "/api/configuration/active"),
    { method: "GET", headers: authHeaders() },
  );
  return { reply, detail, latencyMillis };
}
