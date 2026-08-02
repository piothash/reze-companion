/**
 * ARC — live runtime telemetry contract (M7.0).
 *
 * Pure module. It defines `GET /authority/telemetry`: the single document the
 * VPS trading authority publishes so every operator page renders live engine
 * state instead of placeholders.
 *
 * The companion never derives trading facts from this document. It validates
 * the wire shape, classifies freshness and labels each section as LIVE (this
 * handshake) or MIRRORED (last successful sync), per ADR-0001 and ADR-0004.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Wire contract
// ---------------------------------------------------------------------------

const nullableNumber = z.number().nullable().default(null);
const nullableString = z.string().nullable().default(null);

/** Official market metadata. PTB is always read, never computed here. */
export const telemetryMarketSchema = z.object({
  marketInstanceId: z.string().min(1),
  marketId: nullableString,
  slug: nullableString,
  question: nullableString,
  venue: nullableString,
  lifecycle: nullableString,
  endTimeIso: nullableString,
  resolutionIso: nullableString,
  /** Authoritative price-to-beat from venue metadata. */
  ptb: nullableNumber,
  ptbSource: nullableString,
  twap: nullableNumber,
  effectiveTwap: nullableNumber,
  observationCount: nullableNumber,
  feedFresh: z.boolean().nullable().default(null),
  feedAgeMillis: nullableNumber,
  liquidity: nullableNumber,
  tradingEnabled: z.boolean().nullable().default(null),
  status: nullableString,
  outcomeTokens: z
    .array(z.object({ key: z.string(), label: nullableString, tokenId: nullableString }))
    .default([]),
  marketStateVersion: nullableNumber,
  configurationSnapshotId: nullableString,
  snapshotIso: nullableString,
});
export type TelemetryMarket = z.infer<typeof telemetryMarketSchema>;

export const telemetryFeedSchema = z.object({
  provider: nullableString,
  providerId: nullableString,
  generation: nullableString,
  network: nullableString,
  feedId: nullableString,
  status: nullableString,
  connected: z.boolean().nullable().default(null),
  runningTwap: nullableNumber,
  effectiveTwap: nullableNumber,
  observationCount: nullableNumber,
  windowSeconds: nullableNumber,
  lastObservationIso: nullableString,
  ageMillis: nullableNumber,
  latencyMillis: nullableNumber,
  maxStalenessMillis: nullableNumber,
  missedObservations: nullableNumber,
  reconnectCount: nullableNumber,
  precision: nullableNumber,
});
export type TelemetryFeed = z.infer<typeof telemetryFeedSchema>;

export const telemetryWindowSchema = z.object({
  windowInstanceId: z.string().min(1),
  windowDefinitionId: nullableString,
  marketInstanceId: nullableString,
  offsetSeconds: nullableNumber,
  state: nullableString,
  priority: nullableNumber,
  bufferPercent: nullableNumber,
  activatesAtIso: nullableString,
  expiresAtIso: nullableString,
  decision: nullableString,
  executionIntentId: nullableString,
  reasonCode: nullableString,
});
export type TelemetryWindow = z.infer<typeof telemetryWindowSchema>;

export const telemetrySchedulerSchema = z.object({
  status: nullableString,
  tickIntervalMillis: nullableNumber,
  lastTickIso: nullableString,
  driftMillis: nullableNumber,
});

export const telemetryExecutionSchema = z.object({
  openOrders: nullableNumber,
  standingOrders: nullableNumber,
  repriceCount: nullableNumber,
  partialFills: nullableNumber,
  settlements: nullableNumber,
  killSwitchEngaged: z.boolean().nullable().default(null),
  quotaRemaining: nullableNumber,
  quotaInitial: nullableNumber,
  exposureNotional: nullableNumber,
});

