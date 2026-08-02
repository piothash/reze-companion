/**
 * ARC — Market State Domain types (M1).
 *
 * Domain contracts only. This module contains NO trading logic: no decisions,
 * no intents, no orders, no risk. It describes what the market *is*, never what
 * to do about it. The VPS remains the sole trading authority.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const MARKET_LIFECYCLE_STATES = [
  "DISCOVERED",
  "ACTIVE",
  "CLOSING",
  "RESOLVED",
  "INVALID",
] as const;

export type MarketLifecycleState = (typeof MARKET_LIFECYCLE_STATES)[number];

export const MARKET_LIFECYCLE_EVENTS = [
  "ACTIVATE",
  "BEGIN_CLOSING",
  "RESOLVE",
  "INVALIDATE",
] as const;

export type MarketLifecycleEvent = (typeof MARKET_LIFECYCLE_EVENTS)[number];

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export const outcomeTokenSchema = z.object({
  /** Outcome label exactly as published by the venue, e.g. "Up". */
  label: z.string().min(1),
  /** Normalised lower-case label used for lookups. */
  key: z.string().min(1),
  /** Venue token identifier for the outcome. */
  tokenId: z.string().min(1),
});

export type OutcomeToken = z.infer<typeof outcomeTokenSchema>;

export const ptbSourceMetadataSchema = z.object({
  /** Where the price-to-beat originates, e.g. "market-metadata". */
  source: z.string().min(1),
  /** Metadata field the value was read from (audit trail). */
  field: z.string().min(1),
  /** Raw, unparsed value as published by the venue. */
  raw: z.string().optional(),
});

export type PtbSourceMetadata = z.infer<typeof ptbSourceMetadataSchema>;

export const marketDescriptorSchema = z.object({
  /** Deterministic ARC identifier for this market instance. */
  marketInstanceId: z.string().min(1),
  /** Venue-native market identifier (condition id). */
  venueMarketId: z.string().min(1),
  /** Venue slug used for discovery. */
  slug: z.string().min(1),
  /** Human-readable market question. */
  question: z.string().default(""),
  network: z.string().min(1),
  /** Outcome tokens; may be short or empty on an INVALID market. */
  outcomes: z.array(outcomeTokenSchema).default([]),
  /** Window open boundary, ISO-8601 UTC. */
  opensAtIso: z.string().datetime({ offset: false }),
  /** Official resolution timestamp, ISO-8601 UTC. */
  resolvesAtIso: z.string().datetime({ offset: false }),
  /** Venue flags, transported verbatim. */
  venueActive: z.boolean(),
  venueClosed: z.boolean(),
  /** PTB provenance read from official market metadata. */
  ptbSource: ptbSourceMetadataSchema.optional(),
  /** Raw PTB value carried by market metadata, if published. */
  ptbValue: z.number().finite().optional(),
  /** Discovery-time validity verdict and reasons. */
  valid: z.boolean(),
  invalidReasons: z.array(z.string()).default([]),
  discoveredAtIso: z.string().datetime({ offset: false }),
});

export type MarketDescriptor = z.infer<typeof marketDescriptorSchema>;

// ---------------------------------------------------------------------------
// Feed / observations
// ---------------------------------------------------------------------------

export const observationSchema = z.object({
  /** Feed identifier the observation came from. */
  feedId: z.string().min(1),
  provider: z.string().min(1),
  network: z.string().min(1),
  /** Observation value, already rounded to configured precision. */
  value: z.number().finite(),
  /** Timestamp reported by the feed itself, ISO-8601 UTC. */
  observedAtIso: z.string().datetime({ offset: false }),
  /** Timestamp at which ARC ingested the observation. */
  receivedAtIso: z.string().datetime({ offset: false }),
  /** Monotonic sequence within the feed engine. */
  sequence: z.number().int().nonnegative(),
});

export type Observation = z.infer<typeof observationSchema>;

export const FEED_FRESHNESS_STATES = ["FRESH", "STALE", "UNAVAILABLE"] as const;
export type FeedFreshnessState = (typeof FEED_FRESHNESS_STATES)[number];

