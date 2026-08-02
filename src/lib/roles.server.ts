/**
 * ARC — operator role resolution (M6.8).
 *
 * Server-only by filename. Runtime mutations (engine registration, activation,
 * configuration dispatch) require the operator or admin role; viewers keep
 * read-only access to every runtime surface.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

export interface OperatorCapabilities {
  readonly roles: readonly string[];
  readonly canWrite: boolean;
  readonly isAdmin: boolean;
  /** Primary operator of this single-operator deployment (M7.1). */
  readonly isOwner: boolean;
}

export async function resolveCapabilities(
  client: AnyClient,
  userId: string,
): Promise<OperatorCapabilities> {
  const { data } = await client.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((data ?? []) as { role: string }[]).map((row) => row.role);
  return {
    roles,
    isAdmin: roles.includes("admin") || roles.includes("owner"),
    isOwner: roles.includes("owner"),
    canWrite: roles.includes("admin") || roles.includes("owner") || roles.includes("operator"),
  };
}

/** Throws unless the caller may change runtime state. Viewers are read-only. */
export async function requireOperator(
  client: AnyClient,
  userId: string,
): Promise<OperatorCapabilities> {
  const capabilities = await resolveCapabilities(client, userId);
  if (!capabilities.canWrite) {
    throw new Error("Operator role required. Viewer accounts have read-only runtime access.");
  }
  return capabilities;
}
