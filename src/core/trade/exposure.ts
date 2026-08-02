/**
 * ARC — Exposure reservation model (M3).
 *
 * The single invariant this module exists to protect:
 *
 *     Reserved Exposure + Live Exposure ≤ Configured Exposure Limit
 *
 * Lifecycle: Reserve → Execution → Filled (commit to live exposure)
 *                              └→ Execution failed (release reservation)
 *
 * Reservations are never leaked: every reservation is either fully committed,
 * fully released, or split between the two, and `settle` is idempotent so a
 * duplicate terminal event after a restart cannot double-release.
 */
import { deterministicId } from "../shared/ids";
import { type Clock } from "../shared/time";
import {
  exposureReservationSchema,
  exposureSnapshotSchema,
  freezeDeep,
  type ExposureReservationRecord,
  type ExposureSnapshot,
} from "./types";

export interface ExposureLedgerOptions {
  marketInstanceId: string;
  /** Configured exposure limit; reserved + live may never exceed it. */
  limit: number;
  clock: Clock;
  /** Live exposure carried in from a previous run, if any. */
  initialLiveExposure?: number;
}

export interface ReserveRequest {
  executionIntentId: string;
  outcomeKey: string;
  amount: number;
}

export type ReserveResult =
  | { ok: true; reservation: ExposureReservationRecord }
  | { ok: false; reason: "LIMIT_EXCEEDED" | "DUPLICATE" | "INVALID_AMOUNT"; available: number };

const EPSILON = 1e-9;

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export class ExposureLedger {
  private readonly reservations = new Map<string, ExposureReservationRecord>();
  private liveExposure: number;

  constructor(private readonly options: ExposureLedgerOptions) {
    if (!(options.limit > 0)) {
      throw new Error(`Exposure limit must be positive, got ${options.limit}`);
    }
    this.liveExposure = Math.max(0, options.initialLiveExposure ?? 0);
  }

  get limit(): number {
    return this.options.limit;
  }

  get live(): number {
    return round(this.liveExposure);
  }

  get reserved(): number {
    let total = 0;
    for (const record of this.reservations.values()) total += record.reserved;
    return round(total);
  }

  get available(): number {
    return round(Math.max(0, this.limit - this.live - this.reserved));
  }

  reservation(executionIntentId: string): ExposureReservationRecord | undefined {
    return this.reservations.get(executionIntentId);
  }

  /** True when the invariant currently holds. Asserted after every mutation. */
  get invariantHolds(): boolean {
    return this.live + this.reserved <= this.limit + EPSILON;
  }

  private assertInvariant(): void {
    if (!this.invariantHolds) {
      throw new Error(
        `Exposure invariant violated: live ${this.live} + reserved ${this.reserved} > limit ${this.limit}`,
      );
    }
  }

  /** Reserves exposure for an intent. One reservation per execution intent. */
  reserve(request: ReserveRequest): ReserveResult {
    if (!Number.isFinite(request.amount) || request.amount <= 0) {
      return { ok: false, reason: "INVALID_AMOUNT", available: this.available };
    }
    if (this.reservations.has(request.executionIntentId)) {
      return { ok: false, reason: "DUPLICATE", available: this.available };
    }
    if (request.amount > this.available + EPSILON) {
      return { ok: false, reason: "LIMIT_EXCEEDED", available: this.available };
    }

    const record = exposureReservationSchema.parse({
      reservationId: deterministicId(
        "ExecutionIntentId",
        "reservation",
        this.options.marketInstanceId,
        request.executionIntentId,
      ),
      executionIntentId: request.executionIntentId,
      marketInstanceId: this.options.marketInstanceId,
      outcomeKey: request.outcomeKey,
      reserved: round(request.amount),
      committed: 0,
      released: 0,
      amount: round(request.amount),
      state: "RESERVED",
      reservedAtIso: this.options.clock.isoNow(),
      settledAtIso: null,
    } satisfies ExposureReservationRecord);

    this.reservations.set(request.executionIntentId, record);
    this.assertInvariant();
    return { ok: true, reservation: freezeDeep({ ...record }) };
  }

  /**
   * Converts part of a reservation into live exposure as fills arrive. Never
   * commits more than was reserved, so the invariant cannot be breached by a
   * venue over-fill; the surplus is reported by the return value.
   */
  commit(executionIntentId: string, amount: number): number {
    const record = this.reservations.get(executionIntentId);
    if (!record || amount <= 0) return 0;
    const applied = round(Math.min(record.reserved, amount));
    if (applied <= 0) return 0;
    record.reserved = round(record.reserved - applied);
    record.committed = round(record.committed + applied);
    this.liveExposure = round(this.liveExposure + applied);
    this.assertInvariant();
    return applied;
  }

  /**
   * Terminal settlement of a reservation: whatever is still reserved goes back
   * to the pool. Idempotent — a second call is a no-op, which is exactly what
   * makes restart-time replay of a terminal execution event safe.
   */
  settle(executionIntentId: string): ExposureReservationRecord | null {
    const record = this.reservations.get(executionIntentId);
    if (!record) return null;
    if (record.state !== "RESERVED") return freezeDeep({ ...record });

    const releasing = record.reserved;
    record.released = round(record.released + releasing);
    record.reserved = 0;
    record.state = record.committed > 0 ? "COMMITTED" : "RELEASED";
    record.settledAtIso = this.options.clock.isoNow();
    this.assertInvariant();
    return freezeDeep({ ...record });
  }

  /** Releases live exposure once a position is settled or closed upstream. */
  releaseLive(amount: number): number {
    const applied = round(Math.min(this.liveExposure, Math.max(0, amount)));
    this.liveExposure = round(this.liveExposure - applied);
    return applied;
  }

  /** Reservations that are still holding capacity. */
  openReservations(): readonly ExposureReservationRecord[] {
    return [...this.reservations.values()].filter((record) => record.state === "RESERVED");
  }

  snapshot(): ExposureSnapshot {
    return freezeDeep(
      exposureSnapshotSchema.parse({
        marketInstanceId: this.options.marketInstanceId,
        limit: this.limit,
        live: this.live,
        reserved: this.reserved,
        available: this.available,
        reservations: [...this.reservations.values()]
          .map((record) => ({ ...record }))
          .sort((a, b) => (a.reservationId < b.reservationId ? -1 : 1)),
      } satisfies ExposureSnapshot),
    );
  }

  /** Rebuilds the ledger after a restart. Never leaks and never double-counts. */
  static restore(options: ExposureLedgerOptions, snapshot: ExposureSnapshot): ExposureLedger {
    const ledger = new ExposureLedger({ ...options, initialLiveExposure: snapshot.live });
    for (const record of snapshot.reservations) {
      ledger.reservations.set(record.executionIntentId, { ...record });
    }
    ledger.assertInvariant();
    return ledger;
  }
}