export const feedFreshnessSchema = z.object({
  state: z.enum(FEED_FRESHNESS_STATES),
  /** Age of the newest observation in milliseconds, null when none exist. */
  ageMillis: z.number().int().nonnegative().nullable(),
  maxStalenessMillis: z.number().int().positive(),
  lastObservedAtIso: z.string().datetime({ offset: false }).nullable(),
});

export type FeedFreshness = z.infer<typeof feedFreshnessSchema>;

// ---------------------------------------------------------------------------
// TWAP
// ---------------------------------------------------------------------------

export const twapSnapshotSchema = z.object({
  /** Time-weighted average over the configured window, or null when unusable. */
  value: z.number().finite().nullable(),
  windowSeconds: z.number().int().positive(),
  precision: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
  /** Oldest / newest observation timestamps contributing to the basket. */
  windowStartIso: z.string().datetime({ offset: false }).nullable(),
  windowEndIso: z.string().datetime({ offset: false }).nullable(),
  freshness: feedFreshnessSchema,
  computedAtIso: z.string().datetime({ offset: false }),
});

export type TwapSnapshot = z.infer<typeof twapSnapshotSchema>;

// ---------------------------------------------------------------------------
// PTB
// ---------------------------------------------------------------------------

export const ptbSnapshotSchema = z.object({
  value: z.number().finite().nullable(),
  precision: z.number().int().nonnegative(),
  valid: z.boolean(),
  source: ptbSourceMetadataSchema.nullable(),
  rejectionReason: z.string().nullable(),
  resolvedAtIso: z.string().datetime({ offset: false }),
});

export type PtbSnapshot = z.infer<typeof ptbSnapshotSchema>;

// ---------------------------------------------------------------------------
// Signal conditioning
// ---------------------------------------------------------------------------

export const conditionedSignalSchema = z.object({
  /** Conditioned ("effective") TWAP. Never a decision, only a cleaned input. */
  effectiveTwap: z.number().finite().nullable(),
  /** Raw running TWAP the conditioning was applied to. */
  rawTwap: z.number().finite().nullable(),
  precision: z.number().int().nonnegative(),
  /** True when every configured conditioning requirement was satisfied. */
  usable: z.boolean(),
  /** Ordered, auditable list of conditioning steps applied. */
  appliedSteps: z.array(z.string()).default([]),
  rejectionReason: z.string().nullable(),
  conditionedAtIso: z.string().datetime({ offset: false }),
});

export type ConditionedSignal = z.infer<typeof conditionedSignalSchema>;

// ---------------------------------------------------------------------------
// Authoritative market state
// ---------------------------------------------------------------------------

export const configurationSnapshotRefSchema = z.object({
  configVersion: z.string().min(1),
  marketConfigVersion: z.string().min(1),
  /** Deterministic digest of the market-domain configuration in force. */
  marketConfigDigest: z.string().min(1),
  activeExecutionProfileId: z.string().min(1).nullable(),
});

export type ConfigurationSnapshotRef = z.infer<typeof configurationSnapshotRefSchema>;

export const authoritativeMarketStateSchema = z.object({
  marketInstanceId: z.string().min(1),
  marketStateVersion: z.number().int().positive(),
  timestampIso: z.string().datetime({ offset: false }),
  lifecycle: z.enum(MARKET_LIFECYCLE_STATES),
  descriptor: marketDescriptorSchema,
  freshness: feedFreshnessSchema,
  twap: twapSnapshotSchema.nullable(),
  signal: conditionedSignalSchema.nullable(),
  ptb: ptbSnapshotSchema.nullable(),
  configuration: configurationSnapshotRefSchema,
});

export type AuthoritativeMarketState = z.infer<typeof authoritativeMarketStateSchema>;

/** Deep-freezes a published snapshot so downstream consumers cannot mutate it. */
export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const entry of Object.values(value as Record<string, unknown>)) freezeDeep(entry);
  return Object.freeze(value);
}
