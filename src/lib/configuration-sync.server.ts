/**
 * ARC — configuration synchronization runtime (M6.7).
 *
 * Server-only by filename. Implements the persistence + dispatch pipeline:
 *
 *   operator edit → immutable version → trading authority → verdict →
 *   runtime mirror → canonical events → console read-back
 *
 * The companion never decides what runs. It stores versions, asks the VPS, and
 * records exactly what the VPS answered (ADR-0001).
 */
import {
  ConfigurationEventFactory,
  configurationHash,
  detectConfigurationDrift,
  validateConfigurationForDispatch,
  type ConfigurationEventContext,
  type ConfigurationOrigin,
  type ConfigurationVersionStatus,
} from "@/core/platform/configuration-sync";
import { parseExecutionProfileOrThrow, type ExecutionProfile } from "@/core/decision/configuration";
import { VERSION_REGISTRY } from "@/core/contracts/versions";
import { digest128 } from "@/core/shared/ids";
import { systemClock } from "@/core/shared/time";

import {
  dispatchConfiguration,
  readActiveConfiguration,
  type AuthorityEndpoint,
} from "./configuration-authority.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

const PROFILE_NAME = "arc-execution-profile";

export interface ConfigurationVersionRecord {
  version: number;
  status: ConfigurationVersionStatus;
  configHash: string;
  executionProfileId: string;
  origin: string;
  reasonCode: string;
  rejectionReason: string | null;
  snapshotId: string | null;
  correlationId: string;
  createdAtIso: string;
  appliedAtIso: string | null;
}

export interface ConfigurationSyncResult {
  version: number | null;
  status: ConfigurationVersionStatus | "INVALID";
  outcome: "APPLIED" | "REJECTED" | "PENDING" | "INVALID";
  reasonCode: string;
  detail: string;
  configHash: string | null;
  snapshotId: string | null;
  issues: readonly { reasonCode: string; detail: string }[];
  correlationId: string;
  latencyMillis: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadEndpoint(client: AnyClient): Promise<AuthorityEndpoint | null> {
  const { data } = await client
    .from("engine_endpoints")
    .select("id, name, base_url, environment, is_active, last_seen_at")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.base_url) return null;
  return {
    id: (data.id as string) ?? null,
    name: (data.name as string) ?? null,
    baseUrl: data.base_url as string,
    environment: (data.environment as string) ?? null,
  };
}

async function appendEvents(
  client: AnyClient,
  userId: string,
  envelopes: readonly unknown[],
): Promise<void> {
  try {
    const { SupabaseEventStore } = await import("@/core/platform/supabase-platform.server");
    const store = new SupabaseEventStore(client, userId);
    for (const envelope of envelopes) {
      await store.append(envelope as never);
    }
  } catch {
    // Event mirroring is best-effort: a mirror failure must never make the
    // console claim a different runtime state than the authority reported.
  }
}

function toRecord(row: Record<string, unknown>): ConfigurationVersionRecord {
  return {
    version: row["version"] as number,
    status: row["status"] as ConfigurationVersionStatus,
    configHash: row["config_hash"] as string,
    executionProfileId: row["execution_profile_id"] as string,
    origin: row["origin"] as string,
    reasonCode: row["reason_code"] as string,
    rejectionReason: (row["rejection_reason"] as string | null) ?? null,
    snapshotId: (row["snapshot_id"] as string | null) ?? null,
    correlationId: row["correlation_id"] as string,
    createdAtIso: row["created_at"] as string,
    appliedAtIso: (row["applied_at"] as string | null) ?? null,
  };
}

const VERSION_COLUMNS =
  "version, status, config, config_hash, execution_profile_id, origin, reason_code, rejection_reason, snapshot_id, correlation_id, created_at, applied_at";

