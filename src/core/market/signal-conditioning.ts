/**
 * ARC — Signal Conditioning (M1).
 *
 * Owns the Effective TWAP: a configuration-driven, deterministic conditioning
 * of the running TWAP. It produces NO decisions, no sides, no thresholds and no
 * strategy output — only a cleaned market input for the Decision Domain, which
 * does not exist in this milestone.
 */
import { type Clock } from "../shared/time";
import { type MarketDomainConfig } from "./configuration";
import { roundTo } from "./feed-engine";
import {
  conditionedSignalSchema,
  freezeDeep,
  type ConditionedSignal,
  type TwapSnapshot,
} from "./types";

export class SignalConditioning {
  private current: ConditionedSignal | null = null;

  constructor(
    private readonly config: MarketDomainConfig,
    private readonly clock: Clock,
  ) {}

  get snapshot(): ConditionedSignal | null {
    return this.current;
  }

  /** Conditions a TWAP snapshot into an effective TWAP. */
  condition(twap: TwapSnapshot | null): ConditionedSignal {
    const { signal } = this.config;
    const appliedSteps: string[] = [];
    let rejectionReason: string | null = null;
    let effectiveTwap: number | null = null;

    const rawTwap = twap?.value ?? null;

    if (!twap || rawTwap === null) {
      rejectionReason = "running TWAP unavailable";
    } else if (twap.observationCount < signal.minObservations) {
      rejectionReason = `observation count ${twap.observationCount} below configured minimum ${signal.minObservations}`;
    } else if (signal.requireFreshFeed && twap.freshness.state !== "FRESH") {
      rejectionReason = `feed is ${twap.freshness.state}`;
    } else {
      let working = rawTwap;
      appliedSteps.push("running-twap");
      if (signal.offset !== 0) {
        working += signal.offset;
        appliedSteps.push(`offset:${signal.offset}`);
      }
      effectiveTwap = roundTo(working, signal.precision);
      appliedSteps.push(`precision:${signal.precision}`);
    }

    this.current = freezeDeep(
      conditionedSignalSchema.parse({
        effectiveTwap,
        rawTwap,
        precision: signal.precision,
        usable: effectiveTwap !== null,
        appliedSteps,
        rejectionReason,
        conditionedAtIso: this.clock.isoNow(),
      } satisfies ConditionedSignal),
    );
    return this.current;
  }
}
