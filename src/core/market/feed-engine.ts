/**
 * ARC — Feed Engine (M1).
 *
 * Provider-agnostic observation ingestion. The provider, feed id, network,
 * interval, staleness budget and precision all come from configuration, so a
 * testnet → mainnet switch is an environment change only.
 */
import { fromIsoUtc, toIsoUtc, type Clock } from "../shared/time";
import { type MarketDomainConfig } from "./configuration";
import {
  observationSchema,
  type FeedFreshness,
  type FeedFreshnessState,
  type Observation,
} from "./types";

/** Deterministic half-up rounding to a fixed number of decimals. */
export function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  const scaled = value * factor;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
  return rounded / factor;
}

export interface RawFeedSample {
  value: number;
  /** Provider-reported observation time (ISO-8601 UTC or epoch millis). */
  observedAt: string | number;
}

export interface FeedProvider {
  readonly kind: string;
  sample(): Promise<RawFeedSample>;
}

export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedError";
  }
}

function readPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((accumulator, segment) => {
    if (accumulator === null || typeof accumulator !== "object") return undefined;
    return (accumulator as Record<string, unknown>)[segment];
  }, source);
}

/** Configuration-driven HTTP JSON feed provider (V1 testnet and mainnet). */
export class HttpJsonFeedProvider implements FeedProvider {
  readonly kind = "http-json";

  constructor(
    private readonly config: MarketDomainConfig,
    private readonly httpFetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>,
  ) {}

  endpoint(): string {
    const template = this.config.feed.endpointTemplate;
    if (!template) throw new FeedError("TWAP_FEED_ENDPOINT is required for the http-json provider");
    return template
      .replaceAll("{feedId}", encodeURIComponent(this.config.feed.feedId))
      .replaceAll("{network}", encodeURIComponent(this.config.feed.network));
  }

  async sample(): Promise<RawFeedSample> {
    const response = await this.httpFetch(this.endpoint(), {
      signal: AbortSignal.timeout(this.config.feed.requestTimeoutMillis),
    });
    if (!response.ok) throw new FeedError(`feed request failed: ${response.status}`);
    const body: unknown = await response.json();
    const value = Number(readPath(body, this.config.feed.valuePath));
    if (!Number.isFinite(value)) throw new FeedError("feed response has no finite value");
    const observedAtRaw = readPath(body, this.config.feed.timestampPath);
    const observedAt =
      typeof observedAtRaw === "string" || typeof observedAtRaw === "number"
        ? observedAtRaw
        : Date.now();
    return { value, observedAt };
  }
}

/** Deterministic provider for tests and replay. */
export class InMemoryFeedProvider implements FeedProvider {
  readonly kind = "in-memory";
  private index = 0;

  constructor(private readonly samples: readonly RawFeedSample[]) {}

  async sample(): Promise<RawFeedSample> {
    const sample = this.samples[this.index];
    if (!sample) throw new FeedError("in-memory feed exhausted");
    this.index += 1;
    return sample;
  }
}

export function createFeedProvider(
  config: MarketDomainConfig,
  deps: {
    httpFetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
    samples?: readonly RawFeedSample[];
  } = {},
): FeedProvider {
  if (config.feed.provider === "in-memory") return new InMemoryFeedProvider(deps.samples ?? []);
  if (!deps.httpFetch) throw new FeedError("http-json feed provider requires an http client");
  return new HttpJsonFeedProvider(config, deps.httpFetch);
}

export interface FeedIngestResult {
  accepted: boolean;
  observation: Observation | null;
  rejectionReason: string | null;
  freshness: FeedFreshness;
}

/**
 * Owns observation ingestion, ordering and freshness. It holds no view on what
 * an observation means — only whether it is well-formed, ordered and fresh.
 */
export class FeedEngine {
  private sequence = 0;
  private last: Observation | null = null;
  private lastFreshness: FeedFreshnessState = "UNAVAILABLE";

  constructor(
    private readonly config: MarketDomainConfig,
    private readonly clock: Clock,
    private readonly provider: FeedProvider,
  ) {}

  get latest(): Observation | null {
    return this.last;
  }

  /** True when the configured observation interval has elapsed. */
  shouldSample(): boolean {
    if (!this.last) return true;
    return this.clock.now() - fromIsoUtc(this.last.receivedAtIso) >= this.config.feed.observationIntervalMillis;
  }

  /** Pulls one sample from the provider and ingests it. */
  async poll(): Promise<FeedIngestResult> {
    try {
      const sample = await this.provider.sample();
      return this.ingest(sample);
    } catch (error) {
      return {
        accepted: false,
        observation: null,
        rejectionReason: error instanceof Error ? error.message : "feed sample failed",
        freshness: this.freshness(),
      };
    }
  }

  /** Ingests an already-obtained raw sample (deterministic entry point). */
  ingest(sample: RawFeedSample): FeedIngestResult {
    const { feed } = this.config;
    const observedAtMillis =
      typeof sample.observedAt === "number" ? sample.observedAt : safeParseIso(sample.observedAt);

    if (observedAtMillis === null || !Number.isFinite(sample.value)) {
      return this.reject("malformed observation");
    }
    if (this.last && observedAtMillis < fromIsoUtc(this.last.observedAtIso)) {
      return this.reject("out-of-order observation");
    }

    const observation = observationSchema.parse({
      feedId: feed.feedId,
      provider: this.provider.kind,
      network: feed.network,
      value: roundTo(sample.value, feed.precision),
      observedAtIso: toIsoUtc(observedAtMillis),
      receivedAtIso: this.clock.isoNow(),
      sequence: this.sequence,
    } satisfies Observation);

    this.sequence += 1;
    this.last = observation;
    return {
      accepted: true,
      observation,
      rejectionReason: null,
      freshness: this.freshness(),
    };
  }

  /** Current freshness verdict; also tracks STALE → FRESH recovery. */
  freshness(): FeedFreshness {
    const maxStalenessMillis = this.config.feed.maxStalenessMillis;
    if (!this.last) {
      this.lastFreshness = "UNAVAILABLE";
      return { state: "UNAVAILABLE", ageMillis: null, maxStalenessMillis, lastObservedAtIso: null };
    }
    const ageMillis = Math.max(0, this.clock.now() - fromIsoUtc(this.last.observedAtIso));
    const state: FeedFreshnessState = ageMillis <= maxStalenessMillis ? "FRESH" : "STALE";
    this.lastFreshness = state;
    return {
      state,
      ageMillis,
      maxStalenessMillis,
      lastObservedAtIso: this.last.observedAtIso,
    };
  }

  get freshnessState(): FeedFreshnessState {
    return this.lastFreshness;
  }

  private reject(reason: string): FeedIngestResult {
    return {
      accepted: false,
      observation: null,
      rejectionReason: reason,
      freshness: this.freshness(),
    };
  }
}

function safeParseIso(value: string): number | null {
  try {
    return fromIsoUtc(value);
  } catch {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
