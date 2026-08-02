/**
 * ARC — Platform Services read API (M4).
 *
 * Read-only, authenticated server functions over the platform stores. This
 * layer exposes events, ledger, analytics and replay results to the companion
 * UI. It performs NO trading action: there is no write path into the engine
 * here, by charter (ADR-0001).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
/** JSON-safe value: server functions may only return serializable data. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };


const listEventsInput = z
  .object({
    limit: z.number().int().min(1).max(500).default(100),
    correlationId: z.string().min(1).optional(),
    classification: z.enum(["BUSINESS", "OPERATIONAL"]).optional(),
    since: z.string().min(1).optional(),
  })
  .default({ limit: 100 });

export const listPlatformEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listEventsInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { SupabaseEventStore } = await import("@/core/platform/supabase-platform.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
    const store = new SupabaseEventStore(context.supabase as any, context.userId);
    const events = await store.query({
      limit: data.limit,
      ...(data.correlationId ? { correlationId: data.correlationId } : {}),
      ...(data.classification ? { classification: data.classification } : {}),
      ...(data.since ? { since: data.since } : {}),
    });
    return { events, count: events.length };
  });

export const getLedgerSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { SupabaseLedgerRepository } = await import("@/core/platform/supabase-platform.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
    const ledger = new SupabaseLedgerRepository(context.supabase as any, context.userId);
    const records = await ledger.list(200);
    const { summariseLedger } = await import("@/core/platform/ledger");
    return { summary: summariseLedger(records), records };
  });

export const getAnalyticsSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ SupabaseEventStore, SupabaseAnalyticsRepository }, { computeAnalytics }] =
      await Promise.all([
        import("@/core/platform/supabase-platform.server"),
        import("@/core/platform/analytics"),
      ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
    const client = context.supabase as any;
    const stored = await new SupabaseAnalyticsRepository(client, context.userId).latest("GLOBAL");
    if (stored) return { summary: stored, source: "STORED" as const };
    const events = await new SupabaseEventStore(client, context.userId).query({ limit: 500 });
    return { summary: computeAnalytics(events), source: "COMPUTED" as const };
  });

export const listReplayRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { SupabaseReplayRepository } = await import("@/core/platform/supabase-platform.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
    const repo = new SupabaseReplayRepository(context.supabase as any, context.userId);
    return { runs: await repo.latest(10) };
  });

const replayInput = z.object({ correlationId: z.string().min(1) });

/**
 * Runs a deterministic replay over stored events. Read-only reconstruction:
 * it never re-runs strategy and never places an order.
 */
export const runReplay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => replayInput.parse(input))
  .handler(async ({ data, context }) => {
    const [{ SupabaseEventStore, SupabaseReplayRepository }, { replayEvents }, { AuditTrail }] =
      await Promise.all([
        import("@/core/platform/supabase-platform.server"),
        import("@/core/platform/replay"),
        import("@/core/platform/audit"),
      ]);
    const { SupabaseAuditRepository } = await import(
      "@/core/infrastructure/supabase-persistence.server"
    );
    const { SystemClock } = await import("@/core/shared/time");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
    const client = context.supabase as any;
    const events = await new SupabaseEventStore(client, context.userId).query({
      correlationId: data.correlationId,
    });
    const runs = new SupabaseReplayRepository(client, context.userId);
    const audit = new AuditTrail(
      new SupabaseAuditRepository(client, context.userId),
      new SystemClock(),
      context.userId,
    );

    const result = replayEvents(events, { runId: `rpl_${data.correlationId}` });
    await runs.start(result.runId, data.correlationId);
    await audit.replayStarted(result.runId, { correlationId: data.correlationId });
    await runs.complete(result);
    await audit.replayCompleted(result.runId, {
      deterministic: result.deterministic,
      eventCount: result.eventCount,
    });

    return result;
  });
