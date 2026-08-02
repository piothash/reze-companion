/**
 * ARC — Market State Domain canonical events (M1).
 *
 * Events only. Publishing an event never changes a trading outcome; the
 * companion observes the market, it does not act on it.
 */
import {
  type EventEnvelope,
  type EventEnvelopeFactory,
  type EventSink,
} from "../contracts/event-envelope";
import { type ReasonCode } from "../contracts/reason-codes";
import {
  type AuthoritativeMarketState,
  type ConditionedSignal,
  type MarketDescriptor,
  type MarketLifecycleState,
  type Observation,
  type PtbSnapshot,
  type TwapSnapshot,
  freezeDeep,
} from "./types";

export const MARKET_EVENT_TYPES = {
  observationReceived: "market.observation.received",
  twapUpdated: "market.twap.updated",
  ptbUpdated: "market.ptb.updated",
  signalConditioned: "market.signal.conditioned",
  lifecycleUpdated: "market.lifecycle.updated",
  stateUpdated: "market.state.updated",
  discovered: "market.discovery.completed",
} as const;

export type MarketEventType = (typeof MARKET_EVENT_TYPES)[keyof typeof MARKET_EVENT_TYPES];

export interface MarketLifecycleUpdatedPayload {
  from: MarketLifecycleState;
  to: MarketLifecycleState;
  reason: string;
}

const SOURCE = "market-state";

export interface MarketEventContext {
  correlationId: string;
  marketInstanceId: string;
  causationId?: string;
}

/**
 * Emits Market State Domain events through the frozen envelope factory into an
 * append-only sink. Every published payload is deep-frozen first.
 */
export class MarketEventPublisher {
  readonly published: EventEnvelope[] = [];

  constructor(
    private readonly factory: EventEnvelopeFactory,
    private readonly sink: EventSink,
  ) {}

  private async emit<TPayload>(
    type: MarketEventType,
    reasonCode: ReasonCode,
    payload: TPayload,
    context: MarketEventContext,
  ): Promise<EventEnvelope<TPayload>> {
    const envelope = this.factory.create<TPayload>({
      type,
      payload: freezeDeep(payload),
      reasonCode,
      source: SOURCE,
      correlationId: context.correlationId,
      ...(context.causationId ? { causationId: context.causationId } : {}),
      marketInstanceId: context.marketInstanceId,
    });
    await this.sink.append(envelope);
    this.published.push(envelope);
    return envelope;
  }

  marketDiscovered(descriptor: MarketDescriptor, context: MarketEventContext) {
    return this.emit(
      MARKET_EVENT_TYPES.discovered,
      descriptor.valid ? "MKT_DISCOVERED" : "MKT_METADATA_INVALID",
      descriptor,
      context,
    );
  }

  observationReceived(observation: Observation, context: MarketEventContext) {
    return this.emit(
      MARKET_EVENT_TYPES.observationReceived,
      "MKT_OBSERVATION_RECEIVED",
      observation,
      context,
    );
  }

  twapUpdated(snapshot: TwapSnapshot, context: MarketEventContext) {
    return this.emit(
      MARKET_EVENT_TYPES.twapUpdated,
      snapshot.value === null ? "MKT_TWAP_INSUFFICIENT_DATA" : "MKT_TWAP_UPDATED",
      snapshot,
      context,
    );
  }

  ptbUpdated(snapshot: PtbSnapshot, context: MarketEventContext) {
    return this.emit(
      MARKET_EVENT_TYPES.ptbUpdated,
      snapshot.valid ? "MKT_PTB_UPDATED" : "MKT_PTB_UNAVAILABLE",
      snapshot,
      context,
    );
  }

  signalConditioned(signal: ConditionedSignal, context: MarketEventContext) {
    return this.emit(
      MARKET_EVENT_TYPES.signalConditioned,
      signal.usable ? "MKT_SIGNAL_CONDITIONED" : "MKT_SIGNAL_UNUSABLE",
      signal,
      context,
    );
  }

  lifecycleUpdated(payload: MarketLifecycleUpdatedPayload, context: MarketEventContext) {
    return this.emit(
      MARKET_EVENT_TYPES.lifecycleUpdated,
      payload.to === "INVALID" ? "MKT_INVALIDATED" : "MKT_LIFECYCLE_UPDATED",
      payload,
      context,
    );
  }

  authoritativeMarketStateUpdated(state: AuthoritativeMarketState, context: MarketEventContext) {
    return this.emit(MARKET_EVENT_TYPES.stateUpdated, "MKT_STATE_PUBLISHED", state, context);
  }
}
