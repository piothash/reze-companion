/**
 * ARC — configuration synchronization API (M6.7).
 *
 * Authenticated server functions implementing the production contract between
 * the operator console, Lovable Cloud persistence and the VPS trading
 * authority. The companion stores and dispatches configuration; only the VPS
 * validates, snapshots and activates it (ADR-0001). No trading logic here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BUFFER_MODES,
  EXECUTION_MODES,
  LIMIT_MODES,
  TICK_POLICIES,
  TRIGGER_MODES,
} from "@/core/decision/configuration";
import { WINDOW_OFFSET_UNITS } from "@/core/decision/types";
import { CONFIGURATION_ORIGINS } from "@/core/configuration/runtime-sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

const PROFILE_NAME = "arc-execution-profile";

const windowInput = z.object({
  offset: z.number().finite().positive(),
  unit: z.enum(WINDOW_OFFSET_UNITS),
  enabled: z.boolean(),
  twapBuffer: z.number().finite().nonnegative(),
  positionSizeOverride: z.number().finite().positive().nullable(),
  retryCountOverride: z.number().int().nonnegative().nullable(),
  timeoutMillisOverride: z.number().int().positive().nullable(),
  maxSpreadOverride: z.number().finite().nonnegative().nullable(),
});

const profileInput = z.object({
  executionProfileId: z.string().min(1),
  executionMode: z.enum(EXECUTION_MODES),
  maxTrades: z.number().int().positive(),
  triggerMode: z.enum(TRIGGER_MODES),
  limitMode: z.enum(LIMIT_MODES),
  compounding: z.boolean(),
  positionSize: z.number().finite().positive(),
  retryCount: z.number().int().nonnegative(),
  minLiquidity: z.number().finite().nonnegative(),
  maxSpread: z.number().finite().nonnegative(),
  repricingEnabled: z.boolean(),
  repricingIntervalMillis: z.number().int().positive(),
  repricingMaxAttempts: z.number().int().nonnegative(),
  timeoutMillis: z.number().int().positive(),
  tickPolicy: z.enum(TICK_POLICIES),
  tickSize: z.number().finite().positive(),
  bufferMode: z.enum(BUFFER_MODES),
  windowActiveMillis: z.number().int().positive(),
  precision: z.number().int().nonnegative().max(12),
  windows: z.array(windowInput).min(1),
});

const publishInput = z.object({
  profile: profileInput,
  origin: z.enum(CONFIGURATION_ORIGINS).default("SAVE"),
});

/**
 * Publishes an operator configuration change: persists an immutable version,
 * dispatches it to the trading authority and records the verdict. The caller
 * always learns whether the configuration actually became active.
 */
export const publishConfigurationVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => publishInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runConfigurationSync } = await import("./configuration-sync.server");
    return runConfigurationSync(context.supabase as AnyClient, context.userId, {
      candidate: data.profile,
      origin: data.origin,
    });
  });

/**
 * Re-dispatches a stored immutable version (rollback, restore, duplicate,
 * re-activation). The stored document is never edited — the authority decides
 * whether it becomes the running configuration.
 */
export const activateConfigurationVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        version: z.number().int().positive(),
        origin: z.enum(CONFIGURATION_ORIGINS).default("ACTIVATE"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { runConfigurationSync } = await import("./configuration-sync.server");
    return runConfigurationSync(context.supabase as AnyClient, context.userId, {
      sourceVersion: data.version,
      origin: data.origin,
    });
  });

/** Archives a stored version. Archived versions stay readable for audit. */
export const archiveConfigurationVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ version: z.number().int().positive() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { archiveVersion } = await import("./configuration-sync.server");
    return archiveVersion(context.supabase as AnyClient, context.userId, data.version);
  });

/**
 * Single read used by the console on every load and refresh. It asks the
 * trading authority what it is running right now, refreshes the mirror and
 * returns the version history — the browser never reconstructs configuration
 * from local state.
 */
export const getConfigurationRuntimeView = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readRuntimeView } = await import("./configuration-sync.server");
    return readRuntimeView(context.supabase as AnyClient, context.userId);
  });

export const CONFIGURATION_PROFILE_NAME = PROFILE_NAME;
