/**
 * ARC — canonical event envelope (P0/M0).
 *
 * Infrastructure only. This file defines the *shape* every ARC event carries;
 * it contains no business events and no trading semantics. The event store is
 * append-only: envelopes are never mutated, only superseded by later events.
 */
import { z } from "zod";

import { REASON_CODES, type ReasonCode } from "./reason-codes";
import { versionOf } from "./versions";
import { type Clock } from "../shared/time";
import { deterministicId, digest128 } from "../shared/ids";

export const eventMetadataSchema = z.object({
  /** Ties every event produced while handling one operator/engine action. */
  correlationId: z.string().min(1),
  /** The id of the event that directly caused this one, if any. */
  causationId: z.string().min(1).optional(),
  marketInstanceId: z.string().min(1).optional(),
  windowInstanceId: z.string().min(1).optional(),
  executionIntentId: z.string().min(1).optional(),
  /** Emitting engine/surface name, e.g. "configuration" or "scheduler". */
  source: z.string().min(1),
  /** Catalogued reason code explaining why the event exists. */
  reasonCode: z.string().min(1),
  /** Free-form, non-secret annotations. Never contains credentials. */
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export type EventMetadata = z.infer<typeof eventMetadataSchema>;

export const eventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  /** Dotted canonical name, e.g. "configuration.snapshot.created". */
  type: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/, "event type must be dotted lower-case"),
  schemaVersion: z.string().min(1),
  /** ISO-8601 UTC, millisecond precision. */
  occurredAt: z.string().datetime({ offset: false }),
  /** Monotonic sequence within the emitting runtime; total ordering tie-break. */
  sequence: z.number().int().nonnegative(),
  /** Stable key used to suppress duplicates on an append-only store. */
  idempotencyKey: z.string().min(1),
  metadata: eventMetadataSchema,
  payload: z.unknown(),
});

export type EventEnvelope<TPayload = unknown> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  "payload"
> & { payload: TPayload };

export interface CreateEventInput<TPayload> {
  type: string;
  payload: TPayload;
  reasonCode: ReasonCode;
  source: string;
  correlationId: string;
  causationId?: string;
  marketInstanceId?: string;
  windowInstanceId?: string;
  executionIntentId?: string;
  attributes?: Record<string, string | number | boolean>;
  /** Overrides the derived idempotency key when the producer owns one. */
  idempotencyKey?: string;
}

/**
 * Builds envelopes with a monotonic per-runtime sequence and a deterministic
 * event id, so the same logical event produced twice collapses to one record.
 */
export class EventEnvelopeFactory {
  private sequence = 0;

  constructor(
    private readonly clock: Clock,
    private readonly source: string,
  ) {}

  create<TPayload>(input: CreateEventInput<TPayload>): EventEnvelope<TPayload> {
    const occurredAt = this.clock.isoNow();
    const sequence = this.sequence;
    this.sequence += 1;

    const idempotencyKey =
      input.idempotencyKey ??
      digest128([input.type, input.correlationId, occurredAt, String(sequence)].join("\u0000"));

    const envelope: EventEnvelope<TPayload> = {
      eventId: deterministicId("EventId", input.type, idempotencyKey),
      type: input.type,
      schemaVersion: versionOf("eventSchema"),
      occurredAt,
      sequence,
      idempotencyKey,
      metadata: {
        correlationId: input.correlationId,
        ...(input.causationId ? { causationId: input.causationId } : {}),
        ...(input.marketInstanceId ? { marketInstanceId: input.marketInstanceId } : {}),
        ...(input.windowInstanceId ? { windowInstanceId: input.windowInstanceId } : {}),
        ...(input.executionIntentId ? { executionIntentId: input.executionIntentId } : {}),
        source: input.source || this.source,
        reasonCode: REASON_CODES[input.reasonCode].code,
        attributes: input.attributes ?? {},
      },
      payload: input.payload,
    };

    return validateEnvelope(envelope) as EventEnvelope<TPayload>;
  }
}

export function validateEnvelope(candidate: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(candidate) as EventEnvelope;
}

export function isValidEnvelope(candidate: unknown): boolean {
  return eventEnvelopeSchema.safeParse(candidate).success;
}

/** Total ordering across an append-only stream. */
export function compareEnvelopes(a: EventEnvelope, b: EventEnvelope): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/**
 * Append-only sink contract. Implementations must be idempotent on
 * `idempotencyKey` and must never update or delete an appended envelope.
 */
export interface EventSink {
  append(envelope: EventEnvelope): Promise<void>;
}

/** In-memory sink used by tests and the recovery/replay harness. */
export class InMemoryEventSink implements EventSink {
  private readonly seen = new Set<string>();
  readonly events: EventEnvelope[] = [];

  async append(envelope: EventEnvelope): Promise<void> {
    validateEnvelope(envelope);
    if (this.seen.has(envelope.idempotencyKey)) return;
    this.seen.add(envelope.idempotencyKey);
    this.events.push(envelope);
  }

  ordered(): EventEnvelope[] {
    return [...this.events].sort(compareEnvelopes);
  }
}
