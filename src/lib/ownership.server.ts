/**
 * ARC — operator ownership migration (M7.2), server-only by filename.
 *
 * Ownership is never hardcoded and never derived from whichever account
 * happened to register first during development. The database holds a single
 * ownership record; this module exposes the read, the explicit transfer and the
 * finalization that permanently closes public registration.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

export interface OwnershipState {
  readonly ownerUserId: string | null;
  readonly ownerEmail: string | null;
  readonly finalized: boolean;
  readonly finalizedAtIso: string | null;
  readonly isCallerOwner: boolean;
  /** Migration surface is only reachable while ownership is unfinalized. */
  readonly migrationAvailable: boolean;
}

export async function readOwnershipState(client: AnyClient): Promise<OwnershipState> {
  const { data, error } = await client.rpc("ownership_state");
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        owner_user_id: string | null;
        owner_email: string | null;
        finalized: boolean;
        finalized_at: string | null;
        is_caller_owner: boolean;
      }
    | undefined;
  const finalized = row?.finalized === true;
  return {
    ownerUserId: row?.owner_user_id ?? null,
    ownerEmail: row?.owner_email ?? null,
    finalized,
    finalizedAtIso: row?.finalized_at ?? null,
    isCallerOwner: row?.is_caller_owner === true,
    migrationAvailable: !finalized,
  };
}

/** Revokes every refresh token of a user through the Auth Admin API. */
async function revokeSessions(userId: string): Promise<boolean> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return false;
  const response = await fetch(`${url}/auth/v1/admin/users/${userId}/logout`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "global" }),
  });
  return response.ok;
}

export interface TransferResult {
  readonly state: OwnershipState;
  readonly previousOwnerUserId: string | null;
  readonly sessionsRevoked: boolean;
}

/**
 * Transfers ownership to an already-registered account, identified dynamically
 * by email. The database function enforces authorization and audit logging.
 */
export async function transferOwnership(
  client: AnyClient,
  targetEmail: string,
): Promise<TransferResult> {
  const before = await readOwnershipState(client);
  if (before.finalized) {
    throw new Error("Ownership is finalized. Migration is disabled in production.");
  }

  const { data, error } = await client.rpc("transfer_ownership", { _target_email: targetEmail });
  if (error) throw new Error(error.message);

  const newOwner = typeof data === "string" ? data : null;
  const previousOwnerUserId = before.ownerUserId;
  const sessionsRevoked =
    previousOwnerUserId && previousOwnerUserId !== newOwner
      ? await revokeSessions(previousOwnerUserId)
      : false;

  return { state: await readOwnershipState(client), previousOwnerUserId, sessionsRevoked };
}

/** Locks ownership to the current owner and closes public registration. */
export async function finalizeOwnership(client: AnyClient): Promise<OwnershipState> {
  const { error } = await client.rpc("finalize_ownership");
  if (error) throw new Error(error.message);
  return readOwnershipState(client);
}
