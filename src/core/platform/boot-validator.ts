/**
 * ARC — boot configuration validator (M6.5).
 *
 * Validates every *business* configuration document before boot: execution
 * profile, window definitions, risk profile, order execution and the market
 * domain. Anything invalid refuses startup — ARC never boots into a
 * half-configured state and never substitutes a business default.
 *
 * Companion scope: this validates and reports. The VPS remains the sole
 * trading authority; nothing here decides or executes a trade.
 */
import { type ReasonCode } from "../contracts/reason-codes";
import {
  loadExecutionProfile,
  offsetToMillis,
  type ExecutionProfile,
} from "../decision/configuration";
import { loadMarketConfig, type MarketDomainConfig } from "../market/configuration";
import { tradeConfigFromEnv, type TradeDomainConfig } from "../trade/configuration";

export type EnvSource = Record<string, string | undefined>;

export interface BootIssue {
  readonly path: string;
  readonly message: string;
  readonly reasonCode: ReasonCode;
}

export interface BootValidationResult {
  readonly valid: boolean;
  readonly issues: readonly BootIssue[];
  readonly warnings: readonly BootIssue[];
  readonly executionProfile?: ExecutionProfile;
  readonly tradeConfig?: TradeDomainConfig;
  readonly marketConfig?: MarketDomainConfig;
}

function fail(path: string, message: string): BootIssue {
  return { path, message, reasonCode: "SYS_BOOT_CONFIG_INVALID" };
}