async function listVersionRows(client: AnyClient, limit = 50) {
  const { data } = await client
    .from("configuration_versions")
    .select(VERSION_COLUMNS)
    .eq("profile_name", PROFILE_NAME)
    .order("version", { ascending: false })
    .limit(limit);
  return (data ?? []) as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Publish / activate
// ---------------------------------------------------------------------------

export interface SyncRequest {
  candidate?: unknown;
  sourceVersion?: number;
  origin: ConfigurationOrigin;
}

export async function runConfigurationSync(
  client: AnyClient,
  userId: string,
  request: SyncRequest,
): Promise<ConfigurationSyncResult> {
  const events = new ConfigurationEventFactory(systemClock);
  const nowIso = new Date().toISOString();

  // 1. Resolve the configuration document ----------------------------------
  let profile: ExecutionProfile;
  if (request.sourceVersion !== undefined) {
    const { data } = await client
      .from("configuration_versions")
      .select("config")
      .eq("profile_name", PROFILE_NAME)
      .eq("version", request.sourceVersion)
      .maybeSingle();
    if (!data?.config) {
      return {
        version: null,
        status: "INVALID",
        outcome: "INVALID",
        reasonCode: "CFG_PROFILE_NOT_FOUND",
        detail: `Configuration version ${request.sourceVersion} does not exist.`,
        configHash: null,
        snapshotId: null,
        issues: [],
        correlationId: digest128(`missing:${request.sourceVersion}`),
        latencyMillis: null,
      };
    }
    profile = parseExecutionProfileOrThrow(data.config);
  } else {
    profile = parseExecutionProfileOrThrow(request.candidate);
  }

  const configHash = configurationHash(profile);
  const correlationId = digest128([configHash, request.origin, nowIso].join("\u0000"));

  // 2. Console-side pre-flight validation ----------------------------------
  const validation = validateConfigurationForDispatch(profile);
  if (!validation.valid) {
    return {
      version: null,
      status: "INVALID",
      outcome: "INVALID",
      reasonCode: validation.issues[0]?.reasonCode ?? "CFG_INVALID",
      detail: "Configuration rejected before dispatch — the trading authority was not contacted.",
      configHash,
      snapshotId: null,
      issues: validation.issues,
      correlationId,
      latencyMillis: null,
    };
  }

  // 3. Immutable version — reuse the identical hash instead of duplicating --
  const existingRows = await listVersionRows(client, 200);
  const identical = existingRows.find(
    (row) => row["config_hash"] === configHash && row["status"] !== "REJECTED",
  );
  const nextVersion =
    existingRows.reduce((max, row) => Math.max(max, (row["version"] as number) ?? 0), 0) + 1;
  const version = identical ? (identical["version"] as number) : nextVersion;

  if (!identical) {
    const { error } = await client.from("configuration_versions").insert({
      user_id: userId,
      created_by: userId,
      profile_name: PROFILE_NAME,
      execution_profile_id: profile.executionProfileId,
      version,
      config: profile,
      config_hash: configHash,
      status: "PENDING",
      origin: request.origin,
      reason_code: "CFG_VERSION_CREATED",
      correlation_id: correlationId,
      platform_version: VERSION_REGISTRY.platform.version,
    });
    if (error) throw new Error(`configuration version not stored: ${error.message}`);
  }

  const context: ConfigurationEventContext = {
    profileName: PROFILE_NAME,
    executionProfileId: profile.executionProfileId,
    version,
    configHash,
    snapshotId: null,
    operator: userId,
    origin: request.origin,
    correlationId,
  };

  await appendEvents(client, userId, [
    ...(identical ? [] : [events.build("ConfigurationVersionCreated", context)]),
    events.build("ConfigurationChanged", context),
  ]);

  // 4. The saved profile document (editing surface) ------------------------
  if (request.candidate !== undefined) {
    await saveProfileDocument(client, userId, profile);
  }

  // 5. Dispatch to the trading authority and wait for the verdict ----------
  const endpoint = await loadEndpoint(client);
  const { outcome, latencyMillis } = await dispatchConfiguration(endpoint, {
    profileName: PROFILE_NAME,
    executionProfileId: profile.executionProfileId,
    version,
    configHash,
    origin: request.origin,
    correlationId,
    requestedBy: userId,
    requestedAtIso: nowIso,
    configuration: profile,
  });

  const authority = outcome.authority;
  const snapshotId = authority?.snapshotId ?? null;
  const appliedContext: ConfigurationEventContext = { ...context, snapshotId };

  if (outcome.kind === "APPLIED") {
    await client
      .from("configuration_versions")
      .update({
        status: "SUPERSEDED",
        reason_code: "CFG_ARCHIVED",
      })
      .eq("profile_name", PROFILE_NAME)
      .eq("status", "ACTIVE")
      .neq("version", version);

    await client
      .from("configuration_versions")
      .update({
        status: "ACTIVE",
        reason_code: "CFG_APPLIED",
        rejection_reason: null,
        snapshot_id: snapshotId,
        applied_at: authority?.activatedAtIso ?? nowIso,
        engine_version: authority?.engineVersion ?? null,
        platform_version: authority?.platformVersion ?? VERSION_REGISTRY.platform.version,
      })
      .eq("profile_name", PROFILE_NAME)
      .eq("version", version);

    await upsertRuntimeMirror(client, userId, {
      endpointId: endpoint?.id ?? null,
      executionProfileId: profile.executionProfileId,
      version,
      snapshotId,
      configHash: authority?.configHash ?? configHash,
      runtimeStatus: authority?.runtimeStatus ?? "RUNNING",
      reasonCode: "CFG_APPLIED",
      activatedAtIso: authority?.activatedAtIso ?? nowIso,
      activatedBy: userId,
      engineVersion: authority?.engineVersion ?? null,
      platformVersion: authority?.platformVersion ?? VERSION_REGISTRY.platform.version,
      payload: authority ?? {},
    });

    await appendEvents(client, userId, [
      events.build("ConfigurationValidated", appliedContext),
      events.build("ConfigurationApplied", appliedContext),
      events.build("ConfigurationActivated", appliedContext),
      ...(request.origin === "ROLLBACK"
        ? [events.build("ConfigurationRolledBack", appliedContext)]
        : []),
    ]);
  } else if (outcome.kind === "REJECTED") {
    await client
      .from("configuration_versions")
      .update({
        status: "REJECTED",
        reason_code: outcome.reasonCode,
        rejection_reason: outcome.detail,
      })
      .eq("profile_name", PROFILE_NAME)
      .eq("version", version);

    await appendEvents(client, userId, [
      events.build(
        "ConfigurationRejected",
        appliedContext,
        { authorityReason: outcome.reasonCode, detail: outcome.detail },
        "CFG_REJECTED",
      ),
    ]);
  }

  await client.from("audit_log").insert({
    user_id: userId,
    action: `configuration.${request.origin.toLowerCase()}.${outcome.kind.toLowerCase()}`,
    entity: "configuration_version",
    entity_id: String(version),
    metadata: {
      configHash,
      reasonCode: outcome.reasonCode,
      detail: outcome.detail,
      snapshotId,
      correlationId,
    },
  });

  return {
    version,
    status: outcome.status,
    outcome:
      outcome.kind === "APPLIED" ? "APPLIED" : outcome.kind === "REJECTED" ? "REJECTED" : "PENDING",
    reasonCode: outcome.reasonCode,
    detail: outcome.detail,
    configHash,
    snapshotId,
    issues: [],
    correlationId,
    latencyMillis,
  };
}

async function saveProfileDocument(
  client: AnyClient,
  userId: string,
  profile: ExecutionProfile,
): Promise<void> {
  const { data: existing } = await client
    .from("configuration_profiles")
    .select("id")
    .eq("name", PROFILE_NAME)
    .maybeSingle();

  const payload = {
    user_id: userId,
    name: PROFILE_NAME,
    description: "ARC execution profile — dynamic multi-window TWAP configuration",
    config: { executionProfile: profile },
    is_default: true,
  };

  const result = existing?.id
    ? await client.from("configuration_profiles").update(payload).eq("id", existing.id)
    : await client.from("configuration_profiles").insert(payload);
  if (result.error) throw new Error(`execution profile not saved: ${result.error.message}`);
}

interface RuntimeMirrorInput {
  endpointId: string | null;
  executionProfileId: string | null;
  version: number | null;
  snapshotId: string | null;
  configHash: string | null;
  runtimeStatus: string;
  reasonCode: string;
  activatedAtIso: string | null;
  activatedBy: string | null;
  engineVersion: string | null;
  platformVersion: string | null;
  payload: unknown;
}

async function upsertRuntimeMirror(
  client: AnyClient,
  userId: string,
  input: RuntimeMirrorInput,
): Promise<void> {
  const row = {
    user_id: userId,
    profile_name: PROFILE_NAME,
    endpoint_id: input.endpointId,
    execution_profile_id: input.executionProfileId,
    version: input.version,
    snapshot_id: input.snapshotId,
    config_hash: input.configHash,
    runtime_status: input.runtimeStatus,
    reason_code: input.reasonCode,
    activated_at: input.activatedAtIso,
    activated_by: input.activatedBy,
    engine_version: input.engineVersion,
    platform_version: input.platformVersion,
    last_synced_at: new Date().toISOString(),
    payload: input.payload ?? {},
  };
  await client
    .from("runtime_configuration_state")
    .upsert(row, { onConflict: "user_id,profile_name" });
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export async function archiveVersion(
  client: AnyClient,
  userId: string,
  version: number,
): Promise<{ version: number; status: ConfigurationVersionStatus; reasonCode: string }> {
  const { data } = await client
    .from("configuration_versions")
    .select("version, status, config_hash, execution_profile_id, correlation_id")
    .eq("profile_name", PROFILE_NAME)
    .eq("version", version)
    .maybeSingle();
  if (!data) throw new Error(`configuration version ${version} does not exist`);
  if (data.status === "ACTIVE") {
    throw new Error(
      "the running configuration cannot be archived — activate another version first",
    );
  }

  await client
    .from("configuration_versions")
    .update({ status: "ARCHIVED", reason_code: "CFG_ARCHIVED" })
    .eq("profile_name", PROFILE_NAME)
    .eq("version", version);

  const events = new ConfigurationEventFactory(systemClock);
  await appendEvents(client, userId, [
    events.build("ConfigurationArchived", {
      profileName: PROFILE_NAME,
      executionProfileId: data.execution_profile_id as string,
      version,
      configHash: data.config_hash as string,
      snapshotId: null,
      operator: userId,
      origin: "ARCHIVE",
      correlationId: data.correlation_id as string,
    }),
  ]);

  await client.from("audit_log").insert({
    user_id: userId,
    action: "configuration.archive.applied",
    entity: "configuration_version",
    entity_id: String(version),
    metadata: { configHash: data.config_hash },
  });

  return { version, status: "ARCHIVED", reasonCode: "CFG_ARCHIVED" };
}

// ---------------------------------------------------------------------------
// Runtime read-back
// ---------------------------------------------------------------------------

export async function readRuntimeView(client: AnyClient, userId: string) {
  const endpoint = await loadEndpoint(client);
  const [rows, mirrorResult, authorityRead] = await Promise.all([
    listVersionRows(client, 50),
    client
      .from("runtime_configuration_state")
      .select("*")
      .eq("profile_name", PROFILE_NAME)
      .maybeSingle(),
    readActiveConfiguration(endpoint),
  ]);

  const versions = rows.map(toRecord);
  const mirrorRow = (mirrorResult?.data ?? null) as Record<string, unknown> | null;
  const reply = authorityRead.reply;

  // The authority is the source of truth: refresh the mirror whenever it
  // answers, so a PM2 restart or reconnect immediately re-syncs the console.
  if (reply && reply.snapshotId) {
    const matched = versions.find((item) => item.configHash === reply.configHash) ?? null;
    if (
      mirrorRow?.["snapshot_id"] !== reply.snapshotId ||
      mirrorRow?.["config_hash"] !== reply.configHash ||
      mirrorRow?.["runtime_status"] !== reply.runtimeStatus
    ) {
      await upsertRuntimeMirror(client, userId, {
        endpointId: endpoint?.id ?? null,
        executionProfileId: reply.executionProfileId ?? matched?.executionProfileId ?? null,
        version: reply.version ?? matched?.version ?? null,
        snapshotId: reply.snapshotId,
        configHash: reply.configHash,
        runtimeStatus: reply.runtimeStatus,
        reasonCode: "CFG_RUNTIME_SYNCED",
        activatedAtIso: reply.activatedAtIso,
        activatedBy: (mirrorRow?.["activated_by"] as string | null) ?? null,
        engineVersion: reply.engineVersion,
        platformVersion: reply.platformVersion,
        payload: reply,
      });
    }
  }

  const runtime = reply?.snapshotId
    ? {
        version: reply.version ?? null,
        configHash: reply.configHash,
        snapshotId: reply.snapshotId,
        runtimeStatus: reply.runtimeStatus,
        executionProfileId: reply.executionProfileId,
        activatedAtIso: reply.activatedAtIso,
        activatedBy: (mirrorRow?.["activated_by"] as string | null) ?? reply.activatedBy,
        engineVersion: reply.engineVersion,
        platformVersion: reply.platformVersion,
        lastSyncedAtIso: new Date().toISOString(),
        live: true as const,
      }
    : mirrorRow
      ? {
          version: (mirrorRow["version"] as number | null) ?? null,
          configHash: (mirrorRow["config_hash"] as string | null) ?? null,
          snapshotId: (mirrorRow["snapshot_id"] as string | null) ?? null,
          runtimeStatus: (mirrorRow["runtime_status"] as string) ?? "UNKNOWN",
          executionProfileId: (mirrorRow["execution_profile_id"] as string | null) ?? null,
          activatedAtIso: (mirrorRow["activated_at"] as string | null) ?? null,
          activatedBy: (mirrorRow["activated_by"] as string | null) ?? null,
          engineVersion: (mirrorRow["engine_version"] as string | null) ?? null,
          platformVersion: (mirrorRow["platform_version"] as string | null) ?? null,
          lastSyncedAtIso: (mirrorRow["last_synced_at"] as string | null) ?? null,
          live: false as const,
        }
      : null;

  const latestActive = versions.find((item) => item.status === "ACTIVE") ?? null;
  const pending = versions.filter((item) => item.status === "PENDING");
  const drift = detectConfigurationDrift(
    runtime
      ? { version: runtime.version, configHash: runtime.configHash, snapshotId: runtime.snapshotId }
      : null,
    latestActive ? { version: latestActive.version, configHash: latestActive.configHash } : null,
  );

  return {
    profileName: PROFILE_NAME,
    versions,
    latestActive,
    pending,
    runtime,
    drift,
    authority: {
      registered: endpoint !== null,
      name: endpoint?.name ?? null,
      baseUrlHost: endpoint ? safeHost(endpoint.baseUrl) : null,
      environment: endpoint?.environment ?? null,
      reachable: reply !== null,
      detail: authorityRead.detail,
      latencyMillis: authorityRead.latencyMillis,
    },
    versions_platform: VERSION_REGISTRY.platform.version,
    engineVersionExpected: VERSION_REGISTRY.engine.version,
    observedAtIso: new Date().toISOString(),
  };
}

function safeHost(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}
