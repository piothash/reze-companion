/**
 * ARC — PTB Engine (M1).
 *
 * The price-to-beat comes from OFFICIAL market metadata only. Never the order
 * book, never an exchange price feed, never crowd sentiment. The engine
 * validates and owns the value; it never derives or infers one.
 */
import { type Clock } from "../shared/time";
import { type MarketDomainConfig } from "./configuration";
import { roundTo } from "./feed-engine";
import { freezeDeep, ptbSnapshotSchema, type MarketDescriptor, type PtbSnapshot } from "./types";

export class PtbEngine {
  private current: PtbSnapshot | null = null;

  constructor(
    private readonly config: MarketDomainConfig,
    private readonly clock: Clock,
  ) {}

  get snapshot(): PtbSnapshot | null {
    return this.current;
  }

  /** Validates the PTB carried by official market metadata. */
  resolve(descriptor: MarketDescriptor): PtbSnapshot {
    const { ptb } = this.config;
    const source = descriptor.ptbSource ?? null;
    let rejectionReason: string | null = null;
    let value: number | null = null;

    if (source === null || descriptor.ptbValue === undefined) {
      rejectionReason = `price-to-beat absent from ${ptb.source} field "${ptb.metadataField}"`;
    } else if (source.source !== ptb.source) {
      rejectionReason = `unauthorised PTB source "${source.source}"`;
    } else if (!Number.isFinite(descriptor.ptbValue)) {
      rejectionReason = "price-to-beat is not a finite number";
    } else if (descriptor.ptbValue < ptb.minValue || descriptor.ptbValue > ptb.maxValue) {
      rejectionReason = `price-to-beat ${descriptor.ptbValue} outside configured bounds [${ptb.minValue}, ${ptb.maxValue}]`;
    } else {
      value = roundTo(descriptor.ptbValue, ptb.precision);
    }

    this.current = freezeDeep(
      ptbSnapshotSchema.parse({
        value,
        precision: ptb.precision,
        valid: value !== null,
        source,
        rejectionReason,
        resolvedAtIso: this.clock.isoNow(),
      } satisfies PtbSnapshot),
    );
    return this.current;
  }
}
