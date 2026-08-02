/**
 * ARC — trading authority registry API (M7.5).
 *
 * Control-plane surface for VPS authority registration. The companion records
 * public identity and liveness only; the VPS remains the sole trading
 * authority (ADR-0001). Every mutating call fails closed when the backend
 * cutover guard is not satisfied.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AUTHORITY_CAPABILITIES,
  AUTHORITY_ENVIRONMENTS,
} from "@/core/platform/authority-registration";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

const registrationInput = z.object({
  authorityId: z.string().trim().min(3).max(128),
  name: z.string().trim().min(1).max(120),
  environment: z.enum(AUTHORITY_ENVIRONMENTS),
  engineVersion: z.string().trim().min(1).max(64),
  platformVersion: z.string().trim().min(1).max(64),
  version: z.string().trim().min(1).max(64).optional(),
  capabilities: z.array(z.enum(AUTHORITY_CAPABILITIES)).min(1),
  publicKey: z.string().trim().min(16).max(4096).nullable().optional(),
  timestamp: z.string().min(1),
  signature: z.string().trim().min(16).max(2048),
});

export const listRegisteredAuthorities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listAuthorities } = await import("./authority-registry.server");
    return listAuthorities(context.supabase as AnyClient);
  });

export const registerTradingAuthority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => registrationInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertCutoverSafe } = await import("./supabase/backend.server");
    assertCutoverSafe("authority-registration");
    const { upsertAuthority } = await import("./authority-registry.server");
    return upsertAuthority(context.supabase as AnyClient, context.userId, data);
  });

export const revokeTradingAuthority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ authorityId: z.string().trim().min(3).max(128) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertCutoverSafe } = await import("./supabase/backend.server");
    assertCutoverSafe("authority-registration");
    const { revokeAuthority } = await import("./authority-registry.server");
    await revokeAuthority(context.supabase as AnyClient, context.userId, data.authorityId);
    return { revoked: data.authorityId };
  });
