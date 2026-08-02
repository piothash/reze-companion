/**
 * ARC — authority message authentication (M7.6).
 *
 * Pure module. Defines how the VPS trading engine signs the messages it sends
 * to the control plane, and how the control plane verifies them:
 *
 *   canonical payload → HMAC-SHA256(shared key) → hex signature
 *
 * Three independent checks must pass before a message is accepted:
 *   1. signature   — proves the sender holds the shared authority key
 *   2. timestamp   — the message was produced inside the accepted clock skew
 *   3. nonce       — that exact signature has never been accepted before
 *
 * The shared key lives only in the server environment and on the VPS. It is
 * never stored in the database, never returned by an API and never shipped to
 * the browser. Nothing in this module decides what the engine trades.
 */

/** Messages older or newer than this are refused (clock skew tolerance). */
export const AUTHORITY_TIMESTAMP_SKEW_MILLIS = 60_000;

/** How long an accepted signature stays in the replay guard. */
export const AUTHORITY_REPLAY_WINDOW_MILLIS = 15 * 60_000;

export type AuthorityVerificationFailure =
  | "MISSING_SIGNATURE"
  | "MISSING_TIMESTAMP"
  | "TIMESTAMP_INVALID"
  | "TIMESTAMP_EXPIRED"
  | "TIMESTAMP_FUTURE"
  | "SIGNATURE_INVALID"
  | "SIGNATURE_REPLAYED"
  | "KEY_UNCONFIGURED";

export interface AuthorityVerificationResult {
  readonly ok: boolean;
  readonly reasonCode: AuthorityVerificationFailure | "ACCEPTED";
  readonly detail: string;
  /** Stable digest of the accepted signature, used as the replay nonce. */
  readonly signatureDigest: string | null;
}

// ---------------------------------------------------------------------------
// Canonical payload
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (key === "signature") continue;
      const entry = source[key];
      if (entry === undefined) continue;
      out[key] = canonicalize(entry);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic string both sides sign. Key order is normalised and the
 * `signature` field itself is excluded, so the VPS and the companion always
 * agree on the bytes regardless of JSON serialisation order.
 */
export function canonicalAuthorityMessage(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

// ---------------------------------------------------------------------------
// HMAC
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}

/** Signs a payload exactly the way the VPS authority client must sign it. */
export async function signAuthorityMessage(key: string, payload: unknown): Promise<string> {
  return hmacHex(key, canonicalAuthorityMessage(payload));
}

/** Constant-time comparison; never short-circuits on the first differing byte. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** SHA-256 of the signature — what the replay guard stores, not the signature. */
export async function signatureDigest(signature: string): Promise<string> {
  const hashed = await crypto.subtle.digest("SHA-256", encoder.encode(signature));
  return toHex(hashed);
}

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

export function verifyAuthorityTimestamp(
  timestamp: string | undefined | null,
  nowMillis: number,
  skewMillis = AUTHORITY_TIMESTAMP_SKEW_MILLIS,
): { ok: boolean; reasonCode: AuthorityVerificationFailure | "ACCEPTED"; detail: string } {
  if (!timestamp) {
    return { ok: false, reasonCode: "MISSING_TIMESTAMP", detail: "timestamp is required" };
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return { ok: false, reasonCode: "TIMESTAMP_INVALID", detail: "timestamp must be ISO-8601" };
  }
  const delta = nowMillis - parsed;
  if (delta > skewMillis) {
    return {
      ok: false,
      reasonCode: "TIMESTAMP_EXPIRED",
      detail: `timestamp is ${Math.round(delta / 1000)}s old; maximum skew is ${Math.round(skewMillis / 1000)}s`,
    };
  }
  if (delta < -skewMillis) {
    return {
      ok: false,
      reasonCode: "TIMESTAMP_FUTURE",
      detail: "timestamp is too far in the future",
    };
  }
  return { ok: true, reasonCode: "ACCEPTED", detail: "timestamp within skew" };
}

// ---------------------------------------------------------------------------
// Full verification
// ---------------------------------------------------------------------------

export interface AuthorityVerificationInput {
  readonly payload: Record<string, unknown>;
  readonly signature: string | undefined | null;
  readonly timestamp: string | undefined | null;
  readonly key: string | undefined | null;
  readonly nowMillis: number;
  readonly skewMillis?: number;
  /** Returns true when this signature digest was already accepted. */
  readonly seenBefore?: (digest: string) => Promise<boolean> | boolean;
}

/**
 * Verifies signature, timestamp and replay in one pass. Fails closed: an
 * unconfigured key rejects every message rather than accepting unsigned ones.
 */
export async function verifyAuthorityMessage(
  input: AuthorityVerificationInput,
): Promise<AuthorityVerificationResult> {
  if (!input.key) {
    return {
      ok: false,
      reasonCode: "KEY_UNCONFIGURED",
      detail:
        "No authority signing key is configured on this deployment. Unsigned authority messages are never accepted.",
      signatureDigest: null,
    };
  }
  if (!input.signature) {
    return {
      ok: false,
      reasonCode: "MISSING_SIGNATURE",
      detail: "signature is required",
      signatureDigest: null,
    };
  }

  const timestampCheck = verifyAuthorityTimestamp(
    input.timestamp,
    input.nowMillis,
    input.skewMillis,
  );
  if (!timestampCheck.ok) {
    return { ...timestampCheck, ok: false, signatureDigest: null } as AuthorityVerificationResult;
  }

  const expected = await hmacHex(input.key, canonicalAuthorityMessage(input.payload));
  if (!constantTimeEquals(expected, input.signature.trim().toLowerCase())) {
    return {
      ok: false,
      reasonCode: "SIGNATURE_INVALID",
      detail: "signature does not match the canonical payload",
      signatureDigest: null,
    };
  }

  const digest = await signatureDigest(input.signature.trim().toLowerCase());
  if (input.seenBefore && (await input.seenBefore(digest))) {
    return {
      ok: false,
      reasonCode: "SIGNATURE_REPLAYED",
      detail: "this signed message was already accepted",
      signatureDigest: digest,
    };
  }

  return {
    ok: true,
    reasonCode: "ACCEPTED",
    detail: "signature, timestamp and nonce accepted",
    signatureDigest: digest,
  };
}
