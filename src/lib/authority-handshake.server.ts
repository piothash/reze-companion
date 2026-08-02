/**
 * ARC — VPS authority handshake runtime (M6.8).
 *
 * Server-only by filename. Performs the runtime handshake against the
 * registered VPS trading engine, mirrors the reported runtime identity into
 * the control plane for recovery, and derives the dashboard runtime state.
 *
 * The companion never generates runtime facts. Every value here either comes
 * from the authority's own handshake answer or is explicitly marked as a
 * mirrored value from the last successful sync (ADR-0001).
 */
import {
  deriveDashboardState,
  handshakeResponseSchema,
  mergeHealth,
  verifyRuntimeConfiguration,
  worstHealth,
  HANDSHAKE_REASON,
  type DashboardStateReport,
  type HandshakeResponse,
  type HandshakeTransport,
  type HealthEntry,
} from "@/core/platform/authority-handshake";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

const DEFAULT_TIMEOUT_MILLIS = 6_000;

export interface RegisteredEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  environment: string;
  apiVersion: string | null;
  engineVersion: string | null;
  platformVersion: string | null;
  healthEndpoint: string;
  handshakeEndpoint: string;
  publicIdentifier: string | null;
  syncIntervalMillis: number;
  isActive: boolean;
  lastSeenAtIso: string | null;
}

const ENDPOINT_COLUMNS =
  "id, name, base_url, environment, api_version, engine_version, platform_version, health_endpoint, handshake_endpoint, public_identifier, sync_interval_millis, is_active, last_seen_at, created_at";

export function toEndpoint(row: Record<string, unknown>): RegisteredEndpoint {
  return {
    id: row["id"] as string,
    name: (row["name"] as string) ?? "engine",
    baseUrl: row["base_url"] as string,
    environment: (row["environment"] as string) ?? "production",
    apiVersion: (row["api_version"] as string | null) ?? null,
    engineVersion: (row["engine_version"] as string | null) ?? null,
    platformVersion: (row["platform_version"] as string | null) ?? null,
    healthEndpoint: (row["health_endpoint"] as string | null) ?? "/health/details",
    handshakeEndpoint: (row["handshake_endpoint"] as string | null) ?? "/authority/handshake",
    publicIdentifier: (row["public_identifier"] as string | null) ?? null,
    syncIntervalMillis: (row["sync_interval_millis"] as number | null) ?? 5_000,
    isActive: Boolean(row["is_active"]),
    lastSeenAtIso: (row["last_seen_at"] as string | null) ?? null,
  };
}

