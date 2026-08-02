/**
 * ARC — Trade Domain configuration (M3).
 *
 * Configuration-first: every retry count, delay, reprice budget, timeout, IOC
 * policy and risk limit is declared here and sourced from the environment.
 * There are no hardcoded execution values anywhere in the Trade Domain.
 */
import { z } from "zod";

import { digest128 } from "../shared/ids";

export const RISK_PROFILE_VERSION = "1.0.0";
export const TRADE_CONFIG_VERSION = "1.0.0";

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

export const riskProfileSchema = z.object({
  riskProfileId: z.string().min(1).default("default"),
  riskProfileVersion: z.string().min(1).default(RISK_PROFILE_VERSION),
  /** Operator kill switch. When true every intent is denied, unconditionally. */
  killSwitch: z.boolean().default(false),
  /** Reserved + live exposure may never exceed this, in quote currency. */
  maxExposure: z.number().finite().positive().default(100),
  /** Maximum live quantity held on a single outcome. */
  maxPositionPerOutcome: z.number().finite().positive().default(1_000_000),
  /** Maximum notional a single execution intent may request. */
  maxIntentExposure: z.number().finite().positive().default(100),
  /** Minimum observable liquidity required on the outcome. */
  minLiquidity: z.number().finite().nonnegative().default(0),
  /** Maximum tolerated spread on the outcome. */
  maxSpread: z.number().finite().nonnegative().default(1),
  /** Feed age above which risk denies. */
  maxFeedAgeMillis: positiveInt.default(30_000),
  /** Deny when the feed is STALE rather than only when UNAVAILABLE. */
  denyOnStaleFeed: z.boolean().default(true),
  /** Deny when liquidity or spread cannot be observed at all. */
  denyOnUnknownLiquidity: z.boolean().default(false),
});

export type RiskProfile = z.infer<typeof riskProfileSchema>;

export const orderExecutionConfigSchema = z.object({
  /** Retries of a whole execution attempt after a rejection or gateway error. */
  retryCount: nonNegativeInt.default(0),
  retryDelayMillis: nonNegativeInt.default(500),
  /** Cancel/replace budget for one standing order. */
  repricingEnabled: z.boolean().default(false),
  repricingIntervalMillis: positiveInt.default(1_000),
  repricingMaxAttempts: nonNegativeInt.default(0),
  /** Whole-session deadline. */
  timeoutMillis: positiveInt.default(10_000),
  /** Cross the spread with an IOC order once passive attempts are exhausted. */
  iocFallbackEnabled: z.boolean().default(false),
  /** Passive maker: rest at the best bid instead of crossing. */
  postOnly: z.boolean().default(true),
  /** Smallest cumulative quantity that counts as a real trade. */
  minMeaningfulQuantity: z.number().finite().positive().default(1),
  tickSize: z.number().finite().positive().default(0.01),
  tickPolicy: z.enum(["ROUND_NEAREST", "ROUND_DOWN", "ROUND_UP"]).default("ROUND_DOWN"),
  precision: nonNegativeInt.max(12).default(2),
});

export type OrderExecutionConfig = z.infer<typeof orderExecutionConfigSchema>;

export const tradeDomainConfigSchema = z.object({
  tradeConfigVersion: z.string().min(1).default(TRADE_CONFIG_VERSION),
  risk: riskProfileSchema,
  execution: orderExecutionConfigSchema,
});

export type TradeDomainConfig = z.infer<typeof tradeDomainConfigSchema>;
export type TradeDomainConfigInput = z.input<typeof tradeDomainConfigSchema>;

