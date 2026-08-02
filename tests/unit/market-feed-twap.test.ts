import { describe, expect, it } from "vitest";

import { loadMarketConfig } from "@/core/market/configuration";
import { FeedEngine, InMemoryFeedProvider, roundTo } from "@/core/market/feed-engine";
import { TwapEngine, computeTimeWeightedAverage } from "@/core/market/twap-engine";
import { PtbEngine } from "@/core/market/ptb-engine";
import { SignalConditioning } from "@/core/market/signal-conditioning";
import { parseMarketMetadata } from "@/core/market/discovery";
import { FixedClock } from "@/core/shared/time";
import type { Observation } from "@/core/market/types";

const ENV = {
  MARKET_DISCOVERY_BASE_URL: "https://gamma.example.test",
  MARKET_SLUG_TEMPLATE: "btc-updown-5m-{slot}",
  TWAP_FEED_ID: "btc-usd",
  TWAP_FEED_PROVIDER: "in-memory",
  TWAP_NETWORK: "testnet",
  TWAP_PRECISION: "2",
  TWAP_MAX_STALENESS: "10000",
  TWAP_WINDOW_SECONDS: "60",
  TWAP_MIN_OBSERVATIONS: "2",
};

function setup(overrides: Record<string, string | undefined> = {}) {
  const config = loadMarketConfig({ ...ENV, ...overrides });
  const clock = new FixedClock("2026-02-01T00:00:00.000Z");
  return { config, clock };
}

function observation(value: number, iso: string, sequence: number): Observation {
  return {
    feedId: "btc-usd",
    provider: "in-memory",
    network: "testnet",
    value,
    observedAtIso: iso,
    receivedAtIso: iso,
    sequence,
  };
}

describe("feed engine", () => {
  it("rounds to configured precision and stamps monotonic sequences", () => {
    const { config, clock } = setup();
    const engine = new FeedEngine(config, clock, new InMemoryFeedProvider([]));
    const first = engine.ingest({ value: 100.126, observedAt: clock.now() });
    expect(first.accepted).toBe(true);
    expect(first.observation?.value).toBe(100.13);
    clock.advance(1000);
    const second = engine.ingest({ value: 101, observedAt: clock.now() });
    expect(second.observation?.sequence).toBe(1);
  });

  it("reports UNAVAILABLE, FRESH and STALE freshness", () => {
    const { config, clock } = setup();
    const engine = new FeedEngine(config, clock, new InMemoryFeedProvider([]));
    expect(engine.freshness().state).toBe("UNAVAILABLE");
    engine.ingest({ value: 100, observedAt: clock.now() });
    expect(engine.freshness().state).toBe("FRESH");
    clock.advance(10_001);
    const stale = engine.freshness();
    expect(stale.state).toBe("STALE");
    expect(stale.ageMillis).toBe(10_001);
    clock.advance(1);
    engine.ingest({ value: 101, observedAt: clock.now() });
    expect(engine.freshness().state).toBe("FRESH");
  });

  it("rejects malformed and out-of-order observations", () => {
    const { config, clock } = setup();
    const engine = new FeedEngine(config, clock, new InMemoryFeedProvider([]));
    expect(engine.ingest({ value: Number.NaN, observedAt: clock.now() }).rejectionReason).toMatch(
      /malformed/,
    );
    clock.advance(5_000);
    engine.ingest({ value: 100, observedAt: clock.now() });
    const late = engine.ingest({ value: 99, observedAt: clock.now() - 1_000 });
    expect(late.accepted).toBe(false);
    expect(late.rejectionReason).toMatch(/out-of-order/);
  });

  it("honours the configured observation interval", () => {
    const { config, clock } = setup();
    const engine = new FeedEngine(config, clock, new InMemoryFeedProvider([]));
    expect(engine.shouldSample()).toBe(true);
    engine.ingest({ value: 100, observedAt: clock.now() });
    expect(engine.shouldSample()).toBe(false);
    clock.advance(1_000);
    expect(engine.shouldSample()).toBe(true);
  });

  it("surfaces provider failures without throwing", async () => {
    const { config, clock } = setup();
    const engine = new FeedEngine(config, clock, new InMemoryFeedProvider([]));
    const result = await engine.poll();
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toMatch(/exhausted/);
  });
});

