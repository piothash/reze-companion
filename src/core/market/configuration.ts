/**
 * ARC — Market State Domain configuration (M1).
 *
 * Configuration-first: every market-domain value is declared here, loaded from
 * the environment, validated and versioned. Nothing is hardcoded in an engine,
 * and switching testnet → mainnet is an environment change only.
 */
import { z } from "zod";

import { digest128 } from "../shared/ids";

export const MARKET_CONFIG_VERSION = "1.0.0";

export const FEED_PROVIDERS = ["http-json", "in-memory"] as const;
export type FeedProviderKind = (typeof FEED_PROVIDERS)[number];

export const PTB_SOURCES = ["market-metadata"] as const;
export type PtbSourceKind = (typeof PTB_SOURCES)[number];

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

export const discoveryConfigSchema = z.object({
  /** Venue metadata API base URL. No endpoint is ever hardcoded. */
  baseUrl: z.string().url(),
  /** Path appended to the base URL for market metadata lookups. */
  marketsPath: z.string().min(1).default("/markets"),
  /** Query parameter carrying the slug. */
  slugParam: z.string().min(1).default("slug"),
  /** Slug template; `{slot}` is replaced with the window-open epoch seconds. */
  slugTemplate: z.string().min(1),
  /** Duration of one market window in milliseconds. */
  slotDurationMillis: positiveInt.default(300_000),
  /** How long before resolution the market is considered CLOSING. */
  closingLeadMillis: positiveInt.default(30_000),
  requestTimeoutMillis: positiveInt.default(12_000),
  /** Outcome labels expected on a valid market, in canonical order. */
  expectedOutcomes: z.array(z.string().min(1)).min(2).default(["Up", "Down"]),
});

export const feedConfigSchema = z.object({
  provider: z.enum(FEED_PROVIDERS).default("http-json"),
  feedId: z.string().min(1),
  network: z.string().min(1).default("testnet"),
  /** Endpoint template; `{feedId}` and `{network}` are substituted. */
  endpointTemplate: z.string().min(1).optional(),
  /** Dotted path to the numeric price inside the provider response. */
  valuePath: z.string().min(1).default("price"),
  /** Dotted path to the provider-reported observation timestamp. */
  timestampPath: z.string().min(1).default("timestamp"),
  /** Sampling interval for observations. */
  observationIntervalMillis: positiveInt.default(1_000),
  /** Beyond this age the feed reads STALE. */
  maxStalenessMillis: positiveInt.default(15_000),
  /** Decimal places every observation and derived value is rounded to. */
  precision: nonNegativeInt.max(12).default(2),
  requestTimeoutMillis: positiveInt.default(5_000),
});

export const twapConfigSchema = z.object({
  windowSeconds: positiveInt.default(300),
  /** Minimum observations required before a TWAP value is published. */
  minObservations: positiveInt.default(2),
  /** Basket cap; the oldest observations are evicted beyond this. */
  maxObservations: positiveInt.default(2_048),
  precision: nonNegativeInt.max(12).default(2),
});

export const ptbConfigSchema = z.object({
  source: z.enum(PTB_SOURCES).default("market-metadata"),
  /** Metadata field carrying the price-to-beat. */
  metadataField: z.string().min(1).default("ptb"),
  /** Inclusive sanity bounds; values outside are rejected, never clamped. */
  minValue: z.number().finite().default(0),
  maxValue: z.number().finite().default(10_000_000),
  precision: nonNegativeInt.max(12).default(2),
});

export const signalConfigSchema = z.object({
  /** Conditioned TWAP is only published when the feed is FRESH. */
  requireFreshFeed: z.boolean().default(true),
  /** Minimum observations backing the TWAP before it is considered usable. */
  minObservations: positiveInt.default(2),
  /** Deterministic additive offset applied to the running TWAP. */
  offset: z.number().finite().default(0),
  precision: nonNegativeInt.max(12).default(2),
});

export const marketDomainConfigSchema = z.object({
  marketConfigVersion: z.string().min(1).default(MARKET_CONFIG_VERSION),
  discovery: discoveryConfigSchema,
  feed: feedConfigSchema,
  twap: twapConfigSchema.default({}),
  ptb: ptbConfigSchema.default({}),
  signal: signalConfigSchema.default({}),
});

export type MarketDomainConfig = z.infer<typeof marketDomainConfigSchema>;
export type MarketDomainConfigInput = z.input<typeof marketDomainConfigSchema>;

export type EnvSource = Record<string, string | undefined>;

