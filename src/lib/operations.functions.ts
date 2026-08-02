/**
 * ARC — Operations Platform read/config API (M5).
 *
 * Authenticated server functions backing the operator platform. Reads are
 * projections over canonical events and companion-owned tables; writes only
 * ever touch companion configuration (execution profile, notification
 * acknowledgement). No trading action exists here by charter (ADR-0001).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BUFFER_MODES,
  EXECUTION_MODES,
  LIMIT_MODES,
  TICK_POLICIES,
  TRIGGER_MODES,
} from "@/core/decision/configuration";
import { WINDOW_OFFSET_UNITS } from "@/core/decision/types";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const PROFILE_ROW_NAME = "arc-execution-profile";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

async function loadEvents(client: AnyClient, userId: string, limit: number) {
  const { SupabaseEventStore } = await import("@/core/platform/supabase-platform.server");
  return new SupabaseEventStore(client, userId).query({ limit });
}

// ---------------------------------------------------------------------------
// Operator snapshot — dashboard, markets, windows, signal tank, trade monitor
// ---------------------------------------------------------------------------

const snapshotInput = z.object({ limit: z.number().int().min(1).max(1000).default(400) }).default({
  limit: 400,
});

export const getOperationsSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => snapshotInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { projectOperations } = await import("@/core/platform/operations-view");
    const client = context.supabase as AnyClient;

    const [events, endpoints, notifications, snapshot] = await Promise.all([
      loadEvents(client, context.userId, data.limit).catch(() => []),
      client
        .from("engine_endpoints")
        .select("id, name, base_url, environment, is_active, last_seen_at")
        .order("created_at", { ascending: true }),
      client
        .from("notifications")
        .select("id, title, severity, created_at, read_at")
        .order("created_at", { ascending: false })
        .limit(20),
      client
        .from("engine_snapshots")
        .select("id, engine_state, mode, captured_at")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      projection: projectOperations(events),
      endpoints: (endpoints.data ?? []) as JsonValue[],
      notifications: (notifications.data ?? []) as JsonValue[],
      engineSnapshot: (snapshot.data ?? null) as JsonValue,
      observedAtIso: new Date().toISOString(),
    };
  });

// ---------------------------------------------------------------------------
// Execution profile configuration
// ---------------------------------------------------------------------------

const windowInput = z.object({
  offset: z.number().finite().positive(),
  unit: z.enum(WINDOW_OFFSET_UNITS),
  enabled: z.boolean(),
  twapBuffer: z.number().finite().nonnegative(),
  positionSizeOverride: z.number().finite().positive().nullable(),
  retryCountOverride: z.number().int().nonnegative().nullable(),
  timeoutMillisOverride: z.number().int().positive().nullable(),
  maxSpreadOverride: z.number().finite().nonnegative().nullable(),
});

const profileInput = z.object({
  executionProfileId: z.string().min(1),
  executionMode: z.enum(EXECUTION_MODES),
  maxTrades: z.number().int().positive(),
  triggerMode: z.enum(TRIGGER_MODES),
  limitMode: z.enum(LIMIT_MODES),
  compounding: z.boolean(),
  positionSize: z.number().finite().positive(),
  retryCount: z.number().int().nonnegative(),
  minLiquidity: z.number().finite().nonnegative(),
  maxSpread: z.number().finite().nonnegative(),
  repricingEnabled: z.boolean(),
  repricingIntervalMillis: z.number().int().positive(),
  repricingMaxAttempts: z.number().int().nonnegative(),
  timeoutMillis: z.number().int().positive(),
  tickPolicy: z.enum(TICK_POLICIES),
  tickSize: z.number().finite().positive(),
  bufferMode: z.enum(BUFFER_MODES),
  windowActiveMillis: z.number().int().positive(),
  precision: z.number().int().nonnegative().max(12),
  windows: z.array(windowInput).min(1),
});

export const getExecutionProfileConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadExecutionProfile, parseExecutionProfileOrThrow, executionProfileDigest } =
      await import("@/core/decision/configuration");
    const client = context.supabase as AnyClient;

    const { data } = await client
      .from("configuration_profiles")
      .select("id, name, description, config, updated_at")
      .eq("name", PROFILE_ROW_NAME)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const stored = (data?.config as { executionProfile?: unknown } | null)?.executionProfile;

    // Unconfigured is a legitimate operator state, not an error: the console
    // must offer profile creation instead of failing the page.
    let profile: ReturnType<typeof parseExecutionProfileOrThrow> | null = null;
    let invalidReason: string | null = null;
    try {
      profile = stored
        ? parseExecutionProfileOrThrow(stored)
        : loadExecutionProfile(process.env as Record<string, string | undefined>);
    } catch (error) {
      profile = null;
      invalidReason = stored ? (error as Error).message : null;
    }

    return {
      profile,
      digest: profile ? executionProfileDigest(profile) : null,
      source: profile
        ? stored
          ? ("STORED" as const)
          : ("ENVIRONMENT" as const)
        : ("NONE" as const),
      unconfigured: profile === null,
      invalidReason,
      updatedAtIso: (data?.updated_at as string | undefined) ?? null,
    };
  });

export const saveExecutionProfileConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => profileInput.parse(input))
  .handler(async ({ data, context }) => {
    const { parseExecutionProfileOrThrow, executionProfileDigest } =
      await import("@/core/decision/configuration");
    const profile = parseExecutionProfileOrThrow(data);
    const client = context.supabase as AnyClient;

    const { data: existing } = await client
      .from("configuration_profiles")
      .select("id")
      .eq("name", PROFILE_ROW_NAME)
      .maybeSingle();

    const payload = {
      user_id: context.userId,
      name: PROFILE_ROW_NAME,
      description: "ARC execution profile — dynamic multi-window TWAP configuration",
      config: { executionProfile: profile } as JsonValue,
      is_default: true,
    };

    const result = existing?.id
      ? await client.from("configuration_profiles").update(payload).eq("id", existing.id)
      : await client.from("configuration_profiles").insert(payload);
    if (result.error) throw new Error(`execution profile not saved: ${result.error.message}`);

    await client.from("audit_log").insert({
      user_id: context.userId,
      action: "configuration.execution_profile.updated",
      entity: "execution_profile",
      entity_id: profile.executionProfileId,
      metadata: {
        executionMode: profile.executionMode,
        windows: profile.windows.length,
        digest: executionProfileDigest(profile),
      },
    });

    return { profile, digest: executionProfileDigest(profile) };
  });

// ---------------------------------------------------------------------------
// Configuration surface: feature flags, endpoints, environment
// ---------------------------------------------------------------------------

export const getConfigurationView = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = context.supabase as AnyClient;
    const [flags, endpoints, profiles] = await Promise.all([
      client.from("feature_flags").select("key, enabled, description").order("key"),
      client
        .from("engine_endpoints")
        .select("id, name, base_url, environment, is_active, last_seen_at")
        .order("created_at", { ascending: true }),
      client
        .from("configuration_profiles")
        .select("id, name, description, is_default, updated_at")
        .order("updated_at", { ascending: false }),
    ]);

    const { RISK_PROFILE_VERSION, BUFFER_PROFILE_VERSION, EXECUTION_PROFILE_VERSION } =
      await import("@/core/decision/configuration");

    return {
      featureFlags: (flags.data ?? []) as JsonValue[],
      endpoints: (endpoints.data ?? []) as JsonValue[],
      profiles: (profiles.data ?? []) as JsonValue[],
      environment: process.env["ARC_ENVIRONMENT"] ?? "development",
      network: process.env["ARC_NETWORK"] ?? "testnet",
      feedProvider: process.env["ARC_FEED_PROVIDER"] ?? "unconfigured",
      feedId: process.env["ARC_FEED_ID"] ?? "unconfigured",
      versions: {
        executionProfile: EXECUTION_PROFILE_VERSION,
        bufferProfile: BUFFER_PROFILE_VERSION,
        riskProfile: RISK_PROFILE_VERSION,
      },
    };
  });

// ---------------------------------------------------------------------------
// System, health, notifications, audit
// ---------------------------------------------------------------------------

export const getSystemInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { VERSION_REGISTRY } = await import("@/core/contracts/versions");
    const { resolveOperatorBootstrapState } = await import("@/lib/auth-state.server");
    const { probeBackend } = await import("@/lib/supabase/backend.server");
    const [authentication, backend] = await Promise.all([
      resolveOperatorBootstrapState(),
      probeBackend(),
    ]);
    return {
      versions: Object.values(VERSION_REGISTRY).map((spec) => ({
        id: spec.id,
        version: spec.version,
        description: spec.description,
        compatible: [...spec.compatible],
      })),
      platformVersion: VERSION_REGISTRY.platform.version,
      engineVersion: VERSION_REGISTRY.engine.version,
      configurationVersion: VERSION_REGISTRY.configuration.version,
      replayVersion: VERSION_REGISTRY.replayFormat.version,
      eventSchemaVersion: VERSION_REGISTRY.eventSchema.version,
      environment: backend.environment,
      network: backend.network,
      runtime: "Edge worker (serverless control plane)",
      gitCommit: process.env["ARC_GIT_COMMIT"] ?? null,
      deployedAtIso: process.env["ARC_DEPLOYED_AT"] ?? null,
      buildIso: new Date().toISOString(),
      authentication,
      backend,
    };
  });

export const getHealthReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { projectOperations } = await import("@/core/platform/operations-view");
    const client = context.supabase as AnyClient;
    const startedAt = Date.now();

    const { resolveOperatorBootstrapState } = await import("@/lib/auth-state.server");
    const [events, endpoints, replay, authentication] = await Promise.all([
      loadEvents(client, context.userId, 200).catch(() => []),
      client.from("engine_endpoints").select("name, is_active, last_seen_at, environment"),
      client
        .from("replay_runs")
        .select("run_id, status, deterministic, completed_at")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      resolveOperatorBootstrapState(),
    ]);

    const projection = projectOperations(events);
    const latency = Date.now() - startedAt;
    const market = projection.activeMarket;
    const rows = (endpoints.data ?? []) as { is_active: boolean; last_seen_at: string | null }[];
    const vpsSeen = rows.some((row) => row.is_active && row.last_seen_at);

    const status = (ok: boolean, degraded = false) =>
      ok ? ("healthy" as const) : degraded ? ("degraded" as const) : ("unavailable" as const);

    return {
      observedAtIso: new Date().toISOString(),
      latencyMillis: latency,
      components: [
        {
          name: "Feed",
          status: status(market?.feedFresh === true, market !== null),
          detail:
            market?.feedAgeMillis !== null && market
              ? `age ${market.feedAgeMillis} ms`
              : "no observations",
        },
        {
          name: "TWAP",
          status: status(market?.twap !== null && market?.twap !== undefined, market !== null),
          detail: market?.twap !== null && market ? `twap ${market.twap}` : "insufficient data",
        },
        {
          name: "PTB",
          status: status(market?.ptbValid === true, market !== null),
          detail: market?.ptb !== null && market ? `ptb ${market.ptb}` : "unavailable",
        },
        {
          name: "Scheduler",
          status: status(projection.counts.total > 0, true),
          detail: `${projection.counts.total} events observed`,
        },
        {
          name: "Decision",
          status: status(projection.signals.length > 0, true),
          detail: `${projection.signals.length} evaluations`,
        },
        {
          name: "Risk",
          status: status(
            projection.executions.every((execution) => execution.riskVerdict !== "DENY"),
            true,
          ),
          detail: `${projection.executions.filter((e) => e.riskVerdict === "DENY").length} denials`,
        },
        {
          name: "Execution",
          status: status(projection.openOrders === 0, true),
          detail: `${projection.openOrders} open orders`,
        },
        {
          name: "Settlement",
          status: status(
            projection.executions.every((execution) => execution.failureReason === null),
            true,
          ),
          detail: `${projection.executions.filter((e) => e.settled).length} settled`,
        },
        {
          name: "Replay",
          status: status(replay.data?.deterministic === true, replay.data !== null),
          detail: (replay.data?.status as string | undefined) ?? "no runs",
        },
        {
          name: "Lovable Cloud",
          status: status(true),
          detail: `read latency ${latency} ms`,
        },
        {
          name: "Authentication",
          status: status(
            authentication.mode === "OWNER_FINALIZED" && authentication.backendMatchesProduction,
            authentication.resolved,
          ),
          detail: authentication.detail,
        },
        {
          name: "API",
          status: status(true),
          detail: "server functions responding",
        },
        {
          name: "VPS",
          status: status(vpsSeen, rows.length > 0),
          detail: rows.length === 0 ? "no endpoints registered" : `${rows.length} endpoint(s)`,
        },
        {
          name: "Notifications",
          status: status(true),
          detail: "delivery in-process",
        },
      ],
    };
  });

const notificationsInput = z
  .object({ limit: z.number().int().min(1).max(200).default(100) })
  .default({ limit: 100 });

export const listOperatorNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => notificationsInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const client = context.supabase as AnyClient;
    const { data: rows, error } = await client
      .from("notifications")
      .select("id, title, body, severity, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(`notifications unavailable: ${error.message}`);
    return { notifications: (rows ?? []) as JsonValue[] };
  });

export const acknowledgeNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const client = context.supabase as AnyClient;
    const { error } = await client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(`notification not acknowledged: ${error.message}`);
    return { id: data.id, acknowledged: true };
  });

export const listAuditRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const client = context.supabase as AnyClient;
    const { data, error } = await client
      .from("audit_log")
      .select("id, action, entity, entity_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`audit trail unavailable: ${error.message}`);
    return { records: (data ?? []) as JsonValue[] };
  });

// ---------------------------------------------------------------------------
// Operator status bar — global header state (environment, market, feed, VPS)
// ---------------------------------------------------------------------------

/**
 * Lightweight header projection. Read-only mirror of VPS-owned state: the
 * companion never derives market or feed authority (ADR-0001).
 */
