/**
 * ARC — M7.10 control-plane security metadata.
 *
 * Read-only. Reports *metadata* about the shared authority signing key and the
 * operator ownership lifecycle. The key itself is never read into a response,
 * never persisted, never logged and never sent to the browser: only whether it
 * is configured, whether it meets the strength floor, and when a signed
 * authority message was last verified.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

/** Minimum length the gateway accepts before it will verify signatures at all. */
export const SIGNING_KEY_MIN_LENGTH = 16;
/** Length we recommend for a production shared key (openssl rand -hex 32). */
export const SIGNING_KEY_RECOMMENDED_LENGTH = 32;

export type SigningSecurityStatus = "ENFORCED" | "WEAK" | "FAIL_CLOSED";

export interface AuthoritySigningStatus {
  readonly configured: boolean;
  /** Meets the gateway's minimum length; false when configured but too short. */
  readonly meetsMinimumLength: boolean;
  readonly meetsRecommendedLength: boolean;
  readonly minimumLength: number;
  readonly recommendedLength: number;
  readonly securityStatus: SigningSecurityStatus;
  /** Last time a signed authority message was verified, from the audit trail. */
  readonly lastVerificationIso: string | null;
  readonly lastVerificationAction: string | null;
  readonly detail: string;
  /** Ownership lifecycle metadata, shown next to the key on the System page. */
  readonly ownershipFinalized: boolean;
  readonly registrationOpen: boolean;
}

export const getAuthoritySigningStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AuthoritySigningStatus> => {
    // Read length only. The value is never returned, logged or compared here.
    const raw = process.env["ARC_AUTHORITY_SIGNING_KEY"]?.trim() ?? "";
    const configured = raw.length > 0;
    const length = raw.length;
    const meetsMinimumLength = length >= SIGNING_KEY_MIN_LENGTH;
    const meetsRecommendedLength = length >= SIGNING_KEY_RECOMMENDED_LENGTH;

    const client = context.supabase as AnyClient;

    let lastVerificationIso: string | null = null;
    let lastVerificationAction: string | null = null;
    try {
      const { data } = await client
        .from("audit_log")
        .select("action, created_at")
        .like("action", "authority.%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        lastVerificationIso = (data.created_at as string | null) ?? null;
        lastVerificationAction = (data.action as string | null) ?? null;
      }
    } catch {
      // The audit read is diagnostic only; never fail the security panel on it.
    }

    let ownershipFinalized = false;
    let registrationOpen = true;
    try {
      const { resolveOperatorBootstrapState } = await import("@/lib/auth-state.server");
      const state = await resolveOperatorBootstrapState();
      ownershipFinalized = state.ownershipFinalized;
      registrationOpen = state.mode === "BOOTSTRAP_OPEN";
    } catch {
      // Leave the conservative defaults: unfinalized, registration assumed open.
    }

    const securityStatus: SigningSecurityStatus = !configured
      ? "FAIL_CLOSED"
      : meetsMinimumLength
        ? "ENFORCED"
        : "WEAK";

    const detail = !configured
      ? "No signing key configured. The gateway fail-closes: every authority message is rejected with KEY_UNCONFIGURED."
      : !meetsMinimumLength
        ? `The configured key is shorter than the ${SIGNING_KEY_MIN_LENGTH}-character floor, so the gateway still fail-closes.`
        : meetsRecommendedLength
          ? "Signature verification is enforced on every inbound authority message."
          : `Signature verification is enforced, but a key of at least ${SIGNING_KEY_RECOMMENDED_LENGTH} characters is recommended.`;

    return {
      configured,
      meetsMinimumLength,
      meetsRecommendedLength,
      minimumLength: SIGNING_KEY_MIN_LENGTH,
      recommendedLength: SIGNING_KEY_RECOMMENDED_LENGTH,
      securityStatus,
      lastVerificationIso,
      lastVerificationAction,
      detail,
      ownershipFinalized,
      registrationOpen,
    };
  });
