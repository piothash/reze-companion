import { describe, expect, it } from "vitest";

import {
  loadEnv,
  configFromEnv,
  bootstrapConfig,
  EnvironmentValidationError,
} from "@/core/configuration/environment";
import {
  applyExecutionProfile,
  parseConfigOrThrow,
  validateConfig,
} from "@/core/configuration/schema";
import { versionOf } from "@/core/contracts/versions";

const base = { ARC_ENVIRONMENT: "test", ARC_NETWORK: "testnet" } as const;

describe("environment loading", () => {
  it("applies defaults and parses typed values", () => {
    const env = loadEnv({ ...base, ARC_SCHEDULER_TICK_MS: "500", ARC_METRICS_ENABLED: "true" });
    expect(env.ARC_ENVIRONMENT).toBe("test");
    expect(env.ARC_SCHEDULER_TICK_MS).toBe(500);
    expect(env.ARC_METRICS_ENABLED).toBe(true);
  });

  it("fails fast on an invalid value", () => {
    expect(() => loadEnv({ ...base, ARC_ENVIRONMENT: "prod" })).toThrow(EnvironmentValidationError);
    expect(() => loadEnv({ ...base, ARC_SCHEDULER_TICK_MS: "fast" })).toThrow(
      EnvironmentValidationError,
    );
  });

  it("parses comma separated lists", () => {
    const env = loadEnv({ ...base, ARC_FEED_IDS: "feed-a, feed-b ,, feed-c" });
    expect(env.ARC_FEED_IDS).toEqual(["feed-a", "feed-b", "feed-c"]);
  });

  it("supports every runtime environment and both networks", () => {
    for (const environment of ["development", "test", "staging", "production"]) {
      for (const network of ["testnet", "mainnet"]) {
        const config = bootstrapConfig({ ARC_ENVIRONMENT: environment, ARC_NETWORK: network });
        expect(config.runtime.environment).toBe(environment);
        expect(config.runtime.network).toBe(network);
      }
    }
  });
});

describe("configuration schema", () => {
  it("stamps the registry configuration version", () => {
    const config = configFromEnv(loadEnv(base));
    expect(config.configVersion).toBe(versionOf("configuration"));
  });

  it("reports validation issues instead of throwing", () => {
    const result = validateConfig({
      configVersion: "1.0.0",
      runtime: { environment: "nope", network: "testnet" },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("throws on invalid configuration in fail-fast mode", () => {
    expect(() => parseConfigOrThrow({})).toThrow(/ARC configuration invalid/);
  });

  it("has no hardcoded business values in defaults", () => {
    const config = configFromEnv(loadEnv(base));
    expect(config.positionDefaults.maxNotionalUsd).toBe(0);
    expect(config.exposureDefaults.tradeQuotaPerWindow).toBe(0);
  });

  it("applies an execution profile as a validated override", () => {
    const config = configFromEnv(loadEnv(base));
    const next = applyExecutionProfile(config, {
      id: "profile-mainnet",
      label: "Mainnet",
      network: "mainnet",
      overrides: { scheduler: { tickIntervalMillis: 250 } },
    });
    expect(next.runtime.network).toBe("mainnet");
    expect(next.scheduler.tickIntervalMillis).toBe(250);
    expect(next.activeExecutionProfileId).toBe("profile-mainnet");
  });
});
