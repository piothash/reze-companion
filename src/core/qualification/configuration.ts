/**
 * ARC — M7.7 qualification fixtures.
 *
 * Configuration-first: every qualification value lives here, never inside the
 * harness or the engines it drives.
 */
import {
  DEFAULT_PROFILE_SEED,
  parseExecutionProfileOrThrow,
  type ExecutionProfile,
} from "../decision/configuration";
import { loadMarketConfig, type MarketDomainConfig } from "../market/configuration";
import { parseTradeConfigOrThrow, type TradeDomainConfig } from "../trade/configuration";
import { type QualificationSpec } from "./scenario";

export const QUALIFICATION_MARKET_ENV: Readonly<Record<string, string>> = Object.freeze({
  MARKET_DISCOVERY_BASE_URL: "https://gamma.testnet.arc",
  MARKET_SLUG_TEMPLATE: "btc-updown-5m-{slot}",
  MARKET_CLOSING_LEAD_MS: "30000",
  TWAP_FEED_ID: "btc-usd-testnet",
  TWAP_FEED_PROVIDER: "in-memory",
  TWAP_NETWORK: "testnet",
  TWAP_PRECISION: "2",
  TWAP_MAX_STALENESS: "10000",
  TWAP_WINDOW_SECONDS: "300",
  TWAP_MIN_OBSERVATIONS: "2",
  PTB_METADATA_FIELD: "ptb",
  PTB_MIN_VALUE: "1",
  PTB_MAX_VALUE: "10000000",
});

export function qualificationMarketConfig(): MarketDomainConfig {
  return loadMarketConfig(QUALIFICATION_MARKET_ENV);
}

export function qualificationProfile(overrides: Record<string, unknown> = {}): ExecutionProfile {
  return parseExecutionProfileOrThrow({
    executionProfileId: "qualification",
    executionMode: "MULTI_TRADE",
    maxTrades: 2,
    positionSize: 10,
    windowActiveMillis: 30_000,
    ...DEFAULT_PROFILE_SEED,
    ...overrides,
  });
}

export function qualificationTradeConfig(
  overrides: { risk?: Record<string, unknown>; execution?: Record<string, unknown> } = {},
): TradeDomainConfig {
  return parseTradeConfigOrThrow({
    risk: {
      maxExposure: 1_000,
      maxIntentExposure: 100,
      maxSpread: 0.2,
      minLiquidity: 1,
      ...overrides.risk,
    },
    execution: { minMeaningfulQuantity: 1, timeoutMillis: 10_000, ...overrides.execution },
  });
}

/** Canonical qualification scenario used by the tests, the docs and the console. */
export const QUALIFICATION_SPEC: QualificationSpec = Object.freeze({
  startIso: "2026-02-01T00:04:38.000Z",
  resolvesAtIso: "2026-02-01T00:05:00.000Z",
  ptb: 64_000,
  prices: Object.freeze([64_900, 65_000, 65_100, 65_050, 65_200]),
});
