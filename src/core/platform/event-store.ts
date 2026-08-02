/**
 * ARC — append-only event store (M4 Platform Services).
 *
 * The store is infrastructure: it never interprets a payload, never derives a
 * trading outcome and never mutates. Guarantees enforced here:
 *  • append-only — no update, no delete, no retroactive insertion
 *  • idempotent — the same idempotency key collapses to one record
 *  • immutable — appended envelopes are deep-frozen
 *  • validated — every record passes the canonical envelope schema
 */
import {
  compareEnvelopes,
  validateEnvelope,
  type EventEnvelope,
  type EventSink,
} from "../contracts/event-envelope";
import { versionOf } from "../contracts/versions";
import { classifyEventType, type EventClassification } from "./event-catalog";

export class EventStoreViolationError extends Error {
  constructor(
    readonly reasonCode: "EVT_RETROACTIVE_REJECTED" | "EVT_INVALID" | "EVT_MUTATION_REJECTED",
    message: string,
  ) {
    super(message);
    this.name = "EventStoreViolationError";
  }
}

export interface EventQuery {
  types?: readonly string[];
  classification?: EventClassification;
  correlationId?: string;
  marketInstanceId?: string;
  executionIntentId?: string;
  /** Inclusive ISO-8601 lower bound. */
  since?: string;
  /** Exclusive ISO-8601 upper bound. */
  until?: string;
  limit?: number;
}

export interface AppendResult {
  appended: boolean;
  duplicate: boolean;
  eventId: string;
}

export interface EventStoreReader {
  readSince(isoTimestamp: string, limit: number): Promise<EventEnvelope[]>;
  readByCorrelation(correlationId: string): Promise<EventEnvelope[]>;
  query(query: EventQuery): Promise<EventEnvelope[]>;
  count(): Promise<number>;
}

export interface AppendOnlyEventStore extends EventSink, EventStoreReader {
  appendChecked(envelope: EventEnvelope): Promise<AppendResult>;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}

export function matchesQuery(envelope: EventEnvelope, query: EventQuery): boolean {
  if (query.types && !query.types.includes(envelope.type)) return false;
  if (query.classification && classifyEventType(envelope.type) !== query.classification)
    return false;
  if (query.correlationId && envelope.metadata.correlationId !== query.correlationId) return false;
  if (query.marketInstanceId && envelope.metadata.marketInstanceId !== query.marketInstanceId)
    return false;
  if (query.executionIntentId && envelope.metadata.executionIntentId !== query.executionIntentId)
    return false;
  if (query.since && envelope.occurredAt < query.since) return false;
  if (query.until && envelope.occurredAt >= query.until) return false;
  return true;
}

export interface EventStoreOptions {
  /** When false (default) an event older than the newest stored one is rejected. */
  allowRetroactive?: boolean;
}

/**
 * Reference in-memory implementation. Also the substrate used by replay and by
 * the tests that pin the append-only guarantees.
 */
export class InMemoryEventStore implements AppendOnlyEventStore {
  readonly storeVersion = versionOf("eventStore");

  private readonly records: EventEnvelope[] = [];
  private readonly byIdempotencyKey = new Map<string, EventEnvelope>();
  private readonly byEventId = new Map<string, EventEnvelope>();

  private readonly allowRetroactive: boolean;

  constructor(options: EventStoreOptions = {}) {
    this.allowRetroactive = options.allowRetroactive ?? false;
  }

  async append(envelope: EventEnvelope): Promise<void> {
    await this.appendChecked(envelope);
  }

  async appendChecked(envelope: EventEnvelope): Promise<AppendResult> {
    let validated: EventEnvelope;
    try {
      validated = validateEnvelope(envelope);
    } catch (error) {
      throw new EventStoreViolationError(
        "EVT_INVALID",
        `event failed envelope validation: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    const existing = this.byIdempotencyKey.get(validated.idempotencyKey);
    if (existing) return { appended: false, duplicate: true, eventId: existing.eventId };

    // An eventId identifies exactly one immutable fact: re-appending it with a
    // different body would be a silent mutation of history.
    const priorById = this.byEventId.get(validated.eventId);
    if (priorById) {
      throw new EventStoreViolationError(
        "EVT_MUTATION_REJECTED",
        `eventId ${validated.eventId} already stored with different content`,
      );
    }


    const newest = this.records[this.records.length - 1];
    if (!this.allowRetroactive && newest && compareEnvelopes(validated, newest) < 0) {
      throw new EventStoreViolationError(
        "EVT_RETROACTIVE_REJECTED",
        `retroactive insertion rejected: ${validated.type} at ${validated.occurredAt} precedes ${newest.occurredAt}`,
      );
    }

    const frozen = deepFreeze({ ...validated, payload: deepFreeze(validated.payload) });
    this.records.push(frozen);
    this.byIdempotencyKey.set(frozen.idempotencyKey, frozen);
    return { appended: true, duplicate: false, eventId: frozen.eventId };
  }

  /** Convenience for pipelines that append a batch in one call. */
  async appendAll(envelopes: readonly EventEnvelope[]): Promise<AppendResult[]> {
    const results: AppendResult[] = [];
    for (const envelope of envelopes) results.push(await this.appendChecked(envelope));
    return results;
  }

  async readSince(isoTimestamp: string, limit: number): Promise<EventEnvelope[]> {
    return this.query({ since: isoTimestamp, limit });
  }

  async readByCorrelation(correlationId: string): Promise<EventEnvelope[]> {
    return this.query({ correlationId });
  }

  async query(query: EventQuery): Promise<EventEnvelope[]> {
    const matched = this.ordered().filter((envelope) => matchesQuery(envelope, query));
    return typeof query.limit === "number" ? matched.slice(0, query.limit) : matched;
  }

  async count(): Promise<number> {
    return this.records.length;
  }

  /** Deterministic total ordering across the whole stream. */
  ordered(): EventEnvelope[] {
    return [...this.records].sort(compareEnvelopes);
  }
}
