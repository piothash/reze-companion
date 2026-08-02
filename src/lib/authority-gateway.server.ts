/**
 * ARC — VPS authority gateway (M7.6).
 *
 * Server-only by filename. This is the control-plane side of the handshake:
 * it authenticates messages that arrive from the VPS trading engine, records
 * its public identity and liveness, hands back the configuration version the
 * engine should be running, and records the engine's verdict on it.
 *
 * Boundaries this module enforces (ADR-0001):
 *   • The engine is the only trading authority — nothing here decides trades.
 *   • The engine cannot assert its own registry status; the companion derives
 *     liveness from heartbeats it verified itself.
 *   • No configuration becomes active without an explicit engine verdict.
 *   • Wallet keys, exchange credentials and execution secrets are never
 *     accepted, stored or echoed.
 */
import {
  authorityHeartbeatSchema,
  deriveAuthorityLiveness,
  parseAuthorityRegistration,
  type AuthorityStatus,
} from "@/core/platform/authority-registration";
import {
  AUTHORITY_REPLAY_WINDOW_MILLIS,
  verifyAuthorityMessage,
  type AuthorityVerificationResult,
} from "@/core/platform/authority-signature";
import { recordOperatorAudit } from "./audit-trail.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

export interface GatewayResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export function gatewayError(status: number, reasonCode: string, detail: string): GatewayResponse {
  return { status, body: { accepted: false, reasonCode, detail } };
}

/** The shared authority key. Read at call time; never logged, never returned. */
function signingKey(): string | undefined {
  const key = process.env["ARC_AUTHORITY_SIGNING_KEY"];
  return key && key.trim().length >= 16 ? key.trim() : undefined;
}

/** Owner of the control plane — authority rows belong to the operator. */
async function resolveOwner(client: AnyClient): Promise<string | null> {
  const { data } = await client
    .from("operator_ownership")
    .select("owner_user_id")
    .maybeSingle();
  return (data?.owner_user_id as string | null) ?? null;
}

async function recordNonce(
  client: AnyClient,
  authorityId: string,
  digest: string,
  timestamp: string,
  endpoint: string,
): Promise<boolean> {
  const { error } = await client.from("authority_replay_guard").insert({
    authority_id: authorityId,
    signature_digest: digest,
    message_timestamp: timestamp,
    endpoint,
  });
  // A unique-violation means the signature was already accepted: replay.
  return !error;
}

async function pruneNonces(client: AnyClient, nowMillis: number): Promise<void> {
  const cutoff = new Date(nowMillis - AUTHORITY_REPLAY_WINDOW_MILLIS).toISOString();
  await client.from("authority_replay_guard").delete().lt("seen_at", cutoff);
}

async function verify(
  client: AnyClient,
  payload: Record<string, unknown>,
  endpoint: string,
  nowMillis: number,
): Promise<AuthorityVerificationResult> {
  return verifyAuthorityMessage({
    payload,
    signature: payload["signature"] as string | undefined,
    timestamp: payload["timestamp"] as string | undefined,
    key: signingKey(),
    nowMillis,
    seenBefore: async (digest) => {
      const { data } = await client
        .from("authority_replay_guard")
        .select("id")
        .eq("authority_id", String(payload["authorityId"] ?? ""))
        .eq("signature_digest", digest)
        .maybeSingle();
      return Boolean(data);
    },
  });
}

/** A verification failure maps to a stable HTTP status. */
function verificationStatus(result: AuthorityVerificationResult): number {
  if (result.reasonCode === "KEY_UNCONFIGURED") return 503;
  if (result.reasonCode === "SIGNATURE_REPLAYED") return 409;
  return 401;
}

async function auditGateway(
  client: AnyClient,
  userId: string | null,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!userId) return;
  await recordOperatorAudit(client, userId, {
    action,
    resource: "authority_registry",
    resourceId: entityId,
    // A refused handshake is an audit fact, not an absence of one.
    result: action.endsWith(".rejected") ? "REJECTED" : "SUCCESS",
    correlationId: typeof metadata["correlationId"] === "string" ? metadata["correlationId"] : null,
    detail: metadata,
  });
}

// ---------------------------------------------------------------------------
// POST /api/public/authority/register
// ---------------------------------------------------------------------------

