/**
 * ARC — operator ownership API (M7.2).
 *
 * Authenticated surface for the ownership bootstrap and migration tool. No
 * email address is ever compiled into the application: the intended production
 * operator is selected at deployment time.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

export const getOwnershipState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readOwnershipState } = await import("./ownership.server");
    return readOwnershipState(context.supabase as AnyClient);
  });

export const transferOperatorOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().email().max(320) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { transferOwnership } = await import("./ownership.server");
    return transferOwnership(context.supabase as AnyClient, data.email);
  });

export const finalizeOperatorOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { finalizeOwnership } = await import("./ownership.server");
    return finalizeOwnership(context.supabase as AnyClient);
  });