export const getOperatorStatusBar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { projectOperations } = await import("@/core/platform/operations-view");
    const client = context.supabase as AnyClient;
    const startedAt = Date.now();

    const [events, endpoints] = await Promise.all([
      loadEvents(client, context.userId, 120).catch(() => []),
      client
        .from("engine_endpoints")
        .select("name, environment, is_active, last_seen_at")
        .order("created_at", { ascending: true }),
    ]);

    const latencyMillis = Date.now() - startedAt;
    const projection = projectOperations(events);
    const market = projection.activeMarket;
    const rows = (endpoints.data ?? []) as {
      name: string;
      environment: string | null;
      is_active: boolean;
      last_seen_at: string | null;
    }[];
    const active = rows.find((row) => row.is_active && row.last_seen_at) ?? rows[0] ?? null;
    const lastSeenAtIso = active?.last_seen_at ?? null;
    const lastSeenAgeMillis = lastSeenAtIso ? Date.now() - new Date(lastSeenAtIso).getTime() : null;

    return {
      environment: process.env["ARC_ENVIRONMENT"] ?? "development",
      network: (process.env["ARC_NETWORK"] ?? "testnet").toUpperCase(),
      market: market
        ? {
            question: market.question,
            venue: market.venue,
            lifecycle: market.lifecycle,
            resolutionIso: market.resolutionIso,
          }
        : null,
      feed: {
        fresh: market?.feedFresh ?? null,
        ageMillis: market?.feedAgeMillis ?? null,
      },
      vps: {
        registered: rows.length > 0,
        connected: Boolean(
          lastSeenAtIso && lastSeenAgeMillis !== null && lastSeenAgeMillis < 60_000,
        ),
        name: active?.name ?? null,
        endpointEnvironment: active?.environment ?? null,
        lastSeenAtIso,
        lastSeenAgeMillis,
        latencyMillis,
      },
      executionProfileId: market?.executionProfileId ?? null,
      observedAtIso: new Date().toISOString(),
    };
  });
