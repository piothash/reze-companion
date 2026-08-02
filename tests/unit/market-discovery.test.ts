import { describe, expect, it } from "vitest";

import { loadMarketConfig, marketConfigDigest, parseMarketConfigOrThrow } from "@/core/market/configuration";
import { MarketDiscoveryService, parseMarketMetadata, renderSlug } from "@/core/market/discovery";
import { FixedClock } from "@/core/shared/time";

export const BASE_ENV = {
  MARKET_DISCOVERY_BASE_URL: "https://gamma.example.test",
  MARKET_SLUG_TEMPLATE: "btc-updown-5m-{slot}",
  TWAP_FEED_ID: "btc-usd",
  TWAP_NETWORK: "testnet",
  TWAP_FEED_PROVIDER: "in-memory",
  TWAP_PRECISION: "2",
  TWAP_OBSERVATION_INTERVAL: "1000",
  TWAP_MAX_STALENESS: "15000",
  TWAP_WINDOW_SECONDS: "300",
  PTB_METADATA_FIELD: "ptb",
};

const RESOLVES_AT = Date.parse("2026-02-01T00:05:00.000Z");

const RAW_MARKET = {
  conditionId: "0xcond",
  slug: "btc-updown-5m-1769904000",
  question: "Will BTC be up?",
  outcomes: JSON.stringify(["Up", "Down"]),
  clobTokenIds: JSON.stringify(["tok-up", "tok-down"]),
  active: true,
  closed: false,
  endDate: "2026-02-01T00:05:00.000Z",
  startDate: "2026-02-01T00:00:00.000Z",
  ptb: "64000.125",
};

describe("market configuration", () => {
  it("loads every value from the environment and rejects missing endpoints", () => {
    const config = loadMarketConfig(BASE_ENV);
    expect(config.discovery.baseUrl).toBe("https://gamma.example.test");
    expect(config.feed.network).toBe("testnet");
    expect(config.twap.precision).toBe(2);
    expect(() => loadMarketConfig({ ...BASE_ENV, MARKET_DISCOVERY_BASE_URL: undefined })).toThrow();
  });

  it("switches to mainnet by environment alone", () => {
    const mainnet = loadMarketConfig({ ...BASE_ENV, TWAP_NETWORK: "mainnet" });
    expect(mainnet.feed.network).toBe("mainnet");
  });

  it("produces a stable digest independent of key order", () => {
    const a = loadMarketConfig(BASE_ENV);
    const b = parseMarketConfigOrThrow(JSON.parse(JSON.stringify(a)));
    expect(marketConfigDigest(a)).toBe(marketConfigDigest(b));
  });
});

describe("market discovery", () => {
  const config = loadMarketConfig(BASE_ENV);
  const clock = new FixedClock("2026-02-01T00:01:00.000Z");

  it("renders slugs from the configured template", () => {
    expect(renderSlug("btc-updown-5m-{slot}", 1769904000, "testnet")).toBe(
      "btc-updown-5m-1769904000",
    );
  });

  it("maps outcome tokens by label, never positionally", () => {
    const reversed = {
      ...RAW_MARKET,
      outcomes: JSON.stringify(["Down", "Up"]),
      clobTokenIds: JSON.stringify(["tok-down", "tok-up"]),
    };
    const descriptor = parseMarketMetadata({
      raw: reversed,
      slug: "s",
      resolvesAtMillis: RESOLVES_AT,
      config,
      clock,
    });
    expect(descriptor.outcomes[0]).toMatchObject({ key: "up", tokenId: "tok-up" });
    expect(descriptor.valid).toBe(true);
    expect(descriptor.ptbValue).toBeCloseTo(64000.125);
    expect(descriptor.ptbSource?.field).toBe("ptb");
  });

  it("marks markets invalid instead of throwing", () => {
    const descriptor = parseMarketMetadata({
      raw: { ...RAW_MARKET, conditionId: undefined, clobTokenIds: "[]" },
      slug: "s",
      resolvesAtMillis: RESOLVES_AT,
      config,
      clock,
    });
    expect(descriptor.valid).toBe(false);
    expect(descriptor.invalidReasons.length).toBeGreaterThan(0);
  });

  it("builds a configuration-driven endpoint and caches discoveries", async () => {
    let calls = 0;
    const service = new MarketDiscoveryService({
      config,
      clock,
      httpFetch: async () => {
        calls += 1;
        return new Response(JSON.stringify([RAW_MARKET]), { status: 200 });
      },
    });
    expect(service.endpointFor("abc")).toBe("https://gamma.example.test/markets?slug=abc");
    const first = await service.discover(RESOLVES_AT);
    const second = await service.discover(RESOLVES_AT);
    expect(calls).toBe(1);
    expect(first?.marketInstanceId).toBe(second?.marketInstanceId);
  });

  it("raises a discovery error on transport failure", async () => {
    const service = new MarketDiscoveryService({
      config,
      clock,
      httpFetch: async () => new Response("nope", { status: 500 }),
    });
    await expect(service.discover(RESOLVES_AT)).rejects.toThrow(/500/);
  });
});

export { RAW_MARKET, RESOLVES_AT };
