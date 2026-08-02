/**
 * ARC — authority registry persistence (M7.5).
 *
 * Server-only by filename. Stores the *public identity* of registered VPS
 * trading authorities so the console can show what is allowed to trade and
 * when it was last seen. Private keys, wallet keys and exchange credentials
 * are rejected at this boundary and by a database trigger.
 */
import {
  deriveAuthorityStatus,
  parseAuthorityRegistration,
  type AuthorityStatusView,
} from "@/core/platform/authority-registration";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

function toView(row: Record<string, unknown>, nowMillis: number): AuthorityStatusView {
  const lastSeen = (row["last_seen"] as string | null) ?? null;
  const capabilities = Array.isArray(row["capabilities"])
    ? (row["capabilities"] as string[])
    : [];
  return {
    authorityId: String(row["authority_id"] ?? ""),
    name: String(row["name"] ?? ""),
    environment: (row["environment"] as AuthorityStatusView["environment"]) ?? "testnet",
    status: deriveAuthorityStatus(
      (row["status"] as AuthorityStatusView["status"]) ?? "registered",
      lastSeen,
      nowMillis,
    ),
    engineVersion: (row["engine_version"] as string | null) ?? null,
    platformVersion: (row["platform_version"] as string | null) ?? null,
    version: (row["version"] as string | null) ?? null,
    capabilities,
    registeredAt: (row["registered_at"] as string | null) ?? null,
    lastSeen,
  };
}

/** Lists the registered authorities visible to the calling operator. */
export async function listAuthorities(
  client: AnyClient,
  nowMillis = Date.now(),
): Promise<AuthorityStatusView[]> {
  const { data, error } = await client
    .from("authority_registry")
    .select("*")
    .order("registered_at", { ascending: false });
  if (error) throw new Error(`authority registry read failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => toView(row, nowMillis));
}

/**
 * Records (or refreshes) an authority's public identity. Signature
 * verification happens before this call, against a key held in the server
 * environment — never in the database and never in the browser.
 */
export async function upsertAuthority(
  client: AnyClient,
  userId: string,
  input: unknown,
  nowMillis = Date.now(),
): Promise<AuthorityStatusView> {
  const registration = parseAuthorityRegistration(input);

  const row = {
    user_id: userId,
    authority_id: registration.authorityId,
    name: registration.name,
    environment: registration.environment,
    engine_version: registration.engineVersion,
    platform_version: registration.platformVersion,
    version: registration.version ?? registration.engineVersion,
    capabilities: registration.capabilities,
    public_key: registration.publicKey ?? null,
    status: "registered",
    last_seen: new Date(nowMillis).toISOString(),
  };

  const { data, error } = await client
    .from("authority_registry")
    .upsert(row, { onConflict: "user_id,authority_id" })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`authority registration failed: ${error.message}`);
  if (!data) throw new Error("authority registration failed: no row returned");

  await client.from("audit_log").insert({
    user_id: userId,
    action: "authority.registered",
    entity: "authority_registry",
    entity_id: registration.authorityId,
    metadata: {
      environment: registration.environment,
      engineVersion: registration.engineVersion,
      capabilities: registration.capabilities,
    },
  });

  return toView(data as Record<string, unknown>, nowMillis);
}

/** Marks an authority revoked. Historical rows and audit trail are preserved. */
export async function revokeAuthority(
  client: AnyClient,
  userId: string,
  authorityId: string,
): Promise<void> {
  const { error } = await client
    .from("authority_registry")
    .update({ status: "revoked" })
    .eq("authority_id", authorityId);
  if (error) throw new Error(`authority revocation failed: ${error.message}`);

  await client.from("audit_log").insert({
    user_id: userId,
    action: "authority.revoked",
    entity: "authority_registry",
    entity_id: authorityId,
    metadata: {},
  });
}
