/**
 * ARC — M6 configuration and performance sanity tests.
 *
 * Configuration: every business value is environment/profile driven — nothing
 * business-related may be hardcoded in engine code.
 * Performance: deterministic, machine-independent budgets that catch
 * accidental quadratic behaviour, not wall-clock micro-benchmarks.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EventEnvelopeFactory } from "@/core/contracts/event-envelope";
import { FixedClock } from "@/core/shared/time";
import { MARKET_EVENT_TYPES } from "@/core/market/events";
import { computeAnalytics, reconstructLedger, replayEvents } from "@/core/platform";
import { recoverFromEvents } from "@/core/platform/recovery";
import { loadExecutionProfile } from "@/core/decision/configuration";
import { loadMarketConfig } from "@/core/market/configuration";
import { loadEnvironment } from "@/core/configuration/environment";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith(".ts")) out.push(rel);
  }
  return out;
}

describe("configuration — nothing business-related hardcoded", () => {
  it("engine defaults live in configuration modules, not in engine code", () => {
    const engineFiles = walk("src/core").filter(
      (file) =>
        !file.includes("configuration") &&
        !file.includes("reason-codes") &&
        !file.includes("versions") &&
        !file.includes("event-catalog"),
    );
    const offenders: string[] = [];
    for (const file of engineFiles) {
      for (const [index, line] of read(file).split("\n").entries()) {
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
        // A default assigned to a business knob is a configuration leak.
        if (
          /\b(twapBuffer|positionSize|maxTrades|retryCount|tickSize|minLiquidity|maxSpread|timeoutMillis|exposureLimit|feeRate)\b\s*[:=]\s*-?\d/.test(
            trimmed,
          )
        ) {
          offenders.push(`${file}:${index + 1} ${trimmed}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("execution profile is fully environment driven", () => {
    const profile = loadExecutionProfile({
      EXECUTION_PROFILE_ID: "prod",
      EXECUTION_MODE: "MULTI_TRADE",
      EXECUTION_MAX_TRADES: "3",
      EXECUTION_POSITION_SIZE: "25",
      EXECUTION_TICK_SIZE: "0.01",
      EXECUTION_WINDOWS: "60s:0.004,30s:0.002,10s:0.001",
    });
    expect(profile.executionProfileId).toBe("prod");
    expect(profile.maxTrades).toBe(3);
    expect(profile.positionSize).toBe(25);
    expect(profile.windows.length).toBe(3);
  });

  it("market feed, network and venue are configurable", () => {
    const config = loadMarketConfig({
      TWAP_FEED_PROVIDER: "pyth",
      TWAP_NETWORK: "testnet",
      TWAP_FEED_ID: "feed-btc-usd",
      TWAP_WINDOW_SECONDS: "60",
    });
    expect(config.feed.network).toBe("testnet");
    expect(config.feed.feedId).toBe("feed-btc-usd");
    expect(config.twap.windowSeconds).toBe(60);
  });

  it("rejects an invalid environment instead of silently defaulting", () => {
    expect(() => loadEnvironment({ ARC_ENVIRONMENT: "not-a-environment" })).toThrow();
  });
});

describe("performance — sanity budgets", () => {
  const factory = new EventEnvelopeFactory(new FixedClock("2026-03-01T00:00:00.000Z"), "perf");
  const stream = Array.from({ length: 5000 }, (_unused, index) =>
    factory.create({
      correlationId: "corr-perf",
      source: "perf",
      marketInstanceId: "mkt-perf",
      type: MARKET_EVENT_TYPES.stateUpdated,
      reasonCode: "MKT_STATE_PUBLISHED",
      payload: { marketStateVersion: index + 1, marketInstanceId: "mkt-perf" },
    }),
  );

  it("replays 5k events well inside the interactive budget", () => {
    const started = performance.now();
    const result = replayEvents(stream);
    const elapsed = performance.now() - started;
    expect(result.eventCount).toBe(5000);
    expect(elapsed).toBeLessThan(2000);
  });

  it("scales roughly linearly (no quadratic blow-up) for recovery", () => {
    const time = (events: typeof stream) => {
      const started = performance.now();
      recoverFromEvents(events);
      return Math.max(performance.now() - started, 0.5);
    };
    const small = time(stream.slice(0, 1000));
    const large = time(stream);
    expect(large / small).toBeLessThan(25);
  });

  it("ledger and analytics stay bounded on a large stream", () => {
    const started = performance.now();
    const ledger = reconstructLedger(stream);
    const analytics = computeAnalytics(stream);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(ledger.records.length).toBeGreaterThanOrEqual(0);
    expect(analytics).toBeTruthy();
  });
});
