/**
 * ARC — engine registration and runtime handshake API (M6.8).
 *
 * Authenticated server functions. The console discovers, registers and
 * continuously synchronizes with the VPS trading engine; it never executes
 * trading logic and never stores credentials (ADR-0001, charter §Hybrid).
 *
 * Mutations require the operator or admin role. Viewers may read runtime state.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ENGINE_ENVIRONMENTS,
  engineRegistrationSchema,
} from "@/core/platform/authority-handshake";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

const registrationInput = z.object({
  id: z.string().uuid().nullable().default(null),
  registration: engineRegistrationSchema,
});

/** Registered engines plus the caller's runtime capabilities. */
export const listEngineRegistrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ listEndpoints }, { resolveCapabilities }] = await Promise.all([
      import("./authority-handshake.server"),
      import("./roles.server"),
    ]);
    const [endpoints, capabilities] = await Promise.all([
      listEndpoints(context.supabase as AnyClient),
      resolveCapabilities(context.supabase as AnyClient, context.userId),
    ]);
    return { endpoints, capabilities, environments: ENGINE_ENVIRONMENTS };
  });

/** Creates or updates an engine registration. Public metadata only. */
export const saveEngineRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => registrationInput.parse(input))
  .handler(async ({ data, context }) => {
    const { requireOperator } = await import("./roles.server");
    const { saveRegistration } = await import("./engine-registry.server");
    await requireOperator(context.supabase as AnyClient, context.userId);
    return saveRegistration(context.supabase as AnyClient, context.userId, data.id, data.registration);
  });

/** Makes one engine the active trading authority for this control plane. */
export const activateEngineRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireOperator } = await import("./roles.server");
    const { activateRegistration } = await import("./engine-registry.server");
    await requireOperator(context.supabase as AnyClient, context.userId);
    return activateRegistration(context.supabase as AnyClient, context.userId, data.id);
  });

/** Removes an engine registration and its mirrored runtime identity. */
export const deleteEngineRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireOperator } = await import("./roles.server");
    const { deleteRegistration } = await import("./engine-registry.server");
    await requireOperator(context.supabase as AnyClient, context.userId);
    return deleteRegistration(context.supabase as AnyClient, context.userId, data.id);
  });

/** One-shot handshake probe against a candidate engine before registering it. */
export const probeEngineHandshake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        baseUrl: z.string().min(1),
        handshakeEndpoint: z.string().min(1).startsWith("/"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireOperator } = await import("./roles.server");
    const { performHandshake } = await import("./authority-handshake.server");
    await requireOperator(context.supabase as AnyClient, context.userId);
    const result = await performHandshake({
      id: "probe",
      name: "probe",
      baseUrl: data.baseUrl,
      environment: "production",
      apiVersion: null,
      engineVersion: null,
      platformVersion: null,
      healthEndpoint: "/health/details",
      handshakeEndpoint: data.handshakeEndpoint,
      publicIdentifier: null,
      syncIntervalMillis: 5_000,
      isActive: true,
      lastSeenAtIso: null,
    });
    return {
      transport: result.transport,
      reasonCode: result.reasonCode,
      detail: result.detail,
      latencyMillis: result.latencyMillis,
      engineId: result.identity?.engineId ?? null,
      engineVersion: result.identity?.engineVersion ?? null,
      platformVersion: result.identity?.platformVersion ?? null,
      apiVersion: result.identity?.apiVersion ?? null,
      environment: result.identity?.environment ?? null,
      network: result.identity?.network ?? null,
    };
  });

/**
 * The polling read: handshake, runtime identity, saved-vs-running verification
 * and subsystem health in one document. Called on load and every sync tick.
 */
export const getAuthorityRuntime = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readAuthorityRuntime } = await import("./authority-handshake.server");
    const { resolveCapabilities } = await import("./roles.server");
    const capabilities = await resolveCapabilities(
      context.supabase as AnyClient,
      context.userId,
    );
    const view = await readAuthorityRuntime(context.supabase as AnyClient, context.userId, {
      canWrite: capabilities.canWrite,
    });
    return { ...view, capabilities };
  });

/**
 * Live runtime telemetry (M7.0). Every operator page renders engine-published
 * facts through this read: markets, feed, TWAP, windows, scheduler, execution
 * counters and process state. LIVE when the authority answers, MIRRORED when
 * it does not — never synthesised.
 */
export const getRuntimeTelemetry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readRuntimeTelemetry } = await import("./runtime-telemetry.server");
    return readRuntimeTelemetry(context.supabase as AnyClient);
  });