export const telemetryProcessSchema = z.object({
  processManager: nullableString,
  instanceId: nullableString,
  restartCount: nullableNumber,
  startedAtIso: nullableString,
  memoryBytes: nullableNumber,
  cpuPercent: nullableNumber,
  eventSequence: nullableNumber,
});

export const runtimeTelemetrySchema = z.object({
  emittedAtIso: z.string().min(1),
  engineId: nullableString,
  network: nullableString,
  markets: z.array(telemetryMarketSchema).default([]),
  feed: telemetryFeedSchema.nullable().default(null),
  windows: z.array(telemetryWindowSchema).default([]),
  scheduler: telemetrySchedulerSchema.nullable().default(null),
  execution: telemetryExecutionSchema.nullable().default(null),
  process: telemetryProcessSchema.nullable().default(null),
});
export type RuntimeTelemetry = z.infer<typeof runtimeTelemetrySchema>;

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export type TelemetrySource = "LIVE" | "MIRRORED" | "NONE";

export const FEED_FRESHNESS_CLASSES = ["FRESH", "AGING", "STALE", "UNKNOWN"] as const;
export type FeedFreshnessClass = (typeof FEED_FRESHNESS_CLASSES)[number];

/**
 * Classifies feed freshness against the engine's own staleness budget.
 * An unreported age is `UNKNOWN` — never optimistically fresh.
 */
export function classifyFeedFreshness(
  ageMillis: number | null | undefined,
  maxStalenessMillis: number | null | undefined,
): FeedFreshnessClass {
  if (ageMillis === null || ageMillis === undefined || !Number.isFinite(ageMillis)) return "UNKNOWN";
  const budget =
    maxStalenessMillis !== null && maxStalenessMillis !== undefined && maxStalenessMillis > 0
      ? maxStalenessMillis
      : 15_000;
  if (ageMillis <= budget * 0.5) return "FRESH";
  if (ageMillis <= budget) return "AGING";
  return "STALE";
}

/** Telemetry older than two sync intervals is no longer treated as current. */
export function isTelemetryCurrent(
  emittedAtIso: string | null,
  nowMillis: number,
  syncIntervalMillis: number,
): boolean {
  if (!emittedAtIso) return false;
  const emitted = Date.parse(emittedAtIso);
  if (Number.isNaN(emitted)) return false;
  const budget = Math.max(syncIntervalMillis * 2, 10_000);
  return nowMillis - emitted <= budget;
}

/** Countdown to a window boundary in whole seconds; negative once elapsed. */
export function secondsUntil(iso: string | null | undefined, nowMillis: number): number | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  return Math.round((target - nowMillis) / 1000);
}

/**
 * The window an operator should be looking at: activated, not expired, and
 * nearest to expiry. Purely a presentation ordering — never a trading choice.
 */
export function selectActiveWindow(
  windows: readonly TelemetryWindow[],
  nowMillis: number,
): TelemetryWindow | null {
  const open = windows.filter((window) => {
    const activates = window.activatesAtIso ? Date.parse(window.activatesAtIso) : null;
    const expires = window.expiresAtIso ? Date.parse(window.expiresAtIso) : null;
    const started = activates === null || Number.isNaN(activates) || activates <= nowMillis;
    const ended = expires !== null && !Number.isNaN(expires) && expires <= nowMillis;
    return started && !ended;
  });
  if (open.length === 0) return null;
  return [...open].sort((a, b) => {
    const left = a.expiresAtIso ? Date.parse(a.expiresAtIso) : Number.MAX_SAFE_INTEGER;
    const right = b.expiresAtIso ? Date.parse(b.expiresAtIso) : Number.MAX_SAFE_INTEGER;
    return left - right;
  })[0]!;
}

/** Windows sorted by configured offset, longest lead first (15s → 3s). */
export function orderWindowsByOffset(
  windows: readonly TelemetryWindow[],
): readonly TelemetryWindow[] {
  return [...windows].sort((a, b) => (b.offsetSeconds ?? 0) - (a.offsetSeconds ?? 0));
}
