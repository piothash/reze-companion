/**
 * ARC — Platform Services canonical events (M4).
 *
 * Platform-owned events only (settlement records, ledger records, scheduler,
 * health, feed connectivity, replay lifecycle, window closure). Emitting an
 * event never changes a trading outcome — the VPS remains the trading
 * authority; the companion observes and records.
 */
import {
  type EventEnvelope,
  type EventEnvelopeFactory,
  type EventSink,
} from "../contracts/event-envelope";
import { type ReasonCode } from "../contracts/reason-codes";
import { EVENT_CATALOG } from "./event-catalog";

export const PLATFORM_EVENT_TYPES = {
  tradeSettled: EVENT_CATALOG.TradeSettled.type,
  ledgerRecorded: EVENT_CATALOG.LedgerRecorded.type,
  windowClosed: EVENT_CATALOG.WindowClosed.type,
  schedulerTick: EVENT_CATALOG.SchedulerTick.type,
  healthChanged: EVENT_CATALOG.HealthChanged.type,
  feedConnected: EVENT_CATALOG.FeedConnected.type,
  feedDisconnected: EVENT_CATALOG.FeedDisconnected.type,
  replayStarted: EVENT_CATALOG.ReplayStarted.type,
  replayCompleted: EVENT_CATALOG.ReplayCompleted.type,
} as const;

export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[keyof typeof PLATFORM_EVENT_TYPES];

const SOURCE = "platform";

export interface PlatformEventContext {
  correlationId: string;
  causationId?: string;
  marketInstanceId?: string;
  windowInstanceId?: string;
  executionIntentId?: string;
}

export interface SettlementRecord {
  settlementId: string;
  executionIntentId: string;
  marketInstanceId: string;
  outcomeKey: string;
  quantity: number;
  averagePrice: number;
  notional: number;
  fees: number;
  realizedPnl: number;
  settledAtIso: string;
}

export interface LedgerRecordedPayload {
  recordId: string;
  kind: string;
  executionIntentId: string | null;
  amount: number;
  occurredAtIso: string;
}

export interface SchedulerTickPayload {
  taskName: string;
  tick: number;
  durationMillis: number;
}

export interface HealthChangedPayload {
  component: string;
  from: string;
  to: string;
  detail: string | null;
}

export interface FeedConnectivityPayload {
  feedId: string;
  endpointLabel: string;
  detail: string | null;
}

export interface ReplayStartedPayload {
  runId: string;
  fromIso: string | null;
  toIso: string | null;
  eventCount: number;
}

export interface ReplayCompletedPayload {
  runId: string;
  deterministic: boolean;
  eventCount: number;
  mismatchCount: number;
  digest: string;
}

export interface WindowClosedPayload {
  windowInstanceId: string;
  reason: string;
  closedAtIso: string;
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const item of Object.values(value as Record<string, unknown>)) freezeDeep(item);
  return Object.freeze(value);
}

export class PlatformEventPublisher {
  readonly published: EventEnvelope[] = [];

  constructor(
    private readonly factory: EventEnvelopeFactory,
    private readonly sink: EventSink,
  ) {}

  private async emit<TPayload>(
    type: PlatformEventType,
    reasonCode: ReasonCode,
    payload: TPayload,
    context: PlatformEventContext,
  ): Promise<EventEnvelope<TPayload>> {
    const envelope = this.factory.create<TPayload>({
      type,
      payload: freezeDeep(payload),
      reasonCode,
      source: SOURCE,
      correlationId: context.correlationId,
      ...(context.causationId ? { causationId: context.causationId } : {}),
      ...(context.marketInstanceId ? { marketInstanceId: context.marketInstanceId } : {}),
      ...(context.windowInstanceId ? { windowInstanceId: context.windowInstanceId } : {}),
      ...(context.executionIntentId ? { executionIntentId: context.executionIntentId } : {}),
    });
    await this.sink.append(envelope);
    this.published.push(envelope);
    return envelope;
  }

  tradeSettled(record: SettlementRecord, context: PlatformEventContext) {
    return this.emit(PLATFORM_EVENT_TYPES.tradeSettled, "PLT_TRADE_SETTLED", record, context);
  }

  ledgerRecorded(payload: LedgerRecordedPayload, context: PlatformEventContext) {
    return this.emit(PLATFORM_EVENT_TYPES.ledgerRecorded, "LDG_RECORDED", payload, context);
  }

  windowClosed(payload: WindowClosedPayload, context: PlatformEventContext) {
    return this.emit(PLATFORM_EVENT_TYPES.windowClosed, "PLT_WINDOW_CLOSED", payload, context);
  }

  schedulerTick(payload: SchedulerTickPayload, context: PlatformEventContext) {
    return this.emit(PLATFORM_EVENT_TYPES.schedulerTick, "PLT_SCHEDULER_TICK", payload, context);
  }

  healthChanged(payload: HealthChangedPayload, context: PlatformEventContext) {
    return this.emit(PLATFORM_EVENT_TYPES.healthChanged, "PLT_HEALTH_CHANGED", payload, context);
  }

  feedConnected(payload: FeedConnectivityPayload, context: PlatformEventContext) {
    return this.emit(PLATFORM_EVENT_TYPES.feedConnected, "PLT_FEED_CONNECTED", payload, context);
  }

  feedDisconnected(payload: FeedConnectivityPayload, context: PlatformEventContext) {
    return this.emit(
      PLATFORM_EVENT_TYPES.feedDisconnected,
      "PLT_FEED_DISCONNECTED",
      payload,
      context,
    );
  }

  replayStarted(payload: ReplayStartedPayload, context: PlatformEventContext) {
    return this.emit(PLATFORM_EVENT_TYPES.replayStarted, "RPL_STARTED", payload, context);
  }

  replayCompleted(payload: ReplayCompletedPayload, context: PlatformEventContext) {
    return this.emit(
      PLATFORM_EVENT_TYPES.replayCompleted,
      payload.deterministic ? "RPL_COMPLETED" : "RPL_DIVERGENCE",
      payload,
      context,
    );
  }
}