describe("twap engine", () => {
  it("weights observations by elapsed time deterministically", () => {
    const value = computeTimeWeightedAverage(
      [
        observation(100, "2026-02-01T00:00:00.000Z", 0),
        observation(200, "2026-02-01T00:00:30.000Z", 1),
      ],
      Date.parse("2026-02-01T00:00:40.000Z"),
      2,
    );
    // 100 for 30s, 200 for 10s → 125
    expect(value).toBe(125);
  });

  it("respects precision and produces immutable snapshots", () => {
    const { config, clock } = setup({ TWAP_PRECISION: "3" });
    const engine = new TwapEngine(config, clock);
    engine.add(observation(100.0005, "2026-02-01T00:00:00.000Z", 0));
    clock.advance(10_000);
    engine.add(observation(100.0015, "2026-02-01T00:00:10.000Z", 1));
    const snapshot = engine.snapshot({
      state: "FRESH",
      ageMillis: 0,
      maxStalenessMillis: 10_000,
      lastObservedAtIso: "2026-02-01T00:00:10.000Z",
    });
    expect(snapshot.precision).toBe(3);
    expect(String(snapshot.value).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => {
      (snapshot as { value: number | null }).value = 1;
    }).toThrow();
  });

  it("withholds a value below the configured minimum observations", () => {
    const { config, clock } = setup({ TWAP_MIN_OBSERVATIONS: "3" });
    const engine = new TwapEngine(config, clock);
    engine.add(observation(100, "2026-02-01T00:00:00.000Z", 0));
    const snapshot = engine.snapshot({
      state: "FRESH",
      ageMillis: 0,
      maxStalenessMillis: 10_000,
      lastObservedAtIso: "2026-02-01T00:00:00.000Z",
    });
    expect(snapshot.value).toBeNull();
    expect(snapshot.observationCount).toBe(1);
  });

  it("evicts observations older than the window", () => {
    const { config, clock } = setup();
    const engine = new TwapEngine(config, clock);
    engine.add(observation(100, "2026-02-01T00:00:00.000Z", 0));
    clock.advance(120_000);
    engine.add(observation(200, "2026-02-01T00:02:00.000Z", 1));
    const snapshot = engine.snapshot({
      state: "FRESH",
      ageMillis: 0,
      maxStalenessMillis: 10_000,
      lastObservedAtIso: "2026-02-01T00:02:00.000Z",
    });
    expect(snapshot.observationCount).toBe(1);
  });

  it("rounds half-up at the configured precision", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
  });
});

describe("ptb engine", () => {
  const { config, clock } = setup({ PTB_MIN_VALUE: "1", PTB_MAX_VALUE: "1000000" });

  function descriptor(raw: Record<string, unknown>) {
    return parseMarketMetadata({
      raw: {
        conditionId: "0xcond",
        outcomes: JSON.stringify(["Up", "Down"]),
        clobTokenIds: JSON.stringify(["a", "b"]),
        endDate: "2026-02-01T00:05:00.000Z",
        startDate: "2026-02-01T00:00:00.000Z",
        ...raw,
      },
      slug: "s",
      resolvesAtMillis: Date.parse("2026-02-01T00:05:00.000Z"),
      config,
      clock,
    });
  }

  it("accepts a PTB published in official market metadata", () => {
    const snapshot = new PtbEngine(config, clock).resolve(descriptor({ ptb: "64000.129" }));
    expect(snapshot.valid).toBe(true);
    expect(snapshot.value).toBe(64000.13);
    expect(snapshot.source?.source).toBe("market-metadata");
  });

  it("rejects an absent or out-of-bounds PTB without guessing", () => {
    const engine = new PtbEngine(config, clock);
    expect(engine.resolve(descriptor({})).valid).toBe(false);
    const outOfBounds = engine.resolve(descriptor({ ptb: "99999999" }));
    expect(outOfBounds.valid).toBe(false);
    expect(outOfBounds.rejectionReason).toMatch(/outside configured bounds/);
  });
});

describe("signal conditioning", () => {
  it("publishes an effective TWAP without any decision output", () => {
    const { config, clock } = setup({ SIGNAL_OFFSET: "0.5" });
    const conditioning = new SignalConditioning(config, clock);
    const signal = conditioning.condition({
      value: 100,
      windowSeconds: 60,
      precision: 2,
      observationCount: 5,
      windowStartIso: "2026-02-01T00:00:00.000Z",
      windowEndIso: "2026-02-01T00:00:30.000Z",
      freshness: {
        state: "FRESH",
        ageMillis: 0,
        maxStalenessMillis: 10_000,
        lastObservedAtIso: "2026-02-01T00:00:30.000Z",
      },
      computedAtIso: "2026-02-01T00:00:30.000Z",
    });
    expect(signal.usable).toBe(true);
    expect(signal.effectiveTwap).toBe(100.5);
    expect(Object.keys(signal)).not.toContain("side");
  });

  it("refuses to condition a stale or thin signal", () => {
    const { config, clock } = setup();
    const conditioning = new SignalConditioning(config, clock);
    const stale = conditioning.condition({
      value: 100,
      windowSeconds: 60,
      precision: 2,
      observationCount: 5,
      windowStartIso: null,
      windowEndIso: null,
      freshness: {
        state: "STALE",
        ageMillis: 99_999,
        maxStalenessMillis: 10_000,
        lastObservedAtIso: "2026-02-01T00:00:00.000Z",
      },
      computedAtIso: "2026-02-01T00:00:30.000Z",
    });
    expect(stale.usable).toBe(false);
    expect(stale.rejectionReason).toMatch(/STALE/);
    expect(conditioning.condition(null).usable).toBe(false);
  });
});
