/**
 * ARC — Supabase-backed Platform Services persistence (M4).
 *
 * Server-only by filename. Implements the append-only event store, ledger,
 * analytics and replay metadata against Lovable Cloud. Runtime execution state
 * is never written here — see src/core/platform/sync.ts for the policy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  compareEnvelopes,
  validateEnvelope,
  type EventEnvelope,
} from "../contracts/event-envelope";
import { classifyEventType } from "./event-catalog";
import {
  matchesQuery,
  type AppendOnlyEventStore,
  type AppendResult,
  type EventQuery,
} from "./event-store";
import {
  summariseLedger,
  type LedgerRecord,
  type LedgerRepository,
  type LedgerSummary,
} from "./ledger";
import { type AnalyticsRepository, type AnalyticsSummary } from "./analytics";
import { type ReplayResult } from "./replay";
import { planSynchronization, type EventSynchronizationTarget } from "./sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types are not generic here
type Client = SupabaseClient<any, "public", any>;

interface EventRow {
  event_id: string;
  type: string;
  schema_version: string;
  occurred_at: string;
  sequence: number;
  idempotency_key: string;
  correlation_id: string;
  causation_id: string | null;
  market_instance_id: string | null;
  window_instance_id: string | null;
  execution_intent_id: string | null;
  source: string;
  reason_code: string;
  attributes: Record<string, string | number | boolean>;
  payload: unknown;
}

function toEnvelope(row: EventRow): EventEnvelope {
  return validateEnvelope({
    eventId: row.event_id,
    type: row.type,
    schemaVersion: row.schema_version,
    occurredAt: new Date(row.occurred_at).toISOString().replace("Z", ""),
    sequence: row.sequence,
    idempotencyKey: row.idempotency_key,
    metadata: {
      correlationId: row.correlation_id,
      ...(row.causation_id ? { causationId: row.causation_id } : {}),
      ...(row.market_instance_id ? { marketInstanceId: row.market_instance_id } : {}),
      ...(row.window_instance_id ? { windowInstanceId: row.window_instance_id } : {}),
      ...(row.execution_intent_id ? { executionIntentId: row.execution_intent_id } : {}),
      source: row.source,
      reasonCode: row.reason_code,
      attributes: row.attributes ?? {},
    },
    payload: row.payload,
  });
}

function toRow(envelope: EventEnvelope, userId: string) {
  return {
    user_id: userId,
    event_id: envelope.eventId,
    type: envelope.type,
    classification: classifyEventType(envelope.type),
    schema_version: envelope.schemaVersion,
    occurred_at: `${envelope.occurredAt}Z`,
    sequence: envelope.sequence,
    idempotency_key: envelope.idempotencyKey,
    correlation_id: envelope.metadata.correlationId,
    causation_id: envelope.metadata.causationId ?? null,
    market_instance_id: envelope.metadata.marketInstanceId ?? null,
    window_instance_id: envelope.metadata.windowInstanceId ?? null,
    execution_intent_id: envelope.metadata.executionIntentId ?? null,
    source: envelope.metadata.source,
    reason_code: envelope.metadata.reasonCode,
    attributes: envelope.metadata.attributes,
    payload: envelope.payload ?? {},
  };
}

/**
 * Append-only event store backed by `platform_events`. The table grants only
 * SELECT and INSERT, so immutability is enforced by the database itself.
 */
export class SupabaseEventStore implements AppendOnlyEventStore, EventSynchronizationTarget {
  constructor(
    private readonly supabase: Client,
    private readonly userId: string,
  ) {}

  private table() {
    return this.supabase.from("platform_events");
  }

  async append(envelope: EventEnvelope): Promise<void> {
    await this.appendChecked(envelope);
  }

  async appendChecked(envelope: EventEnvelope): Promise<AppendResult> {
    const validated = validateEnvelope(envelope);
    const { error } = await this.table().insert(toRow(validated, this.userId));
    if (error) {
      // 23505 = unique violation on (user_id, idempotency_key) → idempotent no-op.
      if (error.code === "23505")
        return { appended: false, duplicate: true, eventId: validated.eventId };
      throw new Error(`event not appended: ${error.message}`);
    }
    return { appended: true, duplicate: false, eventId: validated.eventId };
  }

  async writeEvents(events: readonly EventEnvelope[]) {
    const plan = planSynchronization(events);
    let written = 0;
    let duplicates = 0;
    for (const event of plan.synchronize) {
      const result = await this.appendChecked(event);
      if (result.appended) written += 1;
      else duplicates += 1;
    }
    return { written, duplicates };
  }