export async function listEndpoints(client: AnyClient): Promise<RegisteredEndpoint[]> {
  const { data } = await client
    .from("engine_endpoints")
    .select(ENDPOINT_COLUMNS)
    .order("created_at", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map(toEndpoint);
}

export async function loadActiveEndpoint(client: AnyClient): Promise<RegisteredEndpoint | null> {
  const endpoints = await listEndpoints(client);
  return endpoints.find((endpoint) => endpoint.isActive) ?? null;
}

// ---------------------------------------------------------------------------
// Handshake transport
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const token = process.env["ARC_VPS_API_TOKEN"];
  return {
    accept: "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface HandshakeResult {
  transport: HandshakeTransport;
  reasonCode: string;
  detail: string;
  latencyMillis: number | null;
  identity: HandshakeResponse | null;
}

/** Single handshake attempt. A missing or malformed answer is never success. */
export async function performHandshake(
  endpoint: RegisteredEndpoint | null,
): Promise<HandshakeResult> {
  if (!endpoint) {
    return {
      transport: "NOT_REGISTERED",
      reasonCode: HANDSHAKE_REASON.NOT_REGISTERED,
      detail: "No active trading engine is registered.",
      latencyMillis: null,
      identity: null,
    };
  }

  const timeout = Number(process.env["ARC_VPS_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MILLIS);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MILLIS,
  );
  const startedAt = Date.now();

  try {
    const response = await fetch(join(endpoint.baseUrl, endpoint.handshakeEndpoint), {
      method: "GET",
      headers: authHeaders(),
      signal: controller.signal,
    });
    const latencyMillis = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      return {
        transport: "UNAUTHORIZED",
        reasonCode: HANDSHAKE_REASON.UNAUTHORIZED,
        detail: `The trading authority rejected the companion credential (${response.status}).`,
        latencyMillis,
        identity: null,
      };
    }
    if (!response.ok) {
      return {
        transport: "UNREACHABLE",
        reasonCode: HANDSHAKE_REASON.UNREACHABLE,
        detail: `Handshake endpoint answered ${response.status}.`,
        latencyMillis,
        identity: null,
      };
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return {
        transport: "PROTOCOL_MISMATCH",
        reasonCode: HANDSHAKE_REASON.PROTOCOL_MISMATCH,
        detail: "Handshake response was not JSON.",
        latencyMillis,
        identity: null,
      };
    }

    const result = handshakeResponseSchema.safeParse(parsed);
    if (!result.success) {
      return {
        transport: "PROTOCOL_MISMATCH",
        reasonCode: HANDSHAKE_REASON.PROTOCOL_MISMATCH,
        detail: `Handshake response did not match the contract: ${result.error.issues[0]?.message ?? "invalid"}.`,
        latencyMillis,
        identity: null,
      };
    }

    return {
      transport: "OK",
      reasonCode: HANDSHAKE_REASON.OK,
      detail: "Handshake accepted.",
      latencyMillis,
      identity: result.data,
    };
  } catch (error) {
    return {
      transport: "UNREACHABLE",
      reasonCode: HANDSHAKE_REASON.UNREACHABLE,
      detail:
        (error as Error).name === "AbortError"
          ? "Handshake timed out."
          : `Engine unreachable: ${(error as Error).message}`,
      latencyMillis: Date.now() - startedAt,
      identity: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Mirroring (recovery after PM2 restart, reboot, refresh or network loss)
// ---------------------------------------------------------------------------

async function mirrorIdentity(
  client: AnyClient,
  userId: string,
  endpoint: RegisteredEndpoint,
  result: HandshakeResult,
  state: DashboardStateReport,
): Promise<void> {
  const identity = result.identity;
  const row: Record<string, unknown> = {
    user_id: userId,
    endpoint_id: endpoint.id,
    connection_state: state.state,
    reason_code: result.reasonCode,
    detail: result.detail,
    latency_millis: result.latencyMillis,
    observed_at: new Date().toISOString(),
  };

  if (identity) {
    Object.assign(row, {
      engine_id: identity.engineId,
      public_identifier: identity.publicIdentifier,
      environment: identity.environment,
      network: identity.network,
      engine_version: identity.engineVersion,
      platform_version: identity.platformVersion,
      api_version: identity.apiVersion,
      configuration_version: identity.configuration?.version ?? null,
      configuration_hash: identity.configuration?.configHash ?? null,
      snapshot_id: identity.configuration?.snapshotId ?? null,
      snapshot_hash: identity.configuration?.snapshotHash ?? null,
      current_market: identity.currentMarket ?? {},
      scheduler_status: identity.scheduler?.status ?? null,
      feed_status: identity.feed?.status ?? null,
      feed_provider: identity.feed?.provider ?? null,
      twap_feed: identity.feed?.twapFeed ?? null,
      health: identity.health,
      capabilities: identity.capabilities,
      started_at: identity.startedAtIso,
      uptime_seconds: identity.uptimeSeconds === null ? null : Math.floor(identity.uptimeSeconds),
      payload: identity,
    });
  }

  await client.from("engine_runtime_identity").upsert(row, { onConflict: "user_id,endpoint_id" });

  if (identity) {
    await client
      .from("engine_endpoints")
      .update({
        last_seen_at: new Date().toISOString(),
        engine_version: identity.engineVersion ?? endpoint.engineVersion,
        platform_version: identity.platformVersion ?? endpoint.platformVersion,
        api_version: identity.apiVersion ?? endpoint.apiVersion,
      })
      .eq("id", endpoint.id);
  }
}

async function loadMirror(
  client: AnyClient,
  endpointId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await client
    .from("engine_runtime_identity")
    .select("*")
    .eq("endpoint_id", endpointId)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

// ---------------------------------------------------------------------------
// Authoritative runtime view
// ---------------------------------------------------------------------------

export interface AuthorityRuntimeView {
  observedAtIso: string;
  syncIntervalMillis: number;
  endpoint: {
    registered: boolean;
    id: string | null;
    name: string | null;
    host: string | null;
    environment: string | null;
    apiVersion: string | null;
    publicIdentifier: string | null;
    handshakeEndpoint: string | null;
    healthEndpoint: string | null;
    lastSeenAtIso: string | null;
  };
  connection: {
    state: string;
    reasonCode: string;
    connected: boolean;
    transport: HandshakeTransport;
    detail: string;
    latencyMillis: number | null;
    live: boolean;
  };
  identity: {
    engineId: string | null;
    publicIdentifier: string | null;
    engineVersion: string | null;
    platformVersion: string | null;
    apiVersion: string | null;
    environment: string | null;
    network: string | null;
    startedAtIso: string | null;
    uptimeSeconds: number | null;
    capabilities: readonly string[];
  } | null;
  runtimeConfiguration: {
    version: number | null;
    configHash: string | null;
    snapshotId: string | null;
    snapshotHash: string | null;
    status: string | null;
    activatedAtIso: string | null;
  } | null;
  savedConfiguration: { version: number; configHash: string; status: string } | null;
  verification: ReturnType<typeof verifyRuntimeConfiguration>;
  market: {
    marketInstanceId: string | null;
    question: string | null;
    lifecycle: string | null;
    resolutionIso: string | null;
  } | null;
  scheduler: {
    status: string | null;
    tickIntervalMillis: number | null;
    lastTickIso: string | null;
  } | null;
  feed: {
    status: string | null;
    provider: string | null;
    twapFeed: string | null;
    lastObservationIso: string | null;
    ageMillis: number | null;
  } | null;
  health: { entries: HealthEntry[]; worst: string; live: boolean };
  lastSynchronizedIso: string | null;
}

/**
 * The single read the console performs on load and on every polling tick.
 * When the engine answers, everything is live. When it does not, the mirrored
 * identity from the last successful handshake is returned and clearly marked
 * as not live, so reconnect after a PM2 restart or refresh is automatic.
 */
export async function readAuthorityRuntime(
  client: AnyClient,
  userId: string,
  options: { canWrite: boolean },
): Promise<AuthorityRuntimeView> {
  const endpoint = await loadActiveEndpoint(client);
  const result = await performHandshake(endpoint);

  const [savedRow, mirror] = await Promise.all([
    client
      .from("configuration_versions")
      .select("version, config_hash, status")
      .eq("status", "ACTIVE")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((response: { data: Record<string, unknown> | null }) => response.data ?? null)
      .catch(() => null),
    endpoint ? loadMirror(client, endpoint.id) : Promise.resolve(null),
  ]);

  const latestVersionRow = await client
    .from("configuration_versions")
    .select("status")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then((response: { data: Record<string, unknown> | null }) => response.data ?? null)
    .catch(() => null);

  const live = result.transport === "OK" && result.identity !== null;
  const identity = result.identity;

  const runtimeConfiguration = live
    ? {
        version: identity?.configuration?.version ?? null,
        configHash: identity?.configuration?.configHash ?? null,
        snapshotId: identity?.configuration?.snapshotId ?? null,
        snapshotHash: identity?.configuration?.snapshotHash ?? null,
        status: identity?.configuration?.status ?? null,
        activatedAtIso: identity?.configuration?.activatedAtIso ?? null,
      }
    : mirror
      ? {
          version: (mirror["configuration_version"] as number | null) ?? null,
          configHash: (mirror["configuration_hash"] as string | null) ?? null,
          snapshotId: (mirror["snapshot_id"] as string | null) ?? null,
          snapshotHash: (mirror["snapshot_hash"] as string | null) ?? null,
          status: null,
          activatedAtIso: null,
        }
      : null;

  const saved = savedRow
    ? {
        version: savedRow["version"] as number,
        configHash: savedRow["config_hash"] as string,
        status: savedRow["status"] as string,
      }
    : null;

  const verification = verifyRuntimeConfiguration(
    saved ? { version: saved.version, configHash: saved.configHash } : null,
    runtimeConfiguration,
  );

  const state = deriveDashboardState({
    registered: endpoint !== null,
    transport: result.transport,
    latestVersionStatus:
      (latestVersionRow?.["status"] as
        "PENDING" | "ACTIVE" | "REJECTED" | "ARCHIVED" | "SUPERSEDED" | undefined) ?? null,
    drifted: verification.state === "DRIFT",
  });

  if (endpoint && options.canWrite) {
    // Best effort: a mirror write must never change what the operator is told.
    try {
      await mirrorIdentity(client, userId, endpoint, result, state);
    } catch {
      /* mirroring is advisory only */
    }
  }

  const reportedHealth = live
    ? (identity?.health ?? [])
    : ((mirror?.["health"] as HealthEntry[] | undefined) ?? []);
  const entries = mergeHealth(reportedHealth);

  return {
    observedAtIso: new Date().toISOString(),
    syncIntervalMillis: endpoint?.syncIntervalMillis ?? 5_000,
    endpoint: {
      registered: endpoint !== null,
      id: endpoint?.id ?? null,
      name: endpoint?.name ?? null,
      host: endpoint ? safeHost(endpoint.baseUrl) : null,
      environment: endpoint?.environment ?? null,
      apiVersion: endpoint?.apiVersion ?? null,
      publicIdentifier: endpoint?.publicIdentifier ?? null,
      handshakeEndpoint: endpoint?.handshakeEndpoint ?? null,
      healthEndpoint: endpoint?.healthEndpoint ?? null,
      lastSeenAtIso: endpoint?.lastSeenAtIso ?? null,
    },
    connection: {
      state: state.state,
      reasonCode: state.reasonCode,
      connected: state.connected,
      transport: result.transport,
      detail: result.detail,
      latencyMillis: result.latencyMillis,
      live,
    },
    identity: live
      ? {
          engineId: identity?.engineId ?? null,
          publicIdentifier: identity?.publicIdentifier ?? null,
          engineVersion: identity?.engineVersion ?? null,
          platformVersion: identity?.platformVersion ?? null,
          apiVersion: identity?.apiVersion ?? null,
          environment: identity?.environment ?? null,
          network: identity?.network ?? null,
          startedAtIso: identity?.startedAtIso ?? null,
          uptimeSeconds: identity?.uptimeSeconds ?? null,
          capabilities: identity?.capabilities ?? [],
        }
      : mirror
        ? {
            engineId: (mirror["engine_id"] as string | null) ?? null,
            publicIdentifier: (mirror["public_identifier"] as string | null) ?? null,
            engineVersion: (mirror["engine_version"] as string | null) ?? null,
            platformVersion: (mirror["platform_version"] as string | null) ?? null,
            apiVersion: (mirror["api_version"] as string | null) ?? null,
            environment: (mirror["environment"] as string | null) ?? null,
            network: (mirror["network"] as string | null) ?? null,
            startedAtIso: (mirror["started_at"] as string | null) ?? null,
            uptimeSeconds: (mirror["uptime_seconds"] as number | null) ?? null,
            capabilities: (mirror["capabilities"] as string[] | null) ?? [],
          }
        : null,
    runtimeConfiguration,
    savedConfiguration: saved,
    verification,
    market: live
      ? (identity?.currentMarket ?? null)
      : ((mirror?.["current_market"] as AuthorityRuntimeView["market"]) ?? null),
    scheduler: live
      ? (identity?.scheduler ?? null)
      : mirror
        ? {
            status: (mirror["scheduler_status"] as string | null) ?? null,
            tickIntervalMillis: null,
            lastTickIso: null,
          }
        : null,
    feed: live
      ? (identity?.feed ?? null)
      : mirror
        ? {
            status: (mirror["feed_status"] as string | null) ?? null,
            provider: (mirror["feed_provider"] as string | null) ?? null,
            twapFeed: (mirror["twap_feed"] as string | null) ?? null,
            lastObservationIso: null,
            ageMillis: null,
          }
        : null,
    health: { entries, worst: worstHealth(entries), live },
    lastSynchronizedIso: live
      ? new Date().toISOString()
      : ((mirror?.["observed_at"] as string | null) ?? null),
  };
}

function safeHost(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}
