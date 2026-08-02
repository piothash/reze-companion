/**
 * ARC — VPS trading authority registration contract (M7.5).
 *
 * Pure module. It defines the wire contract the VPS trading engine uses to
 * register itself with the control plane, plus the pure rules that derive an
 * authority's liveness status. Nothing here performs I/O and nothing here
 * decides what the engine trades: the VPS remains the sole trading authority
 * (ADR-0001) and the companion only records its public identity.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * Endpoints exposed by the VPS authority. The companion is always the caller
 * for status/telemetry; register and heartbeat are engine-initiated.
 */
export const AUTHORITY_ENDPOINTS = {
  register: { method: "POST", path: "/authority/register", initiatedBy: "vps" },
  heartbeat: { method: "POST", path: "/authority/heartbeat", initiatedBy: "vps" },
  status: { method: "GET", path: "/authority/status", initiatedBy: "companion" },
  telemetry: { method: "GET", path: "/authority/telemetry", initiatedBy: "companion" },
} as const;

export type AuthorityEndpointName = keyof typeof AUTHORITY_ENDPOINTS;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const AUTHORITY_ENVIRONMENTS = ["testnet", "mainnet", "local"] as const;
export type AuthorityEnvironment = (typeof AUTHORITY_ENVIRONMENTS)[number];

export const AUTHORITY_STATUSES = ["registered", "active", "stale", "revoked"] as const;
export type AuthorityStatus = (typeof AUTHORITY_STATUSES)[number];

export const AUTHORITY_CAPABILITIES = [
  "market-discovery",
  "feed-ingestion",
  "twap",
  "decision",
  "risk",
  "execution",
  "replay",
  "telemetry",
] as const;
export type AuthorityCapability = (typeof AUTHORITY_CAPABILITIES)[number];

/** An authority is considered stale once heartbeats stop for this long. */
export const AUTHORITY_STALE_AFTER_MILLIS = 90_000;

// ---------------------------------------------------------------------------
// Secret rejection
// ---------------------------------------------------------------------------

const SECRET_PATTERN =
  /(private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|secret|passphrase|mnemonic|api[_-]?key|0x[a-fA-F0-9]{64})/i;

/**
 * The control plane stores public identity only. Wallet keys, exchange
 * credentials and execution secrets never leave the VPS.
 */
export function rejectsAuthoritySecrets(input: {
  readonly authorityId: string;
  readonly name: string;
  readonly publicKey?: string | null;
}): string | null {
  const fields: [string, string | null | undefined][] = [
    ["authority id", input.authorityId],
    ["name", input.name],
    ["public key", input.publicKey],
  ];
  for (const [label, value] of fields) {
    if (value && SECRET_PATTERN.test(value)) {
      return `The ${label} looks like secret material. The authority registry stores public identity only.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wire schemas
// ---------------------------------------------------------------------------

const isoTimestamp = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), "timestamp must be ISO-8601");

/** `POST /authority/register` — engine announces itself to the control plane. */
export const authorityRegistrationSchema = z.object({
  authorityId: z.string().trim().min(3).max(128),
  name: z.string().trim().min(1).max(120),
  environment: z.enum(AUTHORITY_ENVIRONMENTS),
  engineVersion: z.string().trim().min(1).max(64),
  platformVersion: z.string().trim().min(1).max(64),
  version: z.string().trim().min(1).max(64).optional(),
  capabilities: z.array(z.enum(AUTHORITY_CAPABILITIES)).min(1),
  publicKey: z.string().trim().min(16).max(4096).nullable().optional(),
  timestamp: isoTimestamp,
  signature: z.string().trim().min(16).max(2048),
});
export type AuthorityRegistration = z.infer<typeof authorityRegistrationSchema>;

/** `POST /authority/heartbeat` — periodic liveness proof from the engine. */
export const authorityHeartbeatSchema = z.object({
  authorityId: z.string().trim().min(3).max(128),
  environment: z.enum(AUTHORITY_ENVIRONMENTS),
  engineVersion: z.string().trim().min(1).max(64),
  platformVersion: z.string().trim().min(1).max(64),
  configurationVersion: z.number().int().nonnegative().nullable().optional(),
  uptimeSeconds: z.number().int().nonnegative().optional(),
  timestamp: isoTimestamp,
  signature: z.string().trim().min(16).max(2048),
});
export type AuthorityHeartbeat = z.infer<typeof authorityHeartbeatSchema>;

/** `GET /authority/status` — read-only projection returned to the console. */
export const authorityStatusSchema = z.object({
  authorityId: z.string(),
  name: z.string(),
  environment: z.enum(AUTHORITY_ENVIRONMENTS),
  status: z.enum(AUTHORITY_STATUSES),
  engineVersion: z.string().nullable(),
  platformVersion: z.string().nullable(),
  version: z.string().nullable(),
  capabilities: z.array(z.string()),
  registeredAt: z.string().nullable(),
  lastSeen: z.string().nullable(),
});
export type AuthorityStatusView = z.infer<typeof authorityStatusSchema>;

/**
 * Parses an inbound registration and rejects secret material in one step.
 * Callers must still verify `signature` against the shared authority key held
 * in the server environment — never in the database or the browser.
 */
export function parseAuthorityRegistration(input: unknown): AuthorityRegistration {
  const parsed = authorityRegistrationSchema.parse(input);
  const issue = rejectsAuthoritySecrets(parsed);
  if (issue) throw new Error(issue);
  return parsed;
}

/** Derives liveness from the last heartbeat. Pure and clock-injected. */
export function deriveAuthorityStatus(
  stored: AuthorityStatus,
  lastSeenIso: string | null,
  nowMillis: number,
): AuthorityStatus {
  if (stored === "revoked") return "revoked";
  if (!lastSeenIso) return "registered";
  const lastSeen = Date.parse(lastSeenIso);
  if (Number.isNaN(lastSeen)) return "registered";
  return nowMillis - lastSeen <= AUTHORITY_STALE_AFTER_MILLIS ? "active" : "stale";
}