  async readSince(isoTimestamp: string, limit: number): Promise<EventEnvelope[]> {
    return this.query({ since: isoTimestamp, limit });
  }

  async readByCorrelation(correlationId: string): Promise<EventEnvelope[]> {
    return this.query({ correlationId });
  }

  async query(query: EventQuery): Promise<EventEnvelope[]> {
    let builder = this.table().select("*").order("occurred_at", { ascending: true });
    if (query.correlationId) builder = builder.eq("correlation_id", query.correlationId);
    if (query.classification) builder = builder.eq("classification", query.classification);
    if (query.marketInstanceId) builder = builder.eq("market_instance_id", query.marketInstanceId);
    if (query.executionIntentId)
      builder = builder.eq("execution_intent_id", query.executionIntentId);
    if (query.types?.length) builder = builder.in("type", [...query.types]);
    if (query.since) builder = builder.gte("occurred_at", `${query.since}Z`);
    if (query.until) builder = builder.lt("occurred_at", `${query.until}Z`);
    if (typeof query.limit === "number") builder = builder.limit(query.limit);

    const { data, error } = await builder;
    if (error) throw new Error(`event stream unavailable: ${error.message}`);
    return ((data ?? []) as EventRow[])
      .map(toEnvelope)
      .filter((envelope) => matchesQuery(envelope, query))
      .sort(compareEnvelopes);
  }

  async count(): Promise<number> {
    const { count, error } = await this.table().select("id", { count: "exact", head: true });
    if (error) throw new Error(`event count unavailable: ${error.message}`);
    return count ?? 0;
  }
}

export class SupabaseLedgerRepository implements LedgerRepository {
  constructor(
    private readonly supabase: Client,
    private readonly userId: string,
  ) {}

  async append(records: readonly LedgerRecord[]): Promise<void> {
    if (records.length === 0) return;
    const { error } = await this.supabase.from("ledger_records").upsert(
      records.map((record) => ({
        user_id: this.userId,
        record_id: record.recordId,
        kind: record.kind,
        execution_intent_id: record.executionIntentId,
        market_instance_id: record.marketInstanceId,
        window_instance_id: record.windowInstanceId,
        outcome_key: record.outcomeKey,
        quantity: record.quantity,
        price: record.price,
        notional: record.notional,
        fees: record.fees,
        realized_pnl: record.realizedPnl,
        occurred_at: `${record.occurredAtIso}Z`,
        source_event_id: record.sourceEventId,
        metadata: record.metadata,
      })),
      { onConflict: "user_id,record_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(`ledger records not written: ${error.message}`);
  }

  async list(limit = 200): Promise<LedgerRecord[]> {
    const { data, error } = await this.supabase
      .from("ledger_records")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`ledger unavailable: ${error.message}`);
    return ((data ?? []) as Record<string, never>[]).map((row) => ({
      recordId: row["record_id"] as unknown as string,
      kind: row["kind"] as unknown as LedgerRecord["kind"],
      executionIntentId: (row["execution_intent_id"] as unknown as string | null) ?? null,
      marketInstanceId: (row["market_instance_id"] as unknown as string | null) ?? null,
      windowInstanceId: (row["window_instance_id"] as unknown as string | null) ?? null,
      outcomeKey: (row["outcome_key"] as unknown as string | null) ?? null,
      quantity: Number(row["quantity"]),
      price: Number(row["price"]),
      notional: Number(row["notional"]),
      fees: Number(row["fees"]),
      realizedPnl: Number(row["realized_pnl"]),
      occurredAtIso: new Date(row["occurred_at"] as unknown as string)
        .toISOString()
        .replace("Z", ""),
      sourceEventId: (row["source_event_id"] as unknown as string) ?? "unknown",
      metadata: (row["metadata"] as unknown as LedgerRecord["metadata"]) ?? {},
    }));
  }

  async summary(): Promise<LedgerSummary> {
    return summariseLedger(await this.list(1000));
  }
}

export class SupabaseAnalyticsRepository implements AnalyticsRepository {
  constructor(
    private readonly supabase: Client,
    private readonly userId: string,
  ) {}

