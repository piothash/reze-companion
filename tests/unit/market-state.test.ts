import { describe, expect, it } from "vitest";

import { InMemoryEventSink } from "@/core/contracts/event-envelope";
import { loadMarketConfig } from "@/core/market/configuration";
import { parseMarketMetadata } from "@/core/market/discovery";
import { MarketStateDomain } from "@/core/market/domain";
import { MARKET_EVENT_TYPES } from "@/core/market/events";
import { MarketLifecycleEngine, evaluateLifecycle } from "@/core/market/lifecycle";
import { FixedClock } from "@/core/shared/time";
import type { MarketDescriptor, RawFeedSample } from "@/core/market";

const ENV = {
  MARKET_DISCOVERY_BASE_URL: "https://gamma.example.test",
  MARKET_SLUG_TEMPLATE: "btc-updown-5m-{slot}",
  MARKET_CLOSING_LEAD_MS: "30000",
  TWAP_FEED_ID: "btc-usd",
  TWAP_FEED_PROVIDER: "in-memory",
  TWAP_NETWORK: "testnet",
  TWAP_PRECISION: "2",
  TWAP_MAX_STALENESS: "10000",
  TWAP_WINDOW_SECONDS: "300",
  TWAP_MIN_OBSERVATIONS: "2",
  PTB_METADATA_FIELD: "ptb",
  PTB_MIN_VALUE: "1",
  PTB_MAX_VALUE: "1000000",
};

const config = loadMarketConfig(ENV);

function descriptorAt(clockIso: string, overrides: Record<string, unknown> = {}): MarketDescriptor {
  return parseMarketMetadata({
    raw: {
      conditionId: "0xcond",
      slug: "btc-updown-5m-1",
      outcomes: JSON.stringify(["Up", "Down"]),
      clobTokenIds: JSON.stringify(["tok-up", "tok-down"]),
      active: true,
      closed: false,
      startDate: "2026-02-01T00:00:00.000Z",
      endDate: "2026-02-01T00:05:00.000Z",
      ptb: "64000",
      ...overrides,
    },
    slug: "btc-updown-5m-1",
    resolvesAtMillis: Date.parse("2026-02-01T00:05:00.000Z"),
    config,
    clock: new FixedClock(clockIso),
  });
}

describe("market lifecycle", () => {
  it("walks DISCOVERED → ACTIVE → CLOSING → RESOLVED", () => {
    const clock = new FixedClock("2026-02-01T00:01:00.000Z");
    const engine = new MarketLifecycleEngine(config, clock);
    const descriptor = descriptorAt("2026-02-01T00:01:00.000Z");
    expect(engine.evaluate(descriptor).to).toBe("ACTIVE");
    clock.set(Date.parse("2026-02-01T00:04:40.000Z"));
    expect(engine.evaluate(descriptor).to).toBe("CLOSING");
    clock.set(Date.parse("2026-02-01T00:05:00.000Z"));
    expect(engine.evaluate(descriptor).to).toBe("RESOLVED");
    expect(engine.isTerminal).toBe(true);
  });

  it("moves invalid metadata straight to INVALID", () => {
    const clock = new FixedClock("2026-02-01T00:01:00.000Z");
    const engine = new MarketLifecycleEngine(config, clock);
    const invalid = descriptorAt("2026-02-01T00:01:00.000Z", { conditionId: undefined });
    expect(engine.evaluate(invalid).to).toBe("INVALID");
    expect(engine.isTerminal).toBe(true);
  });

  it("is pure: identical inputs produce identical verdicts", () => {
    const clock = new FixedClock("2026-02-01T00:01:00.000Z");
    const descriptor = descriptorAt("2026-02-01T00:01:00.000Z");
    const a = evaluateLifecycle("DISCOVERED", descriptor, config, clock);
    const b = evaluateLifecycle("DISCOVERED", descriptor, config, clock);
    expect(a).toEqual(b);
  });

  it("replays a recorded transition list deterministically", () => {
    const clock = new FixedClock("2026-02-01T00:01:00.000Z");
    const replayed = MarketLifecycleEngine.replay(config, clock, ["ACTIVATE", "BEGIN_CLOSING", "RESOLVE"]);
    expect(replayed.state).toBe("RESOLVED");
    expect(replayed.history.map((entry) => entry.to)).toEqual(["ACTIVE", "CLOSING", "RESOLVED"]);
  });
});

