/**
 * ARC — Decision Domain canonical events (M2).
 *
 * Events only, published through the frozen Event Envelope. Publishing an
 * event never executes anything: the VPS remains the sole trading authority.
 */
import {
  type EventEnvelope,
  type EventEnvelopeFactory,
  type EventSink,
} from "../contracts/event-envelope";
import { type ReasonCode } from "../contracts/reason-codes";
import {
  freezeDeep,
  type Decision,
  type ExecutionIntent,
  type TradeQuotaSnapshot,
  type WindowCompletionReason,
  type WindowInstanceSnapshot,
} from "./types";

export const DECISION_EVENT_TYPES = {
  windowOpened: "decision.window.opened",
  windowActivated: "decision.window.activated",
  windowEvaluated: "decision.window.evaluated",
  windowCompleted: "decision.window.completed",
  executionIntentCreated: "decision.intent.created",
  tradeQuotaConsumed: "decision.quota.consumed",
} as const;

export type DecisionEventType = (typeof DECISION_EVENT_TYPES)[keyof typeof DECISION_EVENT_TYPES];

const SOURCE = "decision";

export interface DecisionEventContext {
  correlationId: string;
  marketInstanceId: string;
  windowInstanceId?: string;
  executionIntentId?: string;
  causationId?: string;
}

export interface WindowCompletedPayload {
  window: WindowInstanceSnapshot;
  completionReason: WindowCompletionReason;
}

export interface TradeQuotaConsumedPayload {
  windowInstanceId: string;
  executionIntentId: string;
  quota: TradeQuotaSnapshot;
}

export class DecisionEventPublisher {
  readonly published: EventEnvelope[] = [];

  constructor(
    private readonly factory: EventEnvelopeFactory,
    private readonly sink: EventSink,
  ) {}

  private async emit<TPayload>(
    type: DecisionEventType,
    reasonCode: ReasonCode,
    payload: TPayload,
    context: DecisionEventContext,
  ): Promise<EventEnvelope<TPayload>> {
    const envelope = this.factory.create<TPayload>({
      type,
      payload: freezeDeep(payload),
      reasonCode,
      source: SOURCE,
      correlationId: context.correlationId,
      ...(context.causationId ? { causationId: context.causationId } : {}),
      marketInstanceId: context.marketInstanceId,
      ...(context.windowInstanceId ? { windowInstanceId: context.windowInstanceId } : {}),
      ...(context.executionIntentId ? { executionIntentId: context.executionIntentId } : {}),
    });
    await this.sink.append(envelope);
    this.published.push(envelope);
    return envelope;
  }

  windowOpened(window: WindowInstanceSnapshot, context: DecisionEventContext) {
    return this.emit(DECISION_EVENT_TYPES.windowOpened, "DEC_WINDOW_OPENED", window, context);
  }

  windowActivated(window: WindowInstanceSnapshot, context: DecisionEventContext) {
    return this.emit(DECISION_EVENT_TYPES.windowActivated, "DEC_WINDOW_ACTIVATED", window, context);
  }

  windowEvaluated(decision: Decision, context: DecisionEventContext) {
    const reason: ReasonCode =
      decision.outcome === "BUY_UP"
        ? "DEC_SIGNAL_UP"
        : decision.outcome === "BUY_DOWN"
          ? "DEC_SIGNAL_DOWN"
          : "DEC_NO_SIGNAL";
    return this.emit(DECISION_EVENT_TYPES.windowEvaluated, reason, decision, context);
  }

  windowCompleted(payload: WindowCompletedPayload, context: DecisionEventContext) {
    const reason: ReasonCode =
      payload.completionReason === "EXPIRED"
        ? "DEC_WINDOW_EXPIRED"
        : payload.completionReason === "CANCELLED"
          ? "DEC_WINDOW_CANCELLED"
          : payload.completionReason === "QUOTA_EXHAUSTED"
            ? "DEC_QUOTA_DEPLETED"
            : "DEC_WINDOW_COMPLETED";
    return this.emit(DECISION_EVENT_TYPES.windowCompleted, reason, payload, context);
  }

  executionIntentCreated(intent: ExecutionIntent, context: DecisionEventContext) {
    return this.emit(
      DECISION_EVENT_TYPES.executionIntentCreated,
      "DEC_INTENT_CREATED",
      intent,
      context,
    );
  }

  tradeQuotaConsumed(payload: TradeQuotaConsumedPayload, context: DecisionEventContext) {
    return this.emit(
      DECISION_EVENT_TYPES.tradeQuotaConsumed,
      "DEC_QUOTA_CONSUMED",
      payload,
      context,
    );
  }
}
