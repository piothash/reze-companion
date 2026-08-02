/**
 * ARC — Trade Domain canonical events (M3).
 *
 * Published through the frozen Event Envelope. Events are observations, never
 * instructions: emitting one never changes a trading outcome.
 */
import {
  type EventEnvelope,
  type EventEnvelopeFactory,
  type EventSink,
} from "../contracts/event-envelope";
import { type ReasonCode } from "../contracts/reason-codes";
import {
  freezeDeep,
  type ExecutionFailureReason,
  type ExecutionReport,
  type ExposureReservationRecord,
  type ExposureSnapshot,
  type Fill,
  type OrderSnapshot,
  type RiskVerdict,
} from "./types";
import { riskDenialReasonCode } from "./risk-engine";

export const TRADE_EVENT_TYPES = {
  riskApproved: "trade.risk.approved",
  riskDenied: "trade.risk.denied",
  exposureReserved: "trade.exposure.reserved",
  exposureReleased: "trade.exposure.released",
  orderSubmitted: "trade.order.submitted",
  orderUpdated: "trade.order.updated",
  orderFilled: "trade.order.filled",
  orderCancelled: "trade.order.cancelled",
  executionCompleted: "trade.execution.completed",
  executionFailed: "trade.execution.failed",
  tradeQuotaConsumed: "trade.quota.consumed",
} as const;

export type TradeEventType = (typeof TRADE_EVENT_TYPES)[keyof typeof TRADE_EVENT_TYPES];

const SOURCE = "trade";

export interface TradeEventContext {
  correlationId: string;
  marketInstanceId: string;
  executionIntentId: string;
  windowInstanceId?: string;
  causationId?: string;
}

export interface ExposureReservedPayload {
  reservation: ExposureReservationRecord;
  exposure: ExposureSnapshot;
}

export interface ExposureReleasedPayload {
  reservation: ExposureReservationRecord;
  exposure: ExposureSnapshot;
  /** Why the reservation stopped holding capacity. */
  reason: "EXECUTION_COMPLETED" | "EXECUTION_FAILED" | "CANCELLED";
}

export interface OrderFilledPayload {
  order: OrderSnapshot;
  fill: Fill;
  cumulativeFilledQuantity: number;
  complete: boolean;
}

export interface TradeQuotaConsumedPayload {
  executionIntentId: string;
  /** Cumulative executed quantity at the moment quota was consumed. */
  cumulativeFilledQuantity: number;
  minMeaningfulQuantity: number;
}

export interface ExecutionFailedPayload {
  report: ExecutionReport;
  failureReason: ExecutionFailureReason;
}

export class TradeEventPublisher {
  readonly published: EventEnvelope[] = [];

  constructor(
    private readonly factory: EventEnvelopeFactory,
    private readonly sink: EventSink,
  ) {}

  private async emit<TPayload>(
    type: TradeEventType,
    reasonCode: ReasonCode,
    payload: TPayload,
    context: TradeEventContext,
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
      executionIntentId: context.executionIntentId,
    });
    await this.sink.append(envelope);
    this.published.push(envelope);
    return envelope;
  }

  riskApproved(verdict: RiskVerdict, context: TradeEventContext) {
    return this.emit(TRADE_EVENT_TYPES.riskApproved, "RSK_APPROVED", verdict, context);
  }

  riskDenied(verdict: RiskVerdict, context: TradeEventContext) {
    const reason: ReasonCode = verdict.deniedBy
      ? riskDenialReasonCode(verdict.deniedBy)
      : "RSK_DENIED_POLICY";
    return this.emit(TRADE_EVENT_TYPES.riskDenied, reason, verdict, context);
  }

  exposureReserved(payload: ExposureReservedPayload, context: TradeEventContext) {
    return this.emit(
      TRADE_EVENT_TYPES.exposureReserved,
      "RSK_EXPOSURE_RESERVED",
      payload,
      context,
    );
  }

  exposureReleased(payload: ExposureReleasedPayload, context: TradeEventContext) {
    const reason: ReasonCode =
      payload.reservation.committed > 0 ? "RSK_EXPOSURE_COMMITTED" : "RSK_EXPOSURE_RELEASED";
    return this.emit(TRADE_EVENT_TYPES.exposureReleased, reason, payload, context);
  }

  orderSubmitted(order: OrderSnapshot, context: TradeEventContext) {
    return this.emit(TRADE_EVENT_TYPES.orderSubmitted, "EXE_ORDER_SUBMITTED", order, context);
  }

  orderUpdated(order: OrderSnapshot, context: TradeEventContext, reasonCode?: ReasonCode) {
    return this.emit(
      TRADE_EVENT_TYPES.orderUpdated,
      reasonCode ?? "EXE_ORDER_UPDATED",
      order,
      context,
    );
  }

  orderFilled(payload: OrderFilledPayload, context: TradeEventContext) {
    return this.emit(
      TRADE_EVENT_TYPES.orderFilled,
      payload.complete ? "EXE_ORDER_FILLED" : "EXE_ORDER_PARTIALLY_FILLED",
      payload,
      context,
    );
  }

  orderCancelled(order: OrderSnapshot, context: TradeEventContext) {
    return this.emit(TRADE_EVENT_TYPES.orderCancelled, "EXE_ORDER_CANCELLED", order, context);
  }

  tradeQuotaConsumed(payload: TradeQuotaConsumedPayload, context: TradeEventContext) {
    return this.emit(
      TRADE_EVENT_TYPES.tradeQuotaConsumed,
      "EXE_QUOTA_COMMITTED",
      payload,
      context,
    );
  }

  executionCompleted(report: ExecutionReport, context: TradeEventContext) {
    return this.emit(TRADE_EVENT_TYPES.executionCompleted, "EXE_COMPLETED", report, context);
  }

  executionFailed(payload: ExecutionFailedPayload, context: TradeEventContext) {
    const reason: ReasonCode =
      payload.failureReason === "RETRY_EXHAUSTED"
        ? "EXE_RETRY_EXHAUSTED"
        : payload.failureReason === "TIMEOUT"
          ? "EXE_UPSTREAM_TIMEOUT"
          : payload.failureReason === "REJECTED"
            ? "EXE_ORDER_REJECTED"
            : "EXE_FAILED";
    return this.emit(TRADE_EVENT_TYPES.executionFailed, reason, payload, context);
  }
}