function warn(path: string, message: string): BootIssue {
  return { path, message, reasonCode: "SYS_CHECK_WARNING" };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Window-level invariants: offsets, duplicates, buffers, overrides, units. */
export function validateWindowDefinitions(profile: ExecutionProfile): BootIssue[] {
  const issues: BootIssue[] = [];
  const seenMillis = new Map<number, number>();

  if (profile.windows.length === 0) {
    issues.push(fail("windows", "at least one window definition is required"));
  }

  profile.windows.forEach((window, index) => {
    const at = `windows[${index}]`;
    const millis = offsetToMillis(window.offset, window.unit);

    if (!Number.isFinite(window.offset) || window.offset <= 0) {
      issues.push(fail(`${at}.offset`, "offset must be a finite positive number"));
    }
    if (millis <= 0) issues.push(fail(`${at}.offset`, "offset resolves to a non-positive duration"));
    if (millis < profile.windowActiveMillis) {
      issues.push(
        fail(
          `${at}.offset`,
          `offset (${millis}ms) is shorter than windowActiveMillis (${profile.windowActiveMillis}ms)`,
        ),
      );
    }

    const previous = seenMillis.get(millis);
    if (previous !== undefined) {
      issues.push(fail(`${at}.offset`, `duplicate window offset — collides with windows[${previous}]`));
    } else {
      seenMillis.set(millis, index);
    }

    if (!Number.isFinite(window.twapBuffer) || window.twapBuffer < 0) {
      issues.push(fail(`${at}.twapBuffer`, "buffer must be a finite non-negative number"));
    }
    if (profile.bufferMode === "PERCENT" && window.twapBuffer > 1) {
      issues.push(fail(`${at}.twapBuffer`, "PERCENT buffer must be expressed as a ratio <= 1"));
    }

    if (window.positionSizeOverride !== null) {
      if (!Number.isFinite(window.positionSizeOverride) || window.positionSizeOverride <= 0) {
        issues.push(fail(`${at}.positionSizeOverride`, "override must be a positive number"));
      }
    }

    if (window.retryCountOverride !== null) {
      if (!Number.isInteger(window.retryCountOverride) || window.retryCountOverride < 0) {
        issues.push(fail(`${at}.retryCountOverride`, "retry override must be a non-negative integer"));
      }
    }
  });

  if (profile.windows.every((window) => !window.enabled)) {
    issues.push(fail("windows", "every window is disabled — nothing could ever execute"));
  }

  return issues;
}

/** Profile-level invariants: quota, buffers, retries, timeouts, tick units. */
export function validateExecutionProfileInvariants(profile: ExecutionProfile): BootIssue[] {
  const issues: BootIssue[] = [];

  if (profile.executionMode === "SINGLE_TRADE" && profile.maxTrades !== 1) {
    issues.push(fail("maxTrades", "SINGLE_TRADE must declare maxTrades = 1"));
  }
  if (profile.executionMode === "MULTI_TRADE" && profile.maxTrades < 2) {
    issues.push(fail("maxTrades", "MULTI_TRADE requires a trade quota of at least 2"));
  }
  const enabled = profile.windows.filter((window) => window.enabled).length;
  if (profile.executionMode === "MULTI_TRADE" && profile.maxTrades > enabled) {
    issues.push(
      warn("maxTrades", `quota (${profile.maxTrades}) exceeds enabled windows (${enabled})`),
    );
  }

  if (profile.positionSize <= 0) issues.push(fail("positionSize", "must be positive"));
  if (!Number.isInteger(profile.retryCount) || profile.retryCount < 0) {
    issues.push(fail("retryCount", "must be a non-negative integer"));
  }
  if (profile.tickSize <= 0) issues.push(fail("tickSize", "must be positive"));
  if (profile.maxSpread < 0 || profile.maxSpread > 1) {
    issues.push(fail("maxSpread", "must be a ratio between 0 and 1"));
  }
  if (profile.minLiquidity < 0) issues.push(fail("minLiquidity", "must be non-negative"));

  if (profile.repricingEnabled) {
    if (profile.repricingMaxAttempts < 1) {
      issues.push(fail("repricingMaxAttempts", "repricing enabled but no attempts are budgeted"));
    }
    const budget = profile.repricingIntervalMillis * profile.repricingMaxAttempts;
    if (budget > profile.timeoutMillis) {
      issues.push(
        fail(
          "timeoutMillis",
          `repricing budget (${budget}ms) exceeds the session timeout (${profile.timeoutMillis}ms)`,
        ),
      );
    }
  }

  if (profile.timeoutMillis > profile.windowActiveMillis) {
    issues.push(
      fail(
        "timeoutMillis",
        `execution timeout (${profile.timeoutMillis}ms) exceeds windowActiveMillis (${profile.windowActiveMillis}ms)`,
      ),
    );
  }

  return issues;
}

/** Risk and order execution invariants. */
export function validateRiskProfile(trade: TradeDomainConfig): BootIssue[] {
  const issues: BootIssue[] = [];
  const { risk, execution } = trade;

  if (risk.maxExposure <= 0) issues.push(fail("risk.maxExposure", "must be positive"));
  if (risk.maxIntentExposure <= 0) issues.push(fail("risk.maxIntentExposure", "must be positive"));
  if (risk.maxIntentExposure > risk.maxExposure) {
    issues.push(fail("risk.maxIntentExposure", "must not exceed risk.maxExposure"));
  }
  if (risk.maxPositionPerOutcome <= 0) {
    issues.push(fail("risk.maxPositionPerOutcome", "must be positive"));
  }
  if (risk.maxSpread < 0 || risk.maxSpread > 1) {
    issues.push(fail("risk.maxSpread", "must be a ratio between 0 and 1"));
  }
  if (risk.maxFeedAgeMillis <= 0) issues.push(fail("risk.maxFeedAgeMillis", "must be positive"));
  if (risk.killSwitch) {
    issues.push(warn("risk.killSwitch", "kill switch is engaged — every intent will be denied"));
  }

  if (execution.tickSize <= 0) issues.push(fail("execution.tickSize", "must be positive"));
  if (execution.timeoutMillis <= 0) issues.push(fail("execution.timeoutMillis", "must be positive"));
  if (execution.repricingEnabled && execution.repricingMaxAttempts < 1) {
    issues.push(fail("execution.repricingMaxAttempts", "repricing enabled with no attempts"));
  }
  if (execution.retryCount > 0 && execution.retryDelayMillis <= 0) {
    issues.push(fail("execution.retryDelayMillis", "retries configured with a zero delay"));
  }
  if (execution.minMeaningfulQuantity <= 0) {
    issues.push(fail("execution.minMeaningfulQuantity", "must be positive"));
  }

  return issues;
}

/** Feed and TWAP invariants. */
export function validateMarketConfiguration(market: MarketDomainConfig): BootIssue[] {
  const issues: BootIssue[] = [];
  const { feed, twap, ptb, discovery } = market;

  if (twap.windowSeconds <= 0) issues.push(fail("twap.windowSeconds", "must be positive"));
  if (twap.minObservations < 1) issues.push(fail("twap.minObservations", "must be at least 1"));
  if (twap.minObservations > twap.maxObservations) {
    issues.push(fail("twap.minObservations", "must not exceed twap.maxObservations"));
  }
  const capacity = Math.floor((twap.windowSeconds * 1_000) / feed.observationIntervalMillis);
  if (capacity < twap.minObservations) {
    issues.push(
      fail(
        "twap.windowSeconds",
        `window admits ${capacity} observations at the configured sampling interval, below minObservations (${twap.minObservations})`,
      ),
    );
  }
  if (feed.maxStalenessMillis < feed.observationIntervalMillis) {
    issues.push(
      fail("feed.maxStalenessMillis", "staleness budget is shorter than the sampling interval"),
    );
  }
  if (feed.provider === "http-json" && !feed.endpointTemplate) {
    issues.push(fail("feed.endpointTemplate", "http-json provider requires an endpoint template"));
  }
  if (ptb.minValue >= ptb.maxValue) {
    issues.push(fail("ptb.minValue", "must be below ptb.maxValue"));
  }
  if (discovery.closingLeadMillis >= discovery.slotDurationMillis) {
    issues.push(fail("discovery.closingLeadMillis", "must be shorter than the slot duration"));
  }

  return issues;
}

/**
 * Loads and validates every business configuration document from the
 * environment. Never throws: the caller decides how to block startup.
 */
export function validateBootConfiguration(env: EnvSource): BootValidationResult {
  const issues: BootIssue[] = [];
  const warnings: BootIssue[] = [];

  let executionProfile: ExecutionProfile | undefined;
  try {
    executionProfile = loadExecutionProfile(env);
    for (const found of [
      ...validateWindowDefinitions(executionProfile),
      ...validateExecutionProfileInvariants(executionProfile),
    ]) {
      (found.reasonCode === "SYS_CHECK_WARNING" ? warnings : issues).push(found);
    }
  } catch (error) {
    issues.push(fail("executionProfile", errorMessage(error)));
  }

  let tradeConfig: TradeDomainConfig | undefined;
  try {
    tradeConfig = tradeConfigFromEnv(env);
    for (const found of validateRiskProfile(tradeConfig)) {
      (found.reasonCode === "SYS_CHECK_WARNING" ? warnings : issues).push(found);
    }
  } catch (error) {
    issues.push(fail("riskProfile", errorMessage(error)));
  }

  let marketConfig: MarketDomainConfig | undefined;
  try {
    marketConfig = loadMarketConfig(env);
    for (const found of validateMarketConfiguration(marketConfig)) {
      (found.reasonCode === "SYS_CHECK_WARNING" ? warnings : issues).push(found);
    }
  } catch (error) {
    issues.push(fail("marketConfiguration", errorMessage(error)));
  }

  if (executionProfile && tradeConfig) {
    const perTrade = executionProfile.positionSize;
    const quota = executionProfile.executionMode === "SINGLE_TRADE" ? 1 : executionProfile.maxTrades;
    if (perTrade > tradeConfig.risk.maxIntentExposure) {
      issues.push(
        fail(
          "positionSize",
          `position size (${perTrade}) exceeds risk.maxIntentExposure (${tradeConfig.risk.maxIntentExposure})`,
        ),
      );
    }
    if (perTrade * quota > tradeConfig.risk.maxExposure) {
      warnings.push(
        warn(
          "positionSize",
          `full quota (${quota} x ${perTrade}) exceeds risk.maxExposure (${tradeConfig.risk.maxExposure})`,
        ),
      );
    }
    if (executionProfile.tickSize !== tradeConfig.execution.tickSize) {
      issues.push(
        fail("tickSize", "execution profile and order execution declare different tick sizes"),
      );
    }
    if (executionProfile.precision !== tradeConfig.execution.precision) {
      issues.push(fail("precision", "execution profile and order execution disagree on precision"));
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    ...(executionProfile ? { executionProfile } : {}),
    ...(tradeConfig ? { tradeConfig } : {}),
    ...(marketConfig ? { marketConfig } : {}),
  };
}