export class MarketConfigError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(`ARC market configuration invalid — ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "MarketConfigError";
  }
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new MarketConfigError([{ path: "(env)", message: `not a number: ${value}` }]);
  return parsed;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value === "true" || value === "1";
}

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Every environment variable the Market State Domain understands.
 * Mainnet migration is `TWAP_NETWORK=mainnet` plus endpoint values — no code
 * change is ever required.
 */
export const MARKET_ENV_KEYS = [
  "MARKET_DISCOVERY_BASE_URL",
  "MARKET_DISCOVERY_MARKETS_PATH",
  "MARKET_DISCOVERY_SLUG_PARAM",
  "MARKET_SLUG_TEMPLATE",
  "MARKET_SLOT_DURATION_MS",
  "MARKET_CLOSING_LEAD_MS",
  "MARKET_DISCOVERY_TIMEOUT_MS",
  "MARKET_EXPECTED_OUTCOMES",
  "TWAP_FEED_PROVIDER",
  "TWAP_FEED_ID",
  "TWAP_NETWORK",
  "TWAP_FEED_ENDPOINT",
  "TWAP_FEED_VALUE_PATH",
  "TWAP_FEED_TIMESTAMP_PATH",
  "TWAP_OBSERVATION_INTERVAL",
  "TWAP_MAX_STALENESS",
  "TWAP_PRECISION",
  "TWAP_FEED_TIMEOUT_MS",
  "TWAP_WINDOW_SECONDS",
  "TWAP_MIN_OBSERVATIONS",
  "TWAP_MAX_OBSERVATIONS",
  "PTB_SOURCE",
  "PTB_METADATA_FIELD",
  "PTB_MIN_VALUE",
  "PTB_MAX_VALUE",
  "PTB_PRECISION",
  "SIGNAL_REQUIRE_FRESH_FEED",
  "SIGNAL_MIN_OBSERVATIONS",
  "SIGNAL_OFFSET",
  "SIGNAL_PRECISION",
] as const;

/** Builds a validated market-domain configuration from an environment source. */
export function loadMarketConfig(env: EnvSource): MarketDomainConfig {
  const precision = num(env["TWAP_PRECISION"]);

  const document: MarketDomainConfigInput = {
    marketConfigVersion: MARKET_CONFIG_VERSION,
    discovery: defined({
      baseUrl: env["MARKET_DISCOVERY_BASE_URL"],
      marketsPath: env["MARKET_DISCOVERY_MARKETS_PATH"],
      slugParam: env["MARKET_DISCOVERY_SLUG_PARAM"],
      slugTemplate: env["MARKET_SLUG_TEMPLATE"],
      slotDurationMillis: num(env["MARKET_SLOT_DURATION_MS"]),
      closingLeadMillis: num(env["MARKET_CLOSING_LEAD_MS"]),
      requestTimeoutMillis: num(env["MARKET_DISCOVERY_TIMEOUT_MS"]),
      expectedOutcomes: csv(env["MARKET_EXPECTED_OUTCOMES"]),
    }) as MarketDomainConfigInput["discovery"],
    feed: defined({
      provider: env["TWAP_FEED_PROVIDER"] as FeedProviderKind | undefined,
      feedId: env["TWAP_FEED_ID"],
      network: env["TWAP_NETWORK"],
      endpointTemplate: env["TWAP_FEED_ENDPOINT"],
      valuePath: env["TWAP_FEED_VALUE_PATH"],
      timestampPath: env["TWAP_FEED_TIMESTAMP_PATH"],
      observationIntervalMillis: num(env["TWAP_OBSERVATION_INTERVAL"]),
      maxStalenessMillis: num(env["TWAP_MAX_STALENESS"]),
      precision,
      requestTimeoutMillis: num(env["TWAP_FEED_TIMEOUT_MS"]),
    }) as MarketDomainConfigInput["feed"],
    twap: defined({
      windowSeconds: num(env["TWAP_WINDOW_SECONDS"]),
      minObservations: num(env["TWAP_MIN_OBSERVATIONS"]),
      maxObservations: num(env["TWAP_MAX_OBSERVATIONS"]),
      precision,
    }),
    ptb: defined({
      source: env["PTB_SOURCE"] as PtbSourceKind | undefined,
      metadataField: env["PTB_METADATA_FIELD"],
      minValue: num(env["PTB_MIN_VALUE"]),
      maxValue: num(env["PTB_MAX_VALUE"]),
      precision: num(env["PTB_PRECISION"]) ?? precision,
    }),
    signal: defined({
      requireFreshFeed: bool(env["SIGNAL_REQUIRE_FRESH_FEED"]),
      minObservations: num(env["SIGNAL_MIN_OBSERVATIONS"]),
      offset: num(env["SIGNAL_OFFSET"]),
      precision: num(env["SIGNAL_PRECISION"]) ?? precision,
    }),
  };

  return parseMarketConfigOrThrow(document);
}

export function parseMarketConfigOrThrow(candidate: unknown): MarketDomainConfig {
  const parsed = marketDomainConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new MarketConfigError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/** Deterministic digest of the configuration in force, for snapshot references. */
export function marketConfigDigest(config: MarketDomainConfig): string {
  return digest128(stableStringify(config));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