  async save(summary: AnalyticsSummary, scope: string, scopeKey: string): Promise<void> {
    const { error } = await this.supabase.from("analytics_summaries").insert({
      user_id: this.userId,
      scope,
      scope_key: scopeKey,
      period_start: `${summary.periodStartIso ?? summary.periodEndIso ?? new Date().toISOString().replace("Z", "")}Z`,
      period_end: `${summary.periodEndIso ?? summary.periodStartIso ?? new Date().toISOString().replace("Z", "")}Z`,
      event_count: summary.eventCount,
      metrics: {
        metrics: summary.metrics,
        perWindow: summary.perWindow,
        perProfile: summary.perProfile,
      },
    });
    if (error) throw new Error(`analytics summary not saved: ${error.message}`);
  }

  async latest(scope = "GLOBAL"): Promise<AnalyticsSummary | null> {
    const { data, error } = await this.supabase
      .from("analytics_summaries")
      .select("*")
      .eq("scope", scope)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`analytics summary unavailable: ${error.message}`);
    if (!data) return null;
    const row = data as Record<string, never>;
    const metrics = row["metrics"] as unknown as {
      metrics: AnalyticsSummary["metrics"];
      perWindow: AnalyticsSummary["perWindow"];
      perProfile: AnalyticsSummary["perProfile"];
    };
    return {
      analyticsVersion: "1.0.0",
      periodStartIso: new Date(row["period_start"] as unknown as string)
        .toISOString()
        .replace("Z", ""),
      periodEndIso: new Date(row["period_end"] as unknown as string).toISOString().replace("Z", ""),
      eventCount: Number(row["event_count"]),
      metrics: metrics.metrics,
      perWindow: metrics.perWindow ?? [],
      perProfile: metrics.perProfile ?? [],
    };
  }
}

export interface ReplayRunRecord {
  runId: string;
  status: "STARTED" | "COMPLETED" | "DIVERGED";
  eventCount: number;
  deterministic: boolean;
  startedAtIso: string;
  completedAtIso: string | null;
  mismatches: unknown[];
}

export class SupabaseReplayRepository {
  constructor(
    private readonly supabase: Client,
    private readonly userId: string,
  ) {}

  async start(runId: string, correlationId: string | null): Promise<void> {
    const { error } = await this.supabase.from("replay_runs").insert({
      user_id: this.userId,
      run_id: runId,
      status: "STARTED",
      correlation_id: correlationId,
    });
    if (error && error.code !== "23505")
      throw new Error(`replay run not started: ${error.message}`);
  }

  async complete(result: ReplayResult): Promise<void> {
    const { error } = await this.supabase
      .from("replay_runs")
      .update({
        status: result.deterministic ? "COMPLETED" : "DIVERGED",
        event_count: result.eventCount,
        deterministic: result.deterministic,
        mismatches: result.mismatches,
        source_from: result.fromIso ? `${result.fromIso}Z` : null,
        source_to: result.toIso ? `${result.toIso}Z` : null,
        completed_at: new Date().toISOString(),
      })
      .eq("run_id", result.runId)
      .eq("user_id", this.userId);
    if (error) throw new Error(`replay run not completed: ${error.message}`);
  }

  async latest(limit = 10): Promise<ReplayRunRecord[]> {
    const { data, error } = await this.supabase
      .from("replay_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`replay runs unavailable: ${error.message}`);
    return ((data ?? []) as Record<string, never>[]).map((row) => ({
      runId: row["run_id"] as unknown as string,
      status: row["status"] as unknown as ReplayRunRecord["status"],
      eventCount: Number(row["event_count"]),
      deterministic: Boolean(row["deterministic"]),
      startedAtIso: new Date(row["started_at"] as unknown as string).toISOString(),
      completedAtIso: row["completed_at"]
        ? new Date(row["completed_at"] as unknown as string).toISOString()
        : null,
      mismatches: (row["mismatches"] as unknown as unknown[]) ?? [],
    }));
  }
}

export interface PlatformPersistence {
  events: SupabaseEventStore;
  ledger: SupabaseLedgerRepository;
  analytics: SupabaseAnalyticsRepository;
  replay: SupabaseReplayRepository;
}

export function createPlatformPersistence(supabase: Client, userId: string): PlatformPersistence {
  return {
    events: new SupabaseEventStore(supabase, userId),
    ledger: new SupabaseLedgerRepository(supabase, userId),
    analytics: new SupabaseAnalyticsRepository(supabase, userId),
    replay: new SupabaseReplayRepository(supabase, userId),
  };
}
