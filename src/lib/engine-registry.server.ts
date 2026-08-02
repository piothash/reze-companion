/**
 * ARC — engine registration persistence (M6.8).
 *
 * Server-only by filename. Stores the public identity of the VPS trading
 * engines this control plane may talk to. Credentials are never accepted or
 * persisted here: the companion authenticates with a server-side bearer token
 * held in the runtime environment, never in the database or the browser.
 */
import {
  rejectsSecretMaterial,
  type EngineRegistration,
} from "@/core/platform/authority-handshake";

import { toEndpoint, type RegisteredEndpoint } from "./authority-handshake.server";
import { recordOperatorAudit } from "./audit-trail.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

function toRow(registration: EngineRegistration, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    name: registration.name.trim(),
    environment: registration.environment,
    base_url: registration.baseUrl.trim().replace(/\/+$/, ""),
    api_version: registration.apiVersion.trim(),
    engine_version: registration.engineVersion,
    platform_version: registration.platformVersion,
    health_endpoint: registration.healthEndpoint.trim(),
    handshake_endpoint: registration.handshakeEndpoint.trim(),
    public_identifier: registration.publicIdentifier,
    sync_interval_millis: registration.syncIntervalMillis,
    is_active: registration.isActive,
  };
}

async function audit(
  client: AnyClient,
  userId: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await recordOperatorAudit(client, userId, {
    action,
    resource: "engine_endpoint",
    resourceId: entityId,
    detail: metadata,
  });
}

/** Creates or updates a registration, enforcing a single active authority. */
export async function saveRegistration(
  client: AnyClient,
  userId: string,
  id: string | null,
  registration: EngineRegistration,
): Promise<RegisteredEndpoint> {
  const secretIssue = rejectsSecretMaterial(registration);
  if (secretIssue) throw new Error(secretIssue);

  const row = toRow(registration, userId);
  const result = id
    ? await client.from("engine_endpoints").update(row).eq("id", id).select("*").maybeSingle()
    : await client.from("engine_endpoints").insert(row).select("*").maybeSingle();

  if (result.error) throw new Error(`engine registration failed: ${result.error.message}`);
  if (!result.data) throw new Error("engine registration failed: no row returned");

  const saved = toEndpoint(result.data as Record<string, unknown>);
  if (saved.isActive) {
    await client.from("engine_endpoints").update({ is_active: false }).neq("id", saved.id);
  }

  await audit(client, userId, id ? "engine.registration.updated" : "engine.registration.created", saved.id, {
    name: saved.name,
    environment: saved.environment,
    host: saved.baseUrl,
    apiVersion: saved.apiVersion,
  });

  return saved;
}

/** Promotes one registration to the active trading authority. */
export async function activateRegistration(
  client: AnyClient,
  userId: string,
  id: string,
): Promise<{ id: string; activated: true }> {
  const { error } = await client.from("engine_endpoints").update({ is_active: true }).eq("id", id);
  if (error) throw new Error(`engine activation failed: ${error.message}`);
  await client.from("engine_endpoints").update({ is_active: false }).neq("id", id);
  await audit(client, userId, "engine.registration.activated", id, {});
  return { id, activated: true };
}

/** Removes a registration together with its mirrored runtime identity. */
export async function deleteRegistration(
  client: AnyClient,
  userId: string,
  id: string,
): Promise<{ id: string; deleted: true }> {
  await client.from("engine_runtime_identity").delete().eq("endpoint_id", id);
  const { error } = await client.from("engine_endpoints").delete().eq("id", id);
  if (error) throw new Error(`engine removal failed: ${error.message}`);
  await audit(client, userId, "engine.registration.deleted", id, {});
  return { id, deleted: true };
}
