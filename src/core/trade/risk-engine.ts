/**
 * ARC — Risk Engine (M3).
 *
 * Risk answers exactly one question — ALLOW or DENY — and nothing else.
 *
 * Risk NEVER decides direction, NEVER calculates TWAP, NEVER calculates PTB,
 * NEVER owns the trade quota and NEVER creates orders. It evaluates a closed
 * set of conditions (kill switch, market validity, feed freshness, exposure,
 * position limits, liquidity, configured policies) and returns a verdict.
 *
 * The evaluation is a pure function: no I/O, no clock reads beyond the
 * injected clock, no randomness, no mutation of its inputs.
 */
import { type RiskProfile } from "./configuration";
import {
  freezeDeep,
  riskVerdictSchema,
  type RiskCheckName,
  type RiskCheckResult,
  type RiskInput,
  type RiskVerdict,
} from "./types";

/** Ordered evaluation: the cheapest, most absolute veto is checked first. */
const CHECK_ORDER: readonly RiskCheckName[] = [
  "KILL_SWITCH",
  "MARKET_VALIDITY",
  "FEED_FRESHNESS",
  "EXPOSURE",
  "POSITION_LIMIT",
  "LIQUIDITY",
  "POLICY",
];

function result(
  check: RiskCheckName,
  passed: boolean,
  detail: string,
  observed: number | null = null,
  limit: number | null = null,
): RiskCheckResult {
  return { check, passed, detail, observed, limit };
}

function evaluateCheck(
  check: RiskCheckName,
  input: RiskInput,
  profile: RiskProfile,
): RiskCheckResult {
  switch (check) {
    case "KILL_SWITCH":
      return result(
        check,
        !input.killSwitchEngaged,
        input.killSwitchEngaged ? "kill switch engaged" : "kill switch disengaged",
      );

    case "MARKET_VALIDITY": {
      const passed = input.marketValid && input.marketTradable;
      return result(
        check,
        passed,
        passed
          ? "market is valid and tradable"
          : `market not tradable (valid=${input.marketValid}, tradable=${input.marketTradable})`,
      );
    }

    case "FEED_FRESHNESS": {
      if (input.feedFreshnessState === "UNAVAILABLE") {
        return result(
          check,
          false,
          "feed unavailable",
          input.feedAgeMillis,
          profile.maxFeedAgeMillis,
        );
      }
      if (input.feedFreshnessState === "STALE" && profile.denyOnStaleFeed) {
        return result(check, false, "feed stale", input.feedAgeMillis, profile.maxFeedAgeMillis);
      }
      const age = input.feedAgeMillis;
      if (age !== null && age > profile.maxFeedAgeMillis) {
        return result(
          check,
          false,
          `feed age ${age}ms exceeds ${profile.maxFeedAgeMillis}ms`,
          age,
          profile.maxFeedAgeMillis,
        );
      }
      return result(check, true, "feed fresh", age, profile.maxFeedAgeMillis);
    }

    case "EXPOSURE": {
      if (input.requestedExposure > profile.maxIntentExposure) {
        return result(
          check,
          false,
          `requested exposure ${input.requestedExposure} exceeds per-intent limit`,
          input.requestedExposure,
          profile.maxIntentExposure,
        );
      }
      const projected = input.liveExposure + input.reservedExposure + input.requestedExposure;
      const passed = projected <= profile.maxExposure + 1e-9;
      return result(
        check,
        passed,
        passed
          ? "reserved + live + requested within the exposure limit"
          : `reserved + live + requested ${projected} exceeds limit ${profile.maxExposure}`,
        projected,
        profile.maxExposure,
      );
    }

    case "POSITION_LIMIT": {
      const projected = input.outcomePosition + input.requestedQuantity;
      const passed = projected <= profile.maxPositionPerOutcome + 1e-9;
      return result(
        check,
        passed,
        passed
          ? "outcome position within the configured limit"
          : `outcome position ${projected} exceeds limit ${profile.maxPositionPerOutcome}`,
        projected,
        profile.maxPositionPerOutcome,
      );
    }

    case "LIQUIDITY": {
      const { availableLiquidity, spread } = input;
      if (availableLiquidity === null || spread === null) {
        return result(
          check,
          !profile.denyOnUnknownLiquidity,
          profile.denyOnUnknownLiquidity
            ? "liquidity or spread unobservable and policy denies unknown books"
            : "liquidity unobservable; policy tolerates unknown books",
        );
      }
      if (availableLiquidity < profile.minLiquidity) {
        return result(
          check,
          false,
          `liquidity ${availableLiquidity} below minimum ${profile.minLiquidity}`,
          availableLiquidity,
          profile.minLiquidity,
        );
      }
      if (spread > profile.maxSpread) {
        return result(
          check,
          false,
          `spread ${spread} above maximum ${profile.maxSpread}`,
          spread,
          profile.maxSpread,
        );
      }
      return result(
        check,
        true,
        "book liquidity and spread within policy",
        availableLiquidity,
        profile.minLiquidity,
      );
    }

    case "POLICY": {
      const passed = input.riskProfileVersion === profile.riskProfileVersion;
      return result(
        check,
        passed,
        passed
          ? `risk profile ${profile.riskProfileId}@${profile.riskProfileVersion} applied`
          : `intent risk profile version ${input.riskProfileVersion} does not match ${profile.riskProfileVersion}`,
      );
    }
  }
}

export interface RiskEngineOptions {
  profile: RiskProfile;
  /** ISO-8601 UTC timestamp of the evaluation. */
  evaluatedAtIso: string;
}

/**
 * Pure ALLOW/DENY evaluation. Every configured check is always evaluated so
 * the verdict carries a complete, auditable trace; the first failing check in
 * declaration order becomes `deniedBy`.
 */
export function evaluateRisk(input: RiskInput, options: RiskEngineOptions): RiskVerdict {
  const checks = CHECK_ORDER.map((check) => evaluateCheck(check, input, options.profile));
  const failed = checks.find((entry) => !entry.passed) ?? null;

  return freezeDeep(
    riskVerdictSchema.parse({
      decision: failed ? "DENY" : "ALLOW",
      executionIntentId: input.executionIntentId,
      marketInstanceId: input.marketInstanceId,
      riskProfileVersion: options.profile.riskProfileVersion,
      checks,
      deniedBy: failed?.check ?? null,
      reason: failed?.detail ?? null,
      evaluatedAtIso: options.evaluatedAtIso,
    } satisfies RiskVerdict),
  );
}

/** Maps a denial onto its catalogued reason code. */
export function riskDenialReasonCode(deniedBy: RiskCheckName) {
  switch (deniedBy) {
    case "KILL_SWITCH":
      return "RSK_DENIED_KILL_SWITCH" as const;
    case "MARKET_VALIDITY":
      return "RSK_DENIED_MARKET_INVALID" as const;
    case "FEED_FRESHNESS":
      return "RSK_DENIED_FEED_STALE" as const;
    case "EXPOSURE":
      return "RSK_DENIED_EXPOSURE" as const;
    case "POSITION_LIMIT":
      return "RSK_DENIED_POSITION_LIMIT" as const;
    case "LIQUIDITY":
      return "RSK_DENIED_LIQUIDITY" as const;
    case "POLICY":
      return "RSK_DENIED_POLICY" as const;
  }
}