export class TradeConfigError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(`ARC trade configuration invalid — ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "TradeConfigError";
  }
}

export function parseTradeConfigOrThrow(candidate: unknown): TradeDomainConfig {
  const parsed = tradeDomainConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new TradeConfigError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    );
  }
  const config = parsed.data;
  if (config.risk.maxIntentExposure > config.risk.maxExposure) {
    throw new TradeConfigError([
      {
        path: "risk.maxIntentExposure",
        message: "must not exceed risk.maxExposure",
      },
    ]);
  }
  return config;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const TRADE_ENV_KEYS = [
  "RISK_PROFILE_ID",
  "RISK_KILL_SWITCH",
  "RISK_MAX_EXPOSURE",
  "RISK_MAX_POSITION_PER_OUTCOME",
  "RISK_MAX_INTENT_EXPOSURE",
  "RISK_MIN_LIQUIDITY",
  "RISK_MAX_SPREAD",
  "RISK_MAX_FEED_AGE_MS",
  "RISK_DENY_ON_STALE_FEED",
  "RISK_DENY_ON_UNKNOWN_LIQUIDITY",
  "ORDER_RETRY_COUNT",
  "ORDER_RETRY_DELAY_MS",
  "ORDER_REPRICING_ENABLED",
  "ORDER_REPRICING_INTERVAL_MS",
  "ORDER_REPRICING_MAX_ATTEMPTS",
  "ORDER_TIMEOUT_MS",
  "ORDER_IOC_FALLBACK_ENABLED",
  "ORDER_POST_ONLY",
  "ORDER_MIN_MEANINGFUL_QUANTITY",
  "ORDER_TICK_SIZE",
  "ORDER_TICK_POLICY",
  "ORDER_PRECISION",
] as const;

export type TradeEnvKey = (typeof TRADE_ENV_KEYS)[number];

function num(value: string | undefined, path: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TradeConfigError([{ path, message: `not a number: ${value}` }]);
  }
  return parsed;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalised = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalised)) return true;
  if (["0", "false", "no", "off"].includes(normalised)) return false;
  return undefined;
}

function str(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

function compact<T extends Record<string, unknown>>(source: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/** Builds the Trade Domain configuration from an environment map. */
export function tradeConfigFromEnv(env: Record<string, string | undefined>): TradeDomainConfig {
  const risk = compact({
    riskProfileId: str(env["RISK_PROFILE_ID"]),
    killSwitch: bool(env["RISK_KILL_SWITCH"]),
    maxExposure: num(env["RISK_MAX_EXPOSURE"], "RISK_MAX_EXPOSURE"),
    maxPositionPerOutcome: num(
      env["RISK_MAX_POSITION_PER_OUTCOME"],
      "RISK_MAX_POSITION_PER_OUTCOME",
    ),
    maxIntentExposure: num(env["RISK_MAX_INTENT_EXPOSURE"], "RISK_MAX_INTENT_EXPOSURE"),
    minLiquidity: num(env["RISK_MIN_LIQUIDITY"], "RISK_MIN_LIQUIDITY"),
    maxSpread: num(env["RISK_MAX_SPREAD"], "RISK_MAX_SPREAD"),
    maxFeedAgeMillis: num(env["RISK_MAX_FEED_AGE_MS"], "RISK_MAX_FEED_AGE_MS"),
    denyOnStaleFeed: bool(env["RISK_DENY_ON_STALE_FEED"]),
    denyOnUnknownLiquidity: bool(env["RISK_DENY_ON_UNKNOWN_LIQUIDITY"]),
  });

  const execution = compact({
    retryCount: num(env["ORDER_RETRY_COUNT"], "ORDER_RETRY_COUNT"),
    retryDelayMillis: num(env["ORDER_RETRY_DELAY_MS"], "ORDER_RETRY_DELAY_MS"),
    repricingEnabled: bool(env["ORDER_REPRICING_ENABLED"]),
    repricingIntervalMillis: num(env["ORDER_REPRICING_INTERVAL_MS"], "ORDER_REPRICING_INTERVAL_MS"),
    repricingMaxAttempts: num(env["ORDER_REPRICING_MAX_ATTEMPTS"], "ORDER_REPRICING_MAX_ATTEMPTS"),
    timeoutMillis: num(env["ORDER_TIMEOUT_MS"], "ORDER_TIMEOUT_MS"),
    iocFallbackEnabled: bool(env["ORDER_IOC_FALLBACK_ENABLED"]),
    postOnly: bool(env["ORDER_POST_ONLY"]),
    minMeaningfulQuantity: num(
      env["ORDER_MIN_MEANINGFUL_QUANTITY"],
      "ORDER_MIN_MEANINGFUL_QUANTITY",
    ),
    tickSize: num(env["ORDER_TICK_SIZE"], "ORDER_TICK_SIZE"),
    tickPolicy: str(env["ORDER_TICK_POLICY"]),
    precision: num(env["ORDER_PRECISION"], "ORDER_PRECISION"),
  });

  return parseTradeConfigOrThrow({ risk, execution });
}

/** Deterministic digest of the trade configuration in force. */
export function tradeConfigDigest(config: TradeDomainConfig): string {
  return digest128(stableStringify(config));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
  return `{${entries.join(",")}}`;
}
