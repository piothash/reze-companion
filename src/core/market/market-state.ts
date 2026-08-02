/**
 * ARC — Authoritative Market State (M1).
 *
 * The canonical runtime contract consumed by the (not-yet-existing) Decision
 * Domain. The latest runtime state is mutable; every published snapshot is
 * immutable and carries a monotonically increasing MarketStateVersion.
 */
import { type Clock } from "../shared/time";
import { marketConfigDigest, type MarketDomainConfig } from "./configuration";
import { MarketEventPublisher, type MarketEventContext } from "./events";
import {
  authoritativeMarketStateSchema,
  freezeDeep,
  type AuthoritativeMarketState,
  type ConditionedSignal,
  type ConfigurationSnapshotRef,
  type FeedFreshness,
  type MarketDescriptor,
  type MarketLifecycleState,
  type PtbSnapshot,
  type TwapSnapshot,
} from "./types";

export interface MarketStateInputs {
  descriptor: MarketDescriptor;
  lifecycle: MarketLifecycleState;
  freshness: FeedFreshness;
  twap: TwapSnapshot | null;
  signal: ConditionedSignal | null;
  ptb: PtbSnapshot | null;
}

export interface MarketStateStoreOptions {
  config: MarketDomainConfig;
  clock: Clock;
  /** Platform configuration reference carried into every snapshot. */
  configVersion: string;
  activeExecutionProfileId?: string | null;
  publisher?: MarketEventPublisher;
}

/**
 * Holds the mutable latest state for one market instance and publishes
 * immutable, versioned snapshots.
 */
export class AuthoritativeMarketStateStore {
  private version = 0;
  private latest: AuthoritativeMarketState | null = null;
  private readonly configurationRef: ConfigurationSnapshotRef;

  constructor(private readonly options: MarketStateStoreOptions) {
    this.configurationRef = Object.freeze({
      configVersion: options.configVersion,
      marketConfigVersion: options.config.marketConfigVersion,
      marketConfigDigest: marketConfigDigest(options.config),
      activeExecutionProfileId: options.activeExecutionProfileId ?? null,
    });
  }

  get current(): AuthoritativeMarketState | null {
    return this.latest;
  }

  get currentVersion(): number {
    return this.version;
  }

  get configurationSnapshotRef(): ConfigurationSnapshotRef {
    return this.configurationRef;
  }

  /** Builds, freezes and stores the next snapshot. Version always increases. */
  publish(inputs: MarketStateInputs): AuthoritativeMarketState {
    this.version += 1;
    const snapshot = freezeDeep(
      authoritativeMarketStateSchema.parse({
        marketInstanceId: inputs.descriptor.marketInstanceId,
        marketStateVersion: this.version,
        timestampIso: this.options.clock.isoNow(),
        lifecycle: inputs.lifecycle,
        descriptor: inputs.descriptor,
        freshness: inputs.freshness,
        twap: inputs.twap,
        signal: inputs.signal,
        ptb: inputs.ptb,
        configuration: this.configurationRef,
      } satisfies AuthoritativeMarketState),
    );
    this.latest = snapshot;
    return snapshot;
  }

  /** Publishes and emits the AuthoritativeMarketStateUpdated event. */
  async publishAndEmit(
    inputs: MarketStateInputs,
    context: MarketEventContext,
  ): Promise<AuthoritativeMarketState> {
    const snapshot = this.publish(inputs);
    if (this.options.publisher) {
      await this.options.publisher.authoritativeMarketStateUpdated(snapshot, context);
    }
    return snapshot;
  }
}
