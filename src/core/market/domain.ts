/**
 * ARC — Market State Domain coordinator (M1).
 *
 * Wires Discovery → Lifecycle → Feed → TWAP → PTB → Signal Conditioning →
 * Authoritative Market State, and publishes canonical events at every step.
 * It contains no trading logic: no sides, no intents, no orders, no risk.
 */
import { EventEnvelopeFactory, type EventSink } from "../contracts/event-envelope";
import { Ids } from "../shared/ids";
import { type Clock } from "../shared/time";
import { type MarketDomainConfig } from "./configuration";
import { MarketDiscoveryService, type HttpFetch } from "./discovery";
import { MarketEventPublisher } from "./events";
import { FeedEngine, createFeedProvider, type FeedProvider, type RawFeedSample } from "./feed-engine";
import { MarketLifecycleEngine } from "./lifecycle";
import { AuthoritativeMarketStateStore } from "./market-state";
import { PtbEngine } from "./ptb-engine";
import { SignalConditioning } from "./signal-conditioning";
import { type AuthoritativeMarketState, type MarketDescriptor } from "./types";

export interface MarketDomainOptions {
  config: MarketDomainConfig;
  clock: Clock;
  sink: EventSink;
  configVersion: string;
  activeExecutionProfileId?: string | null;
  httpFetch?: HttpFetch;
  feedProvider?: FeedProvider;
  samples?: readonly RawFeedSample[];
}

export class MarketStateDomain {
  readonly discovery: MarketDiscoveryService | null;
  readonly feed: FeedEngine;
  readonly twap: import("./twap-engine").TwapEngine;
  readonly ptb: PtbEngine;
  readonly signal: SignalConditioning;
  readonly lifecycle: MarketLifecycleEngine;
  readonly state: AuthoritativeMarketStateStore;
  readonly events: MarketEventPublisher;

  private descriptor: MarketDescriptor | null = null;
  private readonly correlationId: string;

  constructor(private readonly options: MarketDomainOptions) {
    const { config, clock } = options;
    const factory = new EventEnvelopeFactory(clock, "market-state");
    this.events = new MarketEventPublisher(factory, options.sink);
    this.discovery = options.httpFetch
      ? new MarketDiscoveryService({ config, clock, httpFetch: options.httpFetch })
      : null;
    const provider =
      options.feedProvider ??
      createFeedProvider(config, {
        ...(options.httpFetch ? { httpFetch: options.httpFetch } : {}),
        ...(options.samples ? { samples: options.samples } : {}),
      });
    this.feed = new FeedEngine(config, clock, provider);
    // Lazy import avoided: TwapEngine is a plain class in the same domain.
    this.twap = new (require0().TwapEngine)(config, clock);
    this.ptb = new PtbEngine(config, clock);
    this.signal = new SignalConditioning(config, clock);
    this.lifecycle = new MarketLifecycleEngine(config, clock);
    this.state = new AuthoritativeMarketStateStore({
      config,
      clock,
      configVersion: options.configVersion,
      activeExecutionProfileId: options.activeExecutionProfileId ?? null,
      publisher: this.events,
    });
    this.correlationId = Ids.correlation("market-state", config.feed.network, config.feed.feedId);
  }

  private context(marketInstanceId: string) {
    return { correlationId: this.correlationId, marketInstanceId };
  }

  /** Adopts a descriptor (from discovery or a recorded replay) and publishes it. */
  async adopt(descriptor: MarketDescriptor): Promise<void> {
    this.descriptor = descriptor;
    await this.events.marketDiscovered(descriptor, this.context(descriptor.marketInstanceId));
    await this.applyLifecycle(descriptor);
    await this.events.ptbUpdated(this.ptb.resolve(descriptor), this.context(descriptor.marketInstanceId));
  }

  /** Ingests one raw observation and refreshes every derived snapshot. */
  async ingest(sample: RawFeedSample): Promise<AuthoritativeMarketState | null> {
    if (!this.descriptor) return null;
    const descriptor = this.descriptor;
    const context = this.context(descriptor.marketInstanceId);

    const result = this.feed.ingest(sample);
    if (result.accepted && result.observation) {
      this.twap.add(result.observation);
      await this.events.observationReceived(result.observation, context);
    }

    const freshness = this.feed.freshness();
    const twapSnapshot = this.twap.snapshot(freshness);
    await this.events.twapUpdated(twapSnapshot, context);

    const conditioned = this.signal.condition(twapSnapshot);
    await this.events.signalConditioned(conditioned, context);

    await this.applyLifecycle(descriptor);

    return this.state.publishAndEmit(
      {
        descriptor,
        lifecycle: this.lifecycle.state,
        freshness,
        twap: twapSnapshot,
        signal: conditioned,
        ptb: this.ptb.snapshot,
      },
      context,
    );
  }

  private async applyLifecycle(descriptor: MarketDescriptor): Promise<void> {
    const evaluation = this.lifecycle.evaluate(descriptor);
    if (!evaluation.changed) return;
    await this.events.lifecycleUpdated(
      { from: evaluation.from, to: evaluation.to, reason: evaluation.reason },
      this.context(descriptor.marketInstanceId),
    );
  }
}

// Static import kept out of the constructor path only for clarity of layering.
function require0() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { TwapEngine } as { TwapEngine: typeof TwapEngine };
}

import { TwapEngine } from "./twap-engine";
