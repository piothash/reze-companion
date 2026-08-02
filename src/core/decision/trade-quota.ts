/**
 * ARC — Trade Quota (M2).
 *
 * Trade Quota, not "trade budget". It belongs to the Execution Context, is
 * monotonically decreasing, never negative and never replenished. Quota is
 * always checked BEFORE the Decision Engine is invoked.
 */
import { freezeDeep, tradeQuotaSnapshotSchema, type TradeQuotaSnapshot } from "./types";

export class TradeQuota {
  private remainingCount: number;

  constructor(readonly initial: number) {
    if (!Number.isInteger(initial) || initial < 0) {
      throw new Error(`Trade quota must be a non-negative integer, got ${initial}`);
    }
    this.remainingCount = initial;
  }

  get remaining(): number {
    return this.remainingCount;
  }

  get consumed(): number {
    return this.initial - this.remainingCount;
  }

  get exhausted(): boolean {
    return this.remainingCount <= 0;
  }

  /** Consumes exactly one unit. Returns false when nothing remains. */
  consume(): boolean {
    if (this.remainingCount <= 0) return false;
    this.remainingCount -= 1;
    return true;
  }

  snapshot(): TradeQuotaSnapshot {
    return freezeDeep(
      tradeQuotaSnapshotSchema.parse({
        initial: this.initial,
        remaining: this.remainingCount,
        consumed: this.consumed,
      } satisfies TradeQuotaSnapshot),
    );
  }

  /** Rebuilds quota state after a restart from a persisted snapshot. */
  static restore(snapshot: TradeQuotaSnapshot): TradeQuota {
    const quota = new TradeQuota(snapshot.initial);
    quota.remainingCount = Math.max(0, Math.min(snapshot.initial, snapshot.remaining));
    return quota;
  }
}
