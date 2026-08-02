/**
 * M7.0 — feed provider abstraction and live telemetry contract.
 *
 * These tests encode the ADR-0005 guarantee: the V1 (testnet) → V2 (mainnet /
 * Chainlink Data Streams) transition is an environment change only.
 */
import { describe, expect, it } from "vitest";

import {
  describeFeedMigration,
  FeedProviderError,
  feedTransportFor,
  resolveFeedProvider,
} from "@/core/market/feed-provider";
import { loadMarketConfig } from "@/core/market/configuration";
import {
  classifyFeedFreshness,
  isTelemetryCurrent,
  orderWindowsByOffset,
  runtimeTelemetrySchema,
  secondsUntil,
  selectActiveWindow,
  type TelemetryWindow,
} from "@/core/platform/runtime-telemetry";

const V1 = {
  TWAP_FEED_PROVIDER: "testnet",
  TWAP_FEED_ID: "btc-usd-testnet",
  NETWORK: "testnet",
  TWAP_FEED_ENDPOINT: "https://feed.example.test/{network}/{feedId}",
};

const V2 = {
  TWAP_FEED_PROVIDER: "chainlink-datastreams",
  TWAP_FEED_ID: "0xfeed",
  NETWORK: "mainnet",
  TWAP_FEED_ENDPOINT: "https://streams.example.com/{feedId}",
};

describe("feed provider resolution", () => {
  it("resolves the V1 testnet provider from the environment", () => {
    const resolved = resolveFeedProvider(V1);
    expect(resolved.providerId).toBe("testnet");
    expect(resolved.generation).toBe("V1");
    expect(resolved.transport).toBe("http-json");
    expect(resolved.network).toBe("testnet");
    expect(resolved.feedId).toBe("btc-usd-testnet");
  });

  it("resolves the V2 data streams provider with its own response paths", () => {
    const resolved = resolveFeedProvider(V2);
    expect(resolved.generation).toBe("V2");
    expect(resolved.valuePath).toBe("report.price");
    expect(resolved.timestampPath).toBe("report.observationsTimestamp");
  });

  it("refuses a V2 provider on testnet and a V1 provider on mainnet", () => {
    expect(() => resolveFeedProvider({ ...V2, NETWORK: "testnet" })).toThrow(FeedProviderError);
    expect(() => resolveFeedProvider({ ...V1, NETWORK: "mainnet" })).toThrow(FeedProviderError);
  });

  it("refuses to boot without a feed id or endpoint", () => {
    expect(() => resolveFeedProvider({ ...V1, TWAP_FEED_ID: "" })).toThrow(/TWAP_FEED_ID/);
    expect(() => resolveFeedProvider({ ...V1, TWAP_FEED_ENDPOINT: undefined })).toThrow(
      /TWAP_FEED_ENDPOINT/,
    );
  });

  it("rejects an unknown provider id", () => {
    expect(() => resolveFeedProvider({ ...V1, TWAP_FEED_PROVIDER: "binance" })).toThrow(
      /unknown provider/,
    );
  });

  it("maps semantic provider ids onto transports", () => {
    expect(feedTransportFor("testnet")).toBe("http-json");
    expect(feedTransportFor("in-memory")).toBe("in-memory");
    expect(feedTransportFor("nope")).toBeNull();
  });

  it("describes V1 → V2 as an environment-only migration", () => {
    const report = describeFeedMigration(V1, V2);
    expect(report.codeChangeRequired).toBe(false);
    expect(report.restartRequired).toBe(true);
    expect(report.from.generation).toBe("V1");
    expect(report.to.generation).toBe("V2");
    expect(report.changes.map((change) => change.key).sort()).toEqual([
      "NETWORK",
      "TWAP_FEED_ENDPOINT",
      "TWAP_FEED_ID",
      "TWAP_FEED_PROVIDER",
    ]);
  });

  it("feeds the market domain configuration without code changes", () => {
    const base = {
      MARKET_DISCOVERY_BASE_URL: "https://gamma.example.test",
      MARKET_SLUG_TEMPLATE: "btc-{slot}",
    };
    const v1 = loadMarketConfig({ ...base, ...V1 });
    const v2 = loadMarketConfig({ ...base, ...V2 });
    expect(v1.feed.generation).toBe("V1");
    expect(v2.feed.generation).toBe("V2");
    expect(v1.ptb.source).toBe("market-metadata");
    expect(v2.ptb.source).toBe("market-metadata");
    // Only the feed section differs between the two deployments.
    expect({ ...v1, feed: null }).toEqual({ ...v2, feed: null });
  });
});

describe("runtime telemetry contract", () => {
  const emittedAtIso = "2026-08-02T08:00:00.000Z";
  const now = Date.parse(emittedAtIso);

  it("parses a partially reporting engine without inventing values", () => {
    const parsed = runtimeTelemetrySchema.parse({ emittedAtIso, markets: [] });
    expect(parsed.feed).toBeNull();
    expect(parsed.windows).toEqual([]);
    expect(parsed.execution).toBeNull();
  });

  it("classifies feed freshness against the engine staleness budget", () => {
    expect(classifyFeedFreshness(1_000, 10_000)).toBe("FRESH");
    expect(classifyFeedFreshness(8_000, 10_000)).toBe("AGING");
    expect(classifyFeedFreshness(20_000, 10_000)).toBe("STALE");
    expect(classifyFeedFreshness(null, 10_000)).toBe("UNKNOWN");
  });

  it("treats telemetry older than two sync intervals as not current", () => {
    expect(isTelemetryCurrent(emittedAtIso, now + 5_000, 5_000)).toBe(true);
    expect(isTelemetryCurrent(emittedAtIso, now + 60_000, 5_000)).toBe(false);
    expect(isTelemetryCurrent(null, now, 5_000)).toBe(false);
  });

  it("counts down to window boundaries", () => {
    expect(secondsUntil("2026-08-02T08:00:15.000Z", now)).toBe(15);
    expect(secondsUntil("2026-08-02T07:59:57.000Z", now)).toBe(-3);
    expect(secondsUntil(null, now)).toBeNull();
  });

  it("orders windows by configured offset and selects the active one", () => {
    const windows: TelemetryWindow[] = [3, 15, 7].map((offset) =>
      ({
        windowInstanceId: `w-${offset}`,
        windowDefinitionId: null,
        marketInstanceId: null,
        offsetSeconds: offset,
        state: "OPEN",
        priority: null,
        bufferPercent: null,
        activatesAtIso: new Date(now - offset * 1_000).toISOString(),
        expiresAtIso: new Date(now + offset * 1_000).toISOString(),
        decision: null,
        executionIntentId: null,
        reasonCode: null,
      }) satisfies TelemetryWindow,
    );

    expect(orderWindowsByOffset(windows).map((w) => w.offsetSeconds)).toEqual([15, 7, 3]);
    expect(selectActiveWindow(windows, now)?.windowInstanceId).toBe("w-3");
    expect(selectActiveWindow(windows, now + 60_000)).toBeNull();
  });
});
