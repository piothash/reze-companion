import { describe, expect, it } from "vitest";

import { EventEnvelopeFactory, InMemoryEventSink } from "@/core/contracts/event-envelope";
import { FixedClock } from "@/core/shared/time";
import {
  ExposureLedger,
  Order,
  RecordingVenueGateway,
  StandingOrderEngine,
  StandingOrderSession,
  TradeCoordinator,
  adaptIntent,
  evaluateRisk,
  parseTradeConfigOrThrow,
  tradeConfigFromEnv,
  type RiskInput,
  type TradeConditions,
  type TradeDomainConfig,
} from "@/core/trade";

const CLOCK_START = Date.parse("2026-01-01T00:00:00.000Z");

function clock() {
  return new FixedClock(CLOCK_START);
}

function config(overrides: Record<string, unknown> = {}): TradeDomainConfig {
  const base = parseTradeConfigOrThrow({
    risk: { maxExposure: 100, maxIntentExposure: 50 },
    execution: {
      timeoutMillis: 5_000,
      repricingEnabled: true,
      repricingIntervalMillis: 1_000,
      repricingMaxAttempts: 2,
      minMeaningfulQuantity: 5,
      tickSize: 0.01,
      precision: 2,
    },
  });
  return parseTradeConfigOrThrow({
    ...base,
    ...overrides,
    risk: { ...base.risk, ...((overrides["risk"] as object) ?? {}) },
    execution: { ...base.execution, ...((overrides["execution"] as object) ?? {}) },
  });
}

const CONDITIONS: TradeConditions = {
  marketValid: true,
  marketTradable: true,
  feedFreshnessState: "FRESH",
  feedAgeMillis: 100,
  outcomePosition: 0,
  availableLiquidity: 1_000,
  spread: 0.01,
  maxPrice: 0.5,
  outcomeKeys: { BUY_UP: "outcome-up", BUY_DOWN: "outcome-down" },
};

const INTENT = {
  executionIntentId: "eit_test_1",
  marketInstanceId: "mkt_test_1",
  correlationId: "cor_test_1",
  side: "BUY_UP" as const,
  positionSize: 10,
  retryCount: 0,
  riskProfileVersion: "1.0.0",
};

function riskInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    executionIntentId: INTENT.executionIntentId,
    marketInstanceId: INTENT.marketInstanceId,
    riskProfileVersion: "1.0.0",
    requestedExposure: 10,
    requestedQuantity: 20,
    outcomeKey: "outcome-up",
    killSwitchEngaged: false,
    marketValid: true,
    marketTradable: true,
    feedFreshnessState: "FRESH",
    feedAgeMillis: 100,
    liveExposure: 0,
    reservedExposure: 0,
    outcomePosition: 0,
    availableLiquidity: 1_000,
    spread: 0.01,
    ...overrides,
  };
}