async function runDomain(clock: FixedClock, samples: readonly RawFeedSample[]) {
  const sink = new InMemoryEventSink();
  const domain = new MarketStateDomain({
    config,
    clock,
    sink,
    configVersion: "1.0.0",
    samples,
  });
  await domain.adopt(descriptorAt(clock.isoNow()));
  const snapshots = [];
  for (const sample of samples) {
    clock.advance(1_000);
    const snapshot = await domain.ingest({ ...sample, observedAt: clock.now() });
    if (snapshot) snapshots.push(snapshot);
  }
  return { domain, sink, snapshots };
}

describe("authoritative market state", () => {
  const samples: RawFeedSample[] = [
    { value: 100, observedAt: 0 },
    { value: 102, observedAt: 0 },
    { value: 104, observedAt: 0 },
  ];

  it("publishes monotonically versioned immutable snapshots with every field", async () => {
    const { snapshots } = await runDomain(new FixedClock("2026-02-01T00:01:00.000Z"), samples);
    expect(snapshots.map((s) => s.marketStateVersion)).toEqual([1, 2, 3]);
    const latest = snapshots[snapshots.length - 1]!;
    expect(latest.marketInstanceId).toMatch(/^mkt_/);
    expect(latest.lifecycle).toBe("ACTIVE");
    expect(latest.freshness.state).toBe("FRESH");
    expect(latest.twap?.value).not.toBeNull();
    expect(latest.signal?.effectiveTwap).not.toBeNull();
    expect(latest.ptb?.value).toBe(64000);
    expect(latest.configuration.marketConfigVersion).toBe("1.0.0");
    expect(latest.configuration.marketConfigDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(Object.isFrozen(latest)).toBe(true);
  });

  it("emits every canonical market event through the frozen envelope", async () => {
    const { sink } = await runDomain(new FixedClock("2026-02-01T00:01:00.000Z"), samples);
    const types = new Set(sink.ordered().map((event) => event.type));
    expect(types).toContain(MARKET_EVENT_TYPES.discovered);
    expect(types).toContain(MARKET_EVENT_TYPES.observationReceived);
    expect(types).toContain(MARKET_EVENT_TYPES.twapUpdated);
    expect(types).toContain(MARKET_EVENT_TYPES.ptbUpdated);
    expect(types).toContain(MARKET_EVENT_TYPES.signalConditioned);
    expect(types).toContain(MARKET_EVENT_TYPES.lifecycleUpdated);
    expect(types).toContain(MARKET_EVENT_TYPES.stateUpdated);
    for (const event of sink.ordered()) {
      expect(event.metadata.source).toBe("market-state");
      expect(event.metadata.marketInstanceId).toMatch(/^mkt_/);
      expect(event.schemaVersion).toBe("1.0.0");
    }
  });

  it("replays identically from the same clock and observation sequence", async () => {
    const first = await runDomain(new FixedClock("2026-02-01T00:01:00.000Z"), samples);
    const second = await runDomain(new FixedClock("2026-02-01T00:01:00.000Z"), samples);
    expect(second.snapshots).toEqual(first.snapshots);
    expect(second.sink.ordered().map((e) => [e.type, e.eventId, e.occurredAt])).toEqual(
      first.sink.ordered().map((e) => [e.type, e.eventId, e.occurredAt]),
    );
  });

  it("marks the signal unusable once the feed goes stale", async () => {
    const clock = new FixedClock("2026-02-01T00:01:00.000Z");
    const sink = new InMemoryEventSink();
    const domain = new MarketStateDomain({ config, clock, sink, configVersion: "1.0.0", samples: [] });
    await domain.adopt(descriptorAt(clock.isoNow()));
    await domain.ingest({ value: 100, observedAt: clock.now() });
    clock.advance(1_000);
    await domain.ingest({ value: 101, observedAt: clock.now() });
    clock.advance(60_000);
    const stale = await domain.ingest({ value: Number.NaN, observedAt: clock.now() });
    expect(stale?.freshness.state).toBe("STALE");
    expect(stale?.signal?.usable).toBe(false);
  });
});
