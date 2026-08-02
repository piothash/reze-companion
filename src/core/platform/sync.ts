/**
 * ARC — companion↔Cloud synchronization policy (M4 Platform Services).
 *
 * The companion mirrors durable records ONLY: snapshots, events, notifications,
 * ledger summaries and analytics summaries. Runtime execution state, active
 * orders and the Execution Context are never synchronized — the VPS remains
 * the sole trading authority (ADR-0001).
 */
import { type EventEnvelope } from "../contracts/event-envelope";
import { versionOf } from "../contracts/versions";

export const SYNCHRONIZABLE_STREAMS = [
  "SNAPSHOTS",
  "EVENTS",
  "NOTIFICATIONS",
  "LEDGER_SUMMARIES",
  "ANALYTICS_SUMMARIES",
] as const;
export type SynchronizableStream = (typeof SYNCHRONIZABLE_STREAMS)[number];

/** Runtime-only concepts that must never leave the engine runtime. */
export const NEVER_SYNCHRONIZED = [
  "EXECUTION_CONTEXT",
  "ACTIVE_ORDERS",
  "RUNTIME_STATE",
  "VENUE_CREDENTIALS",
  "OPEN_RESERVATIONS",
] as const;
export type NeverSynchronized = (typeof NEVER_SYNCHRONIZED)[number];

/** Event types carrying live, in-flight execution state — excluded by policy. */
const RUNTIME_ONLY_EVENT_TYPES = new Set<string>([
  "trade.order.submitted",
  "trade.order.updated",
  "trade.exposure.reserved",
]);

export function isSynchronizableEvent(type: string): boolean {
  return !RUNTIME_ONLY_EVENT_TYPES.has(type);
}

export interface SynchronizationPlan {
  synchronizationVersion: string;
  synchronize: EventEnvelope[];
  skipped: { eventId: string; type: string; reasonCode: "SYN_SKIPPED_RUNTIME_STATE" }[];
}

export function planSynchronization(events: readonly EventEnvelope[]): SynchronizationPlan {
  const synchronize: EventEnvelope[] = [];
  const skipped: SynchronizationPlan["skipped"] = [];
  for (const event of events) {
    if (isSynchronizableEvent(event.type)) synchronize.push(event);
    else
      skipped.push({
        eventId: event.eventId,
        type: event.type,
        reasonCode: "SYN_SKIPPED_RUNTIME_STATE",
      });
  }
  return { synchronizationVersion: versionOf("synchronization"), synchronize, skipped };
}

export interface SynchronizationResult {
  stream: SynchronizableStream;
  attempted: number;
  written: number;
  duplicates: number;
  skipped: number;
  failed: number;
}

export interface EventSynchronizationTarget {
  writeEvents(events: readonly EventEnvelope[]): Promise<{ written: number; duplicates: number }>;
}

/**
 * Pushes an event batch into a durable target under the synchronization
 * policy. Never uploads runtime-only state, whatever the caller passes in.
 */
export async function synchronizeEvents(
  events: readonly EventEnvelope[],
  target: EventSynchronizationTarget,
): Promise<SynchronizationResult> {
  const plan = planSynchronization(events);
  try {
    const { written, duplicates } = await target.writeEvents(plan.synchronize);
    return {
      stream: "EVENTS",
      attempted: plan.synchronize.length,
      written,
      duplicates,
      skipped: plan.skipped.length,
      failed: 0,
    };
  } catch {
    return {
      stream: "EVENTS",
      attempted: plan.synchronize.length,
      written: 0,
      duplicates: 0,
      skipped: plan.skipped.length,
      failed: plan.synchronize.length,
    };
  }
}

export class InMemorySynchronizationTarget implements EventSynchronizationTarget {
  readonly stored = new Map<string, EventEnvelope>();

  async writeEvents(events: readonly EventEnvelope[]) {
    let written = 0;
    let duplicates = 0;
    for (const event of events) {
      if (this.stored.has(event.idempotencyKey)) duplicates += 1;
      else {
        this.stored.set(event.idempotencyKey, event);
        written += 1;
      }
    }
    return { written, duplicates };
  }
}
