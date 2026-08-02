/**
 * ARC — live runtime telemetry fetch (M7.0).
 *
 * Server-only by filename. Reads `GET /authority/telemetry` from the active,
 * registered trading engine and falls back to the mirrored payload from the
 * last successful sync. Every returned document says whether it is LIVE or
 * MIRRORED; nothing is invented when the authority is silent (ADR-0001).
 */
import {
  runtimeTelemetrySchema,
  type RuntimeTelemetry,
  type TelemetrySource,
} from "@/core/platform/runtime-telemetry";

import { loadActiveEndpoint, type RegisteredEndpoint } from "./authority-handshake.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

const DEFAULT_TIMEOUT_MILLIS = 6_000;

function timeoutMillis(): number {
  const configured = Number(process.env["ARC_VPS_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MILLIS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MILLIS;
}

function telemetryPath(): string {
  const configured = process.env["ARC_VPS_TELEMETRY_PATH"];
  return configured && configured.startsWith("/") ? configured : "/authority/telemetry";
}

function headers(): Record<string, string> {
  const token = process.env["ARC_VPS_API_TOKEN"];
  return { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

export interface TelemetryView {
  source: TelemetrySource;
  reasonCode: string;
  detail: string;
  latencyMillis: number | null;
  observedAtIso: string;
  syncIntervalMillis: number;
  endpointName: string | null;
  telemetry: RuntimeTelemetry | null;
}

async function fetchTelemetry(
  endpoint: RegisteredEndpoint,
): Promise<{ telemetry: RuntimeTelemetry | null; reasonCode: string; detail: string; latencyMillis: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMillis());
  const startedAt = Date.now();
  try {
    const url = `${endpoint.baseUrl.replace(/\/+$/, "")}${telemetryPath()}`;
    const response = await fetch(url, { method: "GET", headers: headers(), signal: controller.signal });
    const latencyMillis = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      return {
        telemetry: null,
        reasonCode: "HSK_UNAUTHORIZED",
        detail: `The trading authority rejected the companion credential (${response.status}).`,
        latencyMillis,
      };
    }
    if (response.status === 404) {
      return {
        telemetry: null,
        reasonCode: "HSK_PROTOCOL_MISMATCH",
        detail: "The engine does not expose the runtime telemetry endpoint.",
        latencyMillis,
      };
    }
    if (!response.ok) {
      return {
        telemetry: null,
        reasonCode: "HSK_UNREACHABLE",
        detail: `Telemetry endpoint answered ${response.status}.`,
        latencyMillis,
      };
    }

    const parsed = runtimeTelemetrySchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        telemetry: null,
        reasonCode: "HSK_PROTOCOL_MISMATCH",
        detail: `Telemetry did not match the contract: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
        latencyMillis,
      };
    }
    return {
      telemetry: parsed.data,
      reasonCode: "HSK_ACCEPTED",
      detail: "Live runtime telemetry.",
      latencyMillis,
    };
  } catch (error) {
    return {
      telemetry: null,
      reasonCode: "HSK_UNREACHABLE",
      detail:
        (error as Error).name === "AbortError"
          ? "Telemetry request timed out."
          : `Engine unreachable: ${(error as Error).message}`,
      latencyMillis: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Mirrors the newest telemetry so a PM2 restart or refresh recovers context. */
async function mirror(client: AnyClient, endpointId: string, telemetry: RuntimeTelemetry): Promise<void> {
  await client
    .from("engine_runtime_identity")
    .update({ payload: { telemetry }, observed_at: new Date().toISOString() })
    .eq("endpoint_id", endpointId);
}

async function readMirror(client: AnyClient, endpointId: string): Promise<RuntimeTelemetry | null> {
  const { data } = await client
    .from("engine_runtime_identity")
    .select("payload")
    .eq("endpoint_id", endpointId)
    .maybeSingle();
  const payload = (data as { payload?: Record<string, unknown> } | null)?.payload;
  const candidate = payload?.["telemetry"];
  if (!candidate) return null;
  const parsed = runtimeTelemetrySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** The single telemetry read every live operator page performs. */
export async function readRuntimeTelemetry(client: AnyClient): Promise<TelemetryView> {
  const endpoint = await loadActiveEndpoint(client);
  const observedAtIso = new Date().toISOString();

  if (!endpoint) {
    return {
      source: "NONE",
      reasonCode: "HSK_NO_ENDPOINT",
      detail: "No active trading engine is registered.",
      latencyMillis: null,
      observedAtIso,
      syncIntervalMillis: 5_000,
      endpointName: null,
      telemetry: null,
    };
  }

  const result = await fetchTelemetry(endpoint);
  if (result.telemetry) {
    await mirror(client, endpoint.id, result.telemetry).catch(() => undefined);
    return {
      source: "LIVE",
      reasonCode: result.reasonCode,
      detail: result.detail,
      latencyMillis: result.latencyMillis,
      observedAtIso,
      syncIntervalMillis: endpoint.syncIntervalMillis,
      endpointName: endpoint.name,
      telemetry: result.telemetry,
    };
  }

  const mirrored = await readMirror(client, endpoint.id).catch(() => null);
  return {
    source: mirrored ? "MIRRORED" : "NONE",
    reasonCode: result.reasonCode,
    detail: mirrored
      ? `${result.detail} Showing the last mirrored telemetry.`
      : result.detail,
    latencyMillis: result.latencyMillis,
    observedAtIso,
    syncIntervalMillis: endpoint.syncIntervalMillis,
    endpointName: endpoint.name,
    telemetry: mirrored,
  };
}
