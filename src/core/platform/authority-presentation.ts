/**
 * ARC — M7.10 authority presentation status.
 *
 * Pure. Derives the single status the operator console is allowed to show for
 * a registered VPS trading authority. The console never marks an authority
 * ACTIVE by hand: liveness is derived from a verified heartbeat, a runtime
 * identity, and signature enforcement being switched on.
 *
 * Nothing here trades. The VPS remains the sole trading authority (ADR-0001).
 */
import { heartbeatDeadlineMillis } from "./authority-registration";

/**
 * UNREGISTERED — no authority row at all.
 * REVOKED      — the operator revoked it; it may not trade.
 * STALE        — registered, but the heartbeat aged out.
 * ACTIVE       — signature-verified, fresh heartbeat, runtime identity present.
 */
export const AUTHORITY_DISPLAY_STATUSES = [
  "ACTIVE",
  "STALE",
  "REVOKED",
  "UNREGISTERED",
] as const;

export type AuthorityDisplayStatus = (typeof AUTHORITY_DISPLAY_STATUSES)[number];

export interface AuthorityDisplayInput {
  readonly status: string;
  readonly lastSeenIso: string | null;
  readonly heartbeatIntervalMillis: number | null;
  readonly runtimeIdentity: string | null;
  /**
   * Whether inbound authority messages are signature-verified right now. With
   * no shared signing key the gateway fail-closes, so nothing that arrived can
   * be treated as a proven authority.
   */
  readonly signatureVerified: boolean;
}

export interface AuthorityDisplay {
  readonly status: AuthorityDisplayStatus;
  /** Milliseconds since the last verified heartbeat, or null if never seen. */
  readonly heartbeatAgeMillis: number | null;
  /** Age at which this authority is considered stale. */
  readonly heartbeatDeadlineMillis: number;
  /** Why the authority is not ACTIVE, in operator language. Empty when ACTIVE. */
  readonly blockers: readonly string[];
}

export function heartbeatAge(lastSeenIso: string | null, nowMillis: number): number | null {
  if (!lastSeenIso) return null;
  const seen = Date.parse(lastSeenIso);
  if (Number.isNaN(seen)) return null;
  return Math.max(0, nowMillis - seen);
}

/** Human heartbeat age: "12s ago", "4m ago", "never". */
export function formatHeartbeatAge(ageMillis: number | null): string {
  if (ageMillis === null) return "never";
  const seconds = Math.round(ageMillis / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function deriveAuthorityDisplay(
  input: AuthorityDisplayInput | null,
  nowMillis: number,
): AuthorityDisplay {
  const deadline = heartbeatDeadlineMillis(input?.heartbeatIntervalMillis ?? null);

  if (!input) {
    return {
      status: "UNREGISTERED",
      heartbeatAgeMillis: null,
      heartbeatDeadlineMillis: deadline,
      blockers: ["no authority has registered with the control plane"],
    };
  }

  const age = heartbeatAge(input.lastSeenIso, nowMillis);

  if (input.status === "revoked") {
    return {
      status: "REVOKED",
      heartbeatAgeMillis: age,
      heartbeatDeadlineMillis: deadline,
      blockers: ["the authority is revoked and may not trade"],
    };
  }

  const blockers: string[] = [];
  if (!input.signatureVerified) blockers.push("signature verification is not enforced");
  if (age === null) blockers.push("no verified heartbeat received");
  else if (age > deadline) blockers.push(`heartbeat is ${formatHeartbeatAge(age)}`);
  if (!input.runtimeIdentity) blockers.push("runtime identity not reported");

  return {
    status: blockers.length === 0 ? "ACTIVE" : "STALE",
    heartbeatAgeMillis: age,
    heartbeatDeadlineMillis: deadline,
    blockers,
  };
}