function coordinator(options: {
  cfg?: TradeDomainConfig;
  gateway?: RecordingVenueGateway;
  fixed?: FixedClock;
  onQuota?: (id: string) => void;
  onSettlement?: (id: string) => void;
}) {
  const fixed = options.fixed ?? clock();
  const gateway =
    options.gateway ??
    new RecordingVenueGateway({
      book: {
        outcomeKey: "outcome-up",
        bestBid: 0.48,
        bestAsk: 0.52,
        bidSize: 100,
        askSize: 100,
        observedAtIso: new Date(CLOCK_START).toISOString(),
      },
    });
  const sink = new InMemoryEventSink();
  return {
    fixed,
    gateway,
    sink,
    coordinator: new TradeCoordinator({
      config: options.cfg ?? config(),
      gateway,
      clock: fixed,
      eventFactory: new EventEnvelopeFactory(fixed, "trade"),
      eventSink: sink,
      marketInstanceId: INTENT.marketInstanceId,
      ...(options.onQuota ? { onQuotaCommit: options.onQuota } : {}),
      ...(options.onSettlement
        ? { onSettlement: (report) => options.onSettlement!(report.executionIntentId) }
        : {}),
    }),
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe("trade configuration", () => {
  it("rejects an intent exposure larger than the total exposure limit", () => {
    expect(() =>
      parseTradeConfigOrThrow({
        risk: { maxExposure: 10, maxIntentExposure: 20 },
        execution: {},
      }),
    ).toThrow(/maxIntentExposure/);
  });

  it("reads every execution value from the environment, with no hardcoding", () => {
    const parsed = tradeConfigFromEnv({
      RISK_MAX_EXPOSURE: "250",
      RISK_MAX_INTENT_EXPOSURE: "25",
      ORDER_TIMEOUT_MS: "7500",
      ORDER_RETRY_COUNT: "3",
      ORDER_REPRICING_ENABLED: "true",
    });
    expect(parsed.risk.maxExposure).toBe(250);
    expect(parsed.execution.timeoutMillis).toBe(7_500);
    expect(parsed.execution.retryCount).toBe(3);
    expect(parsed.execution.repricingEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Risk Engine
// ---------------------------------------------------------------------------

describe("risk engine", () => {
  const options = { profile: config().risk, evaluatedAtIso: "2026-01-01T00:00:00.000Z" };

  it("is pure: identical inputs always produce an identical verdict", () => {
    const a = evaluateRisk(riskInput(), options);
    const b = evaluateRisk(riskInput(), options);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("always evaluates every check so the trace is complete", () => {
    const verdict = evaluateRisk(riskInput(), options);
    expect(verdict.checks).toHaveLength(7);
    expect(verdict.decision).toBe("ALLOW");
  });

  it("denies on the kill switch before anything else", () => {
    const verdict = evaluateRisk(riskInput({ killSwitchEngaged: true }), options);
    expect(verdict.decision).toBe("DENY");
    expect(verdict.deniedBy).toBe("KILL_SWITCH");
  });

  it("denies a stale feed, an invalid market and an over-limit exposure", () => {
    expect(evaluateRisk(riskInput({ feedFreshnessState: "STALE" }), options).deniedBy).toBe(
      "FEED_FRESHNESS",
    );
    expect(evaluateRisk(riskInput({ marketTradable: false }), options).deniedBy).toBe(
      "MARKET_VALIDITY",
    );
    expect(evaluateRisk(riskInput({ requestedExposure: 500 }), options).deniedBy).toBe("EXPOSURE");
  });

  it("returns a frozen verdict", () => {
    expect(Object.isFrozen(evaluateRisk(riskInput(), options))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exposure ledger
// ---------------------------------------------------------------------------

describe("exposure ledger", () => {
  it("never lets reserved + live exceed the limit", () => {
    const ledger = new ExposureLedger({
      marketInstanceId: "mkt",
      limit: 100,
      clock: clock(),
    });
    expect(ledger.reserve({ executionIntentId: "a", outcomeKey: "o", amount: 60 }).ok).toBe(true);
    const second = ledger.reserve({ executionIntentId: "b", outcomeKey: "o", amount: 60 });
    expect(second.ok).toBe(false);
    expect(ledger.invariantHolds).toBe(true);
  });

  it("is idempotent per execution intent", () => {
    const ledger = new ExposureLedger({ marketInstanceId: "mkt", limit: 100, clock: clock() });
    ledger.reserve({ executionIntentId: "a", outcomeKey: "o", amount: 10 });
    const duplicate = ledger.reserve({ executionIntentId: "a", outcomeKey: "o", amount: 10 });
    expect(duplicate).toMatchObject({ ok: false, reason: "DUPLICATE" });
  });

  it("converts reservations into live exposure and releases the remainder", () => {
    const ledger = new ExposureLedger({ marketInstanceId: "mkt", limit: 100, clock: clock() });
    ledger.reserve({ executionIntentId: "a", outcomeKey: "o", amount: 40 });
    ledger.commit("a", 25);
    expect(ledger.live).toBe(25);
    expect(ledger.reserved).toBe(15);
    const settled = ledger.settle("a");
    expect(settled?.released).toBe(15);
    expect(ledger.reserved).toBe(0);
    expect(ledger.live).toBe(25);
    expect(ledger.invariantHolds).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Order and Order FSM
// ---------------------------------------------------------------------------

describe("order", () => {
  function order() {
    return new Order({
      executionIntentId: "eit",
      marketInstanceId: "mkt",
      outcomeKey: "o",
      attempt: 0,
      repriceCount: 0,
      quantity: 10,
      limitPrice: 0.5,
      timeInForce: "GTC",
      postOnly: true,
      clock: clock(),
    });
  }

  it("walks CREATED → SUBMITTED → WORKING → PARTIALLY_FILLED → FILLED", () => {
    const o = order();
    expect(o.state).toBe("CREATED");
    o.submit();
    expect(o.state).toBe("SUBMITTED");
    o.acknowledge("v1");
    expect(o.state).toBe("WORKING");
    o.applyFill({ venueFillId: "f1", quantity: 4, price: 0.5 });
    expect(o.state).toBe("PARTIALLY_FILLED");
    o.applyFill({ venueFillId: "f2", quantity: 6, price: 0.5 });
    expect(o.state).toBe("FILLED");
    expect(o.filledQuantity).toBe(10);
  });

  it("ignores a duplicate venue fill id", () => {
    const o = order();
    o.submit();
    o.acknowledge("v1");
    o.applyFill({ venueFillId: "f1", quantity: 4, price: 0.5 });
    const duplicate = o.applyFill({ venueFillId: "f1", quantity: 4, price: 0.5 });
    expect(duplicate.duplicate).toBe(true);
    expect(o.filledQuantity).toBe(4);
  });

  it("restores from a snapshot with identical state and fills", () => {
    const o = order();
    o.submit();
    o.acknowledge("v1");
    o.applyFill({ venueFillId: "f1", quantity: 4, price: 0.5 });
    const restored = Order.restore(o.snapshot(), clock());
    expect(restored.state).toBe(o.state);
    expect(restored.filledQuantity).toBe(o.filledQuantity);
    expect(restored.snapshot().fills).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Execution adapter
// ---------------------------------------------------------------------------

describe("execution adapter", () => {
  it("produces identical constraints for identical inputs", () => {
    const cfg = config();
    const a = adaptIntent(INTENT, {
      outcomeKeys: CONDITIONS.outcomeKeys,
      maxPrice: 0.5,
      execution: cfg.execution,
    });
    const b = adaptIntent(INTENT, {
      outcomeKeys: CONDITIONS.outcomeKeys,
      maxPrice: 0.5,
      execution: cfg.execution,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.quantity).toBe(20);
    expect(a.outcomeKey).toBe("outcome-up");
  });

  it("carries no strategy field into the execution boundary", () => {
    const constraints = adaptIntent(INTENT, {
      outcomeKeys: CONDITIONS.outcomeKeys,
      maxPrice: 0.5,
      execution: config().execution,
    });
    const keys = Object.keys(constraints).join(" ").toLowerCase();
    for (const banned of ["twap", "ptb", "buffer", "window", "majority", "confidence"]) {
      expect(keys).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Standing Limit Order Engine
// ---------------------------------------------------------------------------

describe("standing limit order engine", () => {
  it("rests passively at the best bid, never above the limit price", async () => {
    const { coordinator: coord, gateway } = coordinator({});
    await coord.submit(INTENT, CONDITIONS);
    expect(gateway.submissions).toHaveLength(1);
    expect(gateway.submissions[0]!.limitPrice).toBe(0.48);
    expect(gateway.submissions[0]!.timeInForce).toBe("GTC");
    expect(gateway.submissions[0]!.postOnly).toBe(true);
  });

  it("reprices through cancel/replace and preserves partial fills", async () => {
    const fixed = clock();
    const gateway = new RecordingVenueGateway({
      book: {
        outcomeKey: "outcome-up",
        bestBid: 0.48,
        bestAsk: 0.52,
        bidSize: 100,
        askSize: 100,
        observedAtIso: new Date(CLOCK_START).toISOString(),
      },
    });
    const { coordinator: coord } = coordinator({ fixed, gateway });
    const result = await coord.submit(INTENT, CONDITIONS);
    expect(result.accepted).toBe(true);

    await coord.applyFill({
      executionIntentId: INTENT.executionIntentId,
      venueOrderId: gateway.submissions[0]!.orderId.replace(/^/, "venue-"),
      venueFillId: "f1",
      quantity: 6,
      price: 0.48,
    });

    (gateway as unknown as { behaviour: { book: { bestBid: number } } }).behaviour.book.bestBid =
      0.47;
    fixed.advance(1_100);
    await coord.tick();

    expect(gateway.cancellations).toHaveLength(1);
    expect(gateway.submissions).toHaveLength(2);
    // The replacement only covers the unfilled remainder.
    expect(gateway.submissions[1]!.quantity).toBe(14);
    expect(gateway.submissions[1]!.limitPrice).toBe(0.47);
  });

  it("falls back to a crossing IOC order at the deadline", async () => {
    const fixed = clock();
    const { coordinator: coord, gateway } = coordinator({
      fixed,
      cfg: config({ execution: { iocFallbackEnabled: true, repricingEnabled: false } }),
    });
    await coord.submit(INTENT, CONDITIONS);
    fixed.advance(6_000);
    await coord.tick();

    expect(gateway.submissions).toHaveLength(2);
    expect(gateway.submissions[1]!.timeInForce).toBe("IOC");
    expect(gateway.submissions[1]!.limitPrice).toBeLessThanOrEqual(0.5);
  });

  it("times out into a failed execution when nothing filled", async () => {
    const fixed = clock();
    const { coordinator: coord } = coordinator({ fixed });
    const result = await coord.submit(INTENT, CONDITIONS);
    expect(result.accepted).toBe(true);
    fixed.advance(6_000);
    await coord.tick();
    const session = coord.engine.session(INTENT.executionIntentId)!;
    expect(session.executionState).toBe("FAILED");
    expect(session.report().failureReason).toBe("TIMEOUT");
  });

  it("retries a retryable rejection with the configured delay and budget", async () => {
    const fixed = clock();
    const gateway = new RecordingVenueGateway({
      book: null,
      submitResults: [
        { accepted: false, rejectionReason: "gateway", retryable: true },
        { accepted: true, venueOrderId: "venue-2" },
      ],
    });
    const { coordinator: coord } = coordinator({
      fixed,
      gateway,
      cfg: config({ execution: { retryCount: 1, retryDelayMillis: 500 } }),
    });
    await coord.submit({ ...INTENT, retryCount: 1 }, CONDITIONS);
    expect(gateway.submissions).toHaveLength(1);
    fixed.advance(600);
    await coord.tick();
    expect(gateway.submissions).toHaveLength(2);
    expect(coord.engine.session(INTENT.executionIntentId)!.executionState).toBe("WORKING");
  });
});

// ---------------------------------------------------------------------------
// Coordinator: risk, exposure, quota and settlement
// ---------------------------------------------------------------------------

describe("trade coordinator", () => {
  it("denies without reserving exposure when risk denies", async () => {
    const { coordinator: coord } = coordinator({
      cfg: config({ risk: { killSwitch: true } }),
    });
    const result = await coord.submit(INTENT, CONDITIONS);
    expect(result.accepted).toBe(false);
    expect(coord.ledger.reserved).toBe(0);
    expect(coord.engine.session(INTENT.executionIntentId)).toBeUndefined();
  });

  it("suppresses a duplicate execution for a known intent", async () => {
    const { coordinator: coord, gateway } = coordinator({});
    await coord.submit(INTENT, CONDITIONS);
    const duplicate = await coord.submit(INTENT, CONDITIONS);
    expect(duplicate).toMatchObject({ accepted: false, reason: "DUPLICATE" });
    expect(gateway.submissions).toHaveLength(1);
  });

  it("consumes the trade quota exactly once, at the first meaningful fill", async () => {
    const commits: string[] = [];
    const { coordinator: coord, gateway } = coordinator({ onQuota: (id) => commits.push(id) });
    await coord.submit(INTENT, CONDITIONS);
    const venueOrderId = `venue-${gateway.submissions[0]!.orderId}`;

    // Below the meaningful threshold: no quota consumption.
    await coord.applyFill({
      executionIntentId: INTENT.executionIntentId,
      venueOrderId,
      venueFillId: "f1",
      quantity: 2,
      price: 0.48,
    });
    expect(commits).toHaveLength(0);

    await coord.applyFill({
      executionIntentId: INTENT.executionIntentId,
      venueOrderId,
      venueFillId: "f2",
      quantity: 5,
      price: 0.48,
    });
    await coord.applyFill({
      executionIntentId: INTENT.executionIntentId,
      venueOrderId,
      venueFillId: "f3",
      quantity: 5,
      price: 0.48,
    });
    expect(commits).toEqual([INTENT.executionIntentId]);
  });

  it("fires the settlement hook exactly once and releases the reservation", async () => {
    const settlements: string[] = [];
    const { coordinator: coord, gateway } = coordinator({
      onSettlement: (id) => settlements.push(id),
    });
    await coord.submit(INTENT, CONDITIONS);
    const venueOrderId = `venue-${gateway.submissions[0]!.orderId}`;
    await coord.applyFill({
      executionIntentId: INTENT.executionIntentId,
      venueOrderId,
      venueFillId: "f1",
      quantity: 20,
      price: 0.48,
    });
    await coord.engine.session(INTENT.executionIntentId)!.cancel();

    expect(settlements).toEqual([INTENT.executionIntentId]);
    expect(coord.ledger.reserved).toBe(0);
    expect(coord.ledger.live).toBeCloseTo(9.6, 8);
  });

  it("emits canonical events through the frozen envelope", async () => {
    const { coordinator: coord, sink } = coordinator({});
    await coord.submit(INTENT, CONDITIONS);
    const types = sink.events.map((event) => event.type);
    expect(types).toContain("trade.risk.approved");
    expect(types).toContain("trade.exposure.reserved");
    expect(types).toContain("trade.order.submitted");
    for (const event of sink.events) {
      expect(event.metadata.correlationId).toBe(INTENT.correlationId);
      expect(event.metadata.executionIntentId).toBe(INTENT.executionIntentId);
    }
  });
});

// ---------------------------------------------------------------------------
// Recovery and replay
// ---------------------------------------------------------------------------

describe("execution recovery", () => {
  it("rebuilds sessions from a snapshot without duplicating orders or quota", async () => {
    const { coordinator: coord, gateway } = coordinator({});
    await coord.submit(INTENT, CONDITIONS);
    await coord.applyFill({
      executionIntentId: INTENT.executionIntentId,
      venueOrderId: `venue-${gateway.submissions[0]!.orderId}`,
      venueFillId: "f1",
      quantity: 8,
      price: 0.48,
    });

    const snapshots = coord.snapshot();
    const rebuilt = new StandingOrderEngine({ gateway, clock: clock() });
    rebuilt.restore(snapshots);

    const session = rebuilt.session(INTENT.executionIntentId)!;
    expect(session.cumulativeFilledQuantity).toBe(8);
    expect(session.snapshot().quotaCommitted).toBe(true);
    expect(rebuilt.open(session.constraints).duplicate).toBe(true);
    expect(gateway.submissions).toHaveLength(1);
  });

  it("replays a session snapshot byte-for-byte", async () => {
    const { coordinator: coord, gateway } = coordinator({});
    await coord.submit(INTENT, CONDITIONS);
    const original = coord.snapshot()[0]!;
    const restored = StandingOrderSession.restore(original, {
      gateway,
      clock: clock(),
    }).snapshot();
    expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
  });
});
