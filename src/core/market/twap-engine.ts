/**
 * ARC — TWAP Engine (M1).
 *
 * Owns the observation basket, running TWAP, timestamps, freshness reference,
 * stale detection, precision and immutable snapshots. Deterministic: the same
 * observation sequence always produces the same TWAP value. No strategy logic.
 */
import { fromIsoUtc, type Clock } from "../shared/time";
import { type MarketDomainConfig } from "./configuration";
import { roundTo } from "./feed-engine";
import { twapSnapshotSchema, freezeDeep, type FeedFreshness, type Observation, type TwapSnapshot } from "./types";

/**
 * Time-weighted average across a basket. Each observation's value is weighted
 * by the interval until the next observation; the newest observation is
 * weighted to the basket end. A single observation averages to itself.
 */
export function computeTimeWeightedAverage(
  observations: readonly Observation[],
  basketEndMillis: number,
  precision: number,
): number | null {
  if (observations.length === 0) return null;
  if (observations.length === 1) return roundTo(observations[0]!.value, precision);

  let weighted = 0;
  let totalWeight = 0;
  for (let index = 0; index < observations.length; index += 1) {
    const current = observations[index]!;
    const start = fromIsoUtc(current.observedAtIso);
    const next = observations[index + 1];
    const end = next ? fromIsoUtc(next.observedAtIso) : basketEndMillis;
    const weight = Math.max(0, end - start);
    weighted += current.value * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    // Degenerate basket (all observations share a timestamp): unweighted mean.
    const sum = observations.reduce((accumulator, item) => accumulator + item.value, 0);
    return roundTo(sum / observations.length, precision);
  }
  return roundTo(weighted / totalWeight, precision);
}

export class TwapEngine {
  private readonly basket: Observation[] = [];

  constructor(
    private readonly config: MarketDomainConfig,
    private readonly clock: Clock,
  ) {}

  /** Immutable view of the current basket. */
  observations(): readonly Observation[] {
    return [...this.basket];
  }

  get size(): number {
    return this.basket.length;
  }

  /** Adds an observation, evicting anything outside the configured window. */
  add(observation: Observation): void {
    this.basket.push(observation);
    this.evict();
  }

  /** Produces an immutable TWAP snapshot for the current basket. */
  snapshot(freshness: FeedFreshness): TwapSnapshot {
    this.evict();
    const { twap } = this.config;
    const enoughObservations = this.basket.length >= twap.minObservations;
    const usableFeed = freshness.state !== "UNAVAILABLE";
    const value =
      enoughObservations && usableFeed
        ? computeTimeWeightedAverage(this.basket, this.clock.now(), twap.precision)
        : null;

    const first = this.basket[0];
    const last = this.basket[this.basket.length - 1];

    return freezeDeep(
      twapSnapshotSchema.parse({
        value,
        windowSeconds: twap.windowSeconds,
        precision: twap.precision,
        observationCount: this.basket.length,
        windowStartIso: first ? first.observedAtIso : null,
        windowEndIso: last ? last.observedAtIso : null,
        freshness,
        computedAtIso: this.clock.isoNow(),
      } satisfies TwapSnapshot),
    );
  }

  /** Drops observations older than the window and enforces the basket cap. */
  private evict(): void {
    const { twap } = this.config;
    const cutoff = this.clock.now() - twap.windowSeconds * 1000;
    while (this.basket.length > 0 && fromIsoUtc(this.basket[0]!.observedAtIso) < cutoff) {
      this.basket.shift();
    }
    while (this.basket.length > twap.maxObservations) this.basket.shift();
  }
}
