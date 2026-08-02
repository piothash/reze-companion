/**
 * ARC — authoritative time abstraction (P0/M0).
 *
 * Charter rule: every ARC surface is UTC-only and no engine may call
 * `Date.now()` directly. All wall-clock and monotonic reads go through a
 * `Clock`, so replay can substitute a deterministic implementation.
 */

/** Milliseconds since the Unix epoch, UTC. */
export type EpochMillis = number;

/** Monotonic reading in milliseconds; comparable only against itself. */
export type MonotonicMillis = number;

export interface Clock {
  /** Wall-clock reading, UTC, milliseconds since epoch. */
  now(): EpochMillis;
  /** Monotonic reading; never decreases, unaffected by wall-clock jumps. */
  monotonic(): MonotonicMillis;
  /** ISO-8601 UTC timestamp with millisecond precision (always `Z`). */
  isoNow(): string;
}

export function toIsoUtc(epochMillis: EpochMillis): string {
  return new Date(epochMillis).toISOString();
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Parses an ISO-8601 timestamp. UTC only: offsets are rejected, not shifted. */
export function fromIsoUtc(iso: string): EpochMillis {
  if (!ISO_UTC.test(iso)) throw new Error(`Invalid ISO-8601 UTC timestamp: ${iso}`);
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) throw new Error(`Invalid ISO-8601 UTC timestamp: ${iso}`);
  return parsed;
}

/** Production clock. The only place in ARC allowed to read the host clock. */
export class SystemClock implements Clock {
  private readonly origin = Date.now();
  private readonly originHr =
    typeof performance !== "undefined" ? performance.now() : 0;

  now(): EpochMillis {
    return Date.now();
  }

  monotonic(): MonotonicMillis {
    if (typeof performance !== "undefined") return performance.now() - this.originHr;
    return Date.now() - this.origin;
  }

  isoNow(): string {
    return toIsoUtc(this.now());
  }
}

/**
 * Deterministic clock for tests and replay. Time only advances when the caller
 * advances it, which is what makes replay reproducible.
 */
export class FixedClock implements Clock {
  private wall: EpochMillis;
  private mono: MonotonicMillis;

  constructor(start: EpochMillis | string = 0, monotonicStart: MonotonicMillis = 0) {
    this.wall = typeof start === "string" ? fromIsoUtc(start) : start;
    this.mono = monotonicStart;
  }

  now(): EpochMillis {
    return this.wall;
  }

  monotonic(): MonotonicMillis {
    return this.mono;
  }

  isoNow(): string {
    return toIsoUtc(this.wall);
  }

  advance(millis: number): void {
    if (millis < 0) throw new Error("FixedClock cannot move backwards");
    this.wall += millis;
    this.mono += millis;
  }

  set(epochMillis: EpochMillis): void {
    this.wall = epochMillis;
  }
}

export interface ClockSkew {
  /** remote - local, in milliseconds. Positive means the remote clock is ahead. */
  offsetMillis: number;
  withinTolerance: boolean;
  toleranceMillis: number;
}

/**
 * Measures skew between the companion clock and an authoritative remote clock
 * (the VPS engine). ARC never silently corrects skew; it reports it.
 */
export function measureClockSkew(
  localNow: EpochMillis,
  remoteNow: EpochMillis,
  toleranceMillis: number,
): ClockSkew {
  const offsetMillis = remoteNow - localNow;
  return {
    offsetMillis,
    toleranceMillis,
    withinTolerance: Math.abs(offsetMillis) <= toleranceMillis,
  };
}

/** Total ordering key: wall clock first, monotonic sequence as tie-breaker. */
export function orderingKey(epochMillis: EpochMillis, sequence: number): string {
  return `${epochMillis.toString().padStart(15, "0")}:${sequence.toString().padStart(12, "0")}`;
}

/** Process-wide default clock. Inject a `Clock` explicitly wherever possible. */
export const systemClock: Clock = new SystemClock();