export async function handleAuthorityRegistration(
  client: AnyClient,
  body: unknown,
  nowMillis = Date.now(),
): Promise<GatewayResponse> {
  let registration;
  try {
    registration = parseAuthorityRegistration(body);
  } catch (error) {
    return gatewayError(
      400,
      "AUTHORITY_REGISTRATION_INVALID",
      error instanceof Error ? error.message : "registration payload invalid",
    );
  }

  const verification = await verify(
    client,
    registration as unknown as Record<string, unknown>,
    "register",
    nowMillis,
  );
  if (!verification.ok) {
    return gatewayError(verificationStatus(verification), verification.reasonCode, verification.detail);
  }
  if (
    verification.signatureDigest &&
    !(await recordNonce(
      client,
      registration.authorityId,
      verification.signatureDigest,
      registration.timestamp,
      "register",
    ))
  ) {
    return gatewayError(409, "SIGNATURE_REPLAYED", "this signed registration was already accepted");
  }

  const ownerId = await resolveOwner(client);
  if (!ownerId) {
    return gatewayError(
      409,
      "OPERATOR_NOT_BOOTSTRAPPED",
      "The control plane has no operator yet. Complete operator bootstrap before registering a trading authority.",
    );
  }

  const nowIso = new Date(nowMillis).toISOString();
  const { data: existing } = await client
    .from("authority_registry")
    .select("registration_count, status")
    .eq("authority_id", registration.authorityId)
    .maybeSingle();

  const { data, error } = await client
    .from("authority_registry")
    .upsert(
      {
        user_id: ownerId,
        authority_id: registration.authorityId,
        name: registration.name,
        environment: registration.environment,
        engine_version: registration.engineVersion,
        platform_version: registration.platformVersion,
        version: registration.version ?? registration.engineVersion,
        capabilities: registration.capabilities,
        public_key: registration.publicKey ?? null,
        // A revoked authority stays revoked: re-registration never restores it.
        status: existing?.status === "revoked" ? "revoked" : "registered",
        registration_count: ((existing?.registration_count as number | undefined) ?? 0) + 1,
        last_registered_at: nowIso,
        runtime_status: "starting",
      },
      { onConflict: "user_id,authority_id" },
    )
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return gatewayError(
      500,
      "AUTHORITY_REGISTRATION_FAILED",
      error?.message ?? "registration could not be stored",
    );
  }

  if (data.status === "revoked") {
    return gatewayError(
      403,
      "AUTHORITY_REVOKED",
      "This authority was revoked by the operator. The engine must not claim active status.",
    );
  }

  await auditGateway(client, ownerId, "authority.registered", registration.authorityId, {
    environment: registration.environment,
    engineVersion: registration.engineVersion,
    registrationCount: data.registration_count,
  });
  await pruneNonces(client, nowMillis);

  return {
    status: 200,
    body: {
      accepted: true,
      reasonCode: "AUTHORITY_REGISTERED",
      authorityId: registration.authorityId,
      status: "registered",
      registeredAt: data.registered_at ?? nowIso,
      registrationCount: data.registration_count ?? 1,
      heartbeatIntervalMillis: data.heartbeat_interval_millis ?? 15_000,
      serverTime: nowIso,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/public/authority/heartbeat
// ---------------------------------------------------------------------------

export async function handleAuthorityHeartbeat(
  client: AnyClient,
  body: unknown,
  receivedAtMillis: number,
  nowMillis = Date.now(),
): Promise<GatewayResponse> {
  const parsed = authorityHeartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return gatewayError(400, "HEARTBEAT_INVALID", parsed.error.issues[0]?.message ?? "invalid heartbeat");
  }
  const heartbeat = parsed.data;

  const verification = await verify(
    client,
    heartbeat as unknown as Record<string, unknown>,
    "heartbeat",
    nowMillis,
  );
  if (!verification.ok) {
    return gatewayError(
      verificationStatus(verification),
      verification.reasonCode,
      verification.detail,
    );
  }
  if (
    verification.signatureDigest &&
    !(await recordNonce(
      client,
      heartbeat.authorityId,
      verification.signatureDigest,
      heartbeat.timestamp,
      "heartbeat",
    ))
  ) {
    return gatewayError(409, "SIGNATURE_REPLAYED", "this signed heartbeat was already accepted");
  }

  const { data: existing } = await client
    .from("authority_registry")
    .select("id, user_id, status, runtime_identity, event_sequence")
    .eq("authority_id", heartbeat.authorityId)
    .maybeSingle();

  if (!existing) {
    return gatewayError(
      404,
      "AUTHORITY_NOT_REGISTERED",
      "Unknown authority. Register before sending heartbeats.",
    );
  }
  if (existing.status === "revoked") {
    return gatewayError(
      403,
      "AUTHORITY_REVOKED",
      "This authority was revoked by the operator.",
    );
  }

  // A changed runtime identity means the engine restarted. That is recorded,
  // not rejected — but the event sequence must not go backwards silently.
  const restarted =
    Boolean(heartbeat.runtimeIdentity) &&
    Boolean(existing.runtime_identity) &&
    heartbeat.runtimeIdentity !== existing.runtime_identity;

  const nowIso = new Date(nowMillis).toISOString();
  const latency = Math.max(0, nowMillis - Date.parse(heartbeat.timestamp));

  const { error } = await client
    .from("authority_registry")
    .update({
      status: "registered",
      runtime_status: heartbeat.status,
      engine_version: heartbeat.engineVersion,
      platform_version: heartbeat.platformVersion,
      environment: heartbeat.environment,
      uptime_seconds: heartbeat.uptimeSeconds ?? null,
      active_market: heartbeat.activeMarket ?? null,
      active_windows: heartbeat.activeWindows ?? null,
      event_sequence: heartbeat.eventSequence ?? null,
      configuration_version: heartbeat.configurationVersion ?? null,
      runtime_identity: heartbeat.runtimeIdentity ?? existing.runtime_identity ?? null,
      heartbeat_interval_millis: heartbeat.heartbeatIntervalMillis ?? 15_000,
      latency_millis: Math.max(latency, Math.max(0, nowMillis - receivedAtMillis)),
      last_seen: nowIso,
    })
    .eq("id", existing.id);

  if (error) {
    return gatewayError(500, "HEARTBEAT_NOT_RECORDED", error.message);
  }

  if (restarted) {
    await auditGateway(client, existing.user_id as string, "authority.restarted", heartbeat.authorityId, {
      previousRuntimeIdentity: existing.runtime_identity,
      runtimeIdentity: heartbeat.runtimeIdentity,
      eventSequence: heartbeat.eventSequence ?? null,
    });
  }
  await pruneNonces(client, nowMillis);

  return {
    status: 200,
    body: {
      accepted: true,
      reasonCode: "HEARTBEAT_ACCEPTED",
      authorityId: heartbeat.authorityId,
      status: deriveAuthorityLiveness(
        "registered" as AuthorityStatus,
        nowIso,
        heartbeat.heartbeatIntervalMillis ?? 15_000,
        nowMillis,
      ),
      restartDetected: restarted,
      latencyMillis: latency,
      serverTime: nowIso,
    },
  };
}

// ---------------------------------------------------------------------------
// GET /api/public/authority/configuration  — pending version for the engine
// ---------------------------------------------------------------------------

export async function handleConfigurationPull(
  client: AnyClient,
  authorityId: string,
  nowMillis = Date.now(),
): Promise<GatewayResponse> {
  const { data: authority } = await client
    .from("authority_registry")
    .select("user_id, status")
    .eq("authority_id", authorityId)
    .maybeSingle();
  if (!authority) {
    return gatewayError(404, "AUTHORITY_NOT_REGISTERED", "Unknown authority.");
  }
  if (authority.status === "revoked") {
    return gatewayError(403, "AUTHORITY_REVOKED", "This authority was revoked by the operator.");
  }

  const { data } = await client
    .from("configuration_versions")
    .select("version, config, config_hash, execution_profile_id, correlation_id, status, created_at")
    .eq("user_id", authority.user_id)
    .in("status", ["PENDING", "MIRRORED"])
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return {
      status: 200,
      body: {
        pending: false,
        reasonCode: "CFG_NO_PENDING_VERSION",
        serverTime: new Date(nowMillis).toISOString(),
      },
    };
  }

  return {
    status: 200,
    body: {
      pending: true,
      reasonCode: "CFG_VERSION_AVAILABLE",
      version: data.version,
      configHash: data.config_hash,
      executionProfileId: data.execution_profile_id,
      correlationId: data.correlation_id,
      config: data.config,
      publishedAt: data.created_at,
      serverTime: new Date(nowMillis).toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/public/authority/configuration — engine verdict
// ---------------------------------------------------------------------------

export interface ConfigurationVerdictInput {
  readonly authorityId: string;
  readonly version: number;
  readonly configHash: string;
  readonly verdict: "ACCEPTED" | "REJECTED";
  readonly reasonCode?: string;
  readonly detail?: string;
  readonly snapshotId?: string | null;
  readonly timestamp: string;
  readonly signature: string;
}

export async function handleConfigurationVerdict(
  client: AnyClient,
  body: unknown,
  nowMillis = Date.now(),
): Promise<GatewayResponse> {
  const input = body as Partial<ConfigurationVerdictInput>;
  if (
    !input ||
    typeof input.authorityId !== "string" ||
    typeof input.version !== "number" ||
    typeof input.configHash !== "string" ||
    (input.verdict !== "ACCEPTED" && input.verdict !== "REJECTED")
  ) {
    return gatewayError(400, "CFG_VERDICT_INVALID", "verdict payload invalid");
  }

  const verification = await verify(
    client,
    input as unknown as Record<string, unknown>,
    "configuration-verdict",
    nowMillis,
  );
  if (!verification.ok) {
    return gatewayError(
      verificationStatus(verification),
      verification.reasonCode,
      verification.detail,
    );
  }
  if (
    verification.signatureDigest &&
    !(await recordNonce(
      client,
      input.authorityId,
      verification.signatureDigest,
      input.timestamp ?? new Date(nowMillis).toISOString(),
      "configuration-verdict",
    ))
  ) {
    return gatewayError(409, "SIGNATURE_REPLAYED", "this signed verdict was already accepted");
  }

  const { data: authority } = await client
    .from("authority_registry")
    .select("user_id, status, environment")
    .eq("authority_id", input.authorityId)
    .maybeSingle();
  if (!authority) return gatewayError(404, "AUTHORITY_NOT_REGISTERED", "Unknown authority.");
  if (authority.status === "revoked") {
    return gatewayError(403, "AUTHORITY_REVOKED", "This authority was revoked by the operator.");
  }

  const { data: version } = await client
    .from("configuration_versions")
    .select("id, version, config_hash, status, profile_name, execution_profile_id, correlation_id")
    .eq("user_id", authority.user_id)
    .eq("version", input.version)
    .maybeSingle();
  if (!version) {
    return gatewayError(404, "CFG_VERSION_NOT_FOUND", `configuration version ${input.version} not found`);
  }
  // Drift guard: the engine must have validated exactly what was published.
  if (version.config_hash !== input.configHash) {
    return gatewayError(
      409,
      "CFG_HASH_MISMATCH",
      "The verdict references a different configuration payload than the published version.",
    );
  }

  const nowIso = new Date(nowMillis).toISOString();
  const accepted = input.verdict === "ACCEPTED";

  const { error } = await client
    .from("configuration_versions")
    .update({
      status: accepted ? "ACTIVE" : "REJECTED",
      reason_code: input.reasonCode ?? (accepted ? "CFG_ACCEPTED" : "CFG_REJECTED"),
      rejection_reason: accepted ? null : (input.detail ?? "rejected by trading authority"),
      snapshot_id: accepted ? (input.snapshotId ?? null) : null,
      applied_at: accepted ? nowIso : null,
    })
    .eq("id", version.id);
  if (error) return gatewayError(500, "CFG_VERDICT_NOT_RECORDED", error.message);

  if (accepted) {
    await client
      .from("runtime_configuration_state")
      .upsert(
        {
          user_id: authority.user_id,
          profile_name: version.profile_name,
          execution_profile_id: version.execution_profile_id,
          version: input.version,
          snapshot_id: input.snapshotId ?? null,
          config_hash: input.configHash,
          runtime_status: "LIVE",
          reason_code: input.reasonCode ?? "CFG_ACCEPTED",
          activated_at: nowIso,
          last_synced_at: nowIso,
          payload: { authorityId: input.authorityId, correlationId: version.correlation_id },
        },
        { onConflict: "user_id,profile_name" },
      );
  }

  await auditGateway(
    client,
    authority.user_id as string,
    accepted ? "configuration.accepted" : "configuration.rejected",
    input.authorityId,
    { version: input.version, configHash: input.configHash, detail: input.detail ?? null },
  );

  return {
    status: 200,
    body: {
      accepted: true,
      reasonCode: accepted ? "CFG_ACTIVE" : "CFG_REJECTED",
      version: input.version,
      runtimeStatus: accepted ? "LIVE" : "REJECTED",
      serverTime: nowIso,
    },
  };
}
