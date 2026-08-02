/**
 * ARC — M4 Platform Services tests.
 *
 * Covers: append-only + idempotent event store, ledger reconstruction and
 * invariants, deterministic replay, analytics derivation, notification
 * dedup/severity, audit trail, and synchronization policy.
 */
import { describe, expect, it } from "vitest";

import { EventEnvelopeFactory, type EventEnvelope } from "@/core/contracts/event-envelope";
import { FixedClock } from "@/core/shared/time";
import {
  AuditTrail,
  EventStoreViolationError,
  InMemoryAnalyticsRepository,
  InMemoryAuditRepository,
  InMemoryEventStore,
  InMemoryLedgerRepository,
  InMemorySynchronizationTarget,
  NotificationEngine,
  RecordingNotificationChannel,
  classifyEventType,
  computeAnalytics,
  isSynchronizableEvent,
  planSynchronization,
  reconstructLedger,
  replayEvents,
  summariseLedger,
  synchronizeEvents,
} from "@/core/platform";
import { DECISION_EVENT_TYPES } from "@/core/decision/events";
import { TRADE_EVENT_TYPES } from "@/core/trade/events";
import { MARKET_EVENT_TYPES } from "@/core/market/events";

const CORRELATION = "corr-m4-001";

function buildStream(): EventEnvelope[] {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const factory = new EventEnvelopeFactory(clock, "test");
  const base = {
    correlationId: CORRELATION,
    source: "test",
    marketInstanceId: "mkt-1",
    windowInstanceId: "win-1",
  };

  const events: EventEnvelope[] = [];

  events.push(
    factory.create({
      ...base,
      type: MARKET_EVENT_TYPES.stateUpdated,
      reasonCode: "MKT_STATE_PUBLISHED",
      payload: { version: 1, marketInstanceId: "mkt-1" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      type: MARKET_EVENT_TYPES.stateUpdated,
      reasonCode: "MKT_STATE_PUBLISHED",
      payload: { version: 2, marketInstanceId: "mkt-1" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      type: DECISION_EVENT_TYPES.windowOpened,
      reasonCode: "DEC_WINDOW_OPENED",
      payload: { windowInstanceId: "win-1" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      type: DECISION_EVENT_TYPES.windowEvaluated,
      reasonCode: "DEC_SIGNAL_UP",
      payload: { windowInstanceId: "win-1", outcome: "SIGNAL" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: DECISION_EVENT_TYPES.executionIntentCreated,
      reasonCode: "DEC_INTENT_CREATED",
      payload: {
        executionIntentId: "int-1",
        windowInstanceId: "win-1",
        marketInstanceId: "mkt-1",
        createdAtIso: "2026-01-01T00:00:00.000",
        referenceEffectiveTwap: 0.5,
        executionProfileVersion: "profile-a",
      },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.riskApproved,
      reasonCode: "RSK_APPROVED",
      payload: { executionIntentId: "int-1" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.exposureReserved,
      reasonCode: "RSK_EXPOSURE_RESERVED",
      payload: { exposure: { reserved: 10, live: 0 } },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.orderSubmitted,
      reasonCode: "EXE_ORDER_SUBMITTED",
      payload: { order: { orderId: "ord-1", state: "SUBMITTED", executionIntentId: "int-1" } },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.orderFilled,
      reasonCode: "EXE_ORDER_FILLED",
      payload: {
        order: {
          orderId: "ord-1",
          state: "FILLED",
          executionIntentId: "int-1",
          marketInstanceId: "mkt-1",
          windowInstanceId: "win-1",
          outcomeKey: "UP",
        },
        fill: {
          fillId: "fill-1",
          quantity: 20,
          price: 0.52,
          fees: 0.1,
          filledAtIso: "2026-01-01T00:00:00.000",
        },
      },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.executionCompleted,
      reasonCode: "EXE_COMPLETED",
      payload: {
        executionIntentId: "int-1",
        outcomeKey: "UP",
        filled: true,
        partiallyFilled: false,
        averagePrice: 0.52,
        filledQuantity: 20,
        cumulativeFilledQuantity: 20,
        cumulativeNotional: 10.4,
        orders: [{ orderId: "ord-1" }],
      },

    }),
  );
  events.push(
    factory.create({
      ...base,
      type: DECISION_EVENT_TYPES.tradeQuotaConsumed,
      reasonCode: "DEC_QUOTA_CONSUMED",
      payload: { quota: { initial: 4, remaining: 3, consumed: 1 } },
    }),
  );

  return events;
}

describe("event catalog", () => {
  it("classifies trading facts as BUSINESS and telemetry as OPERATIONAL", () => {
    expect(classifyEventType(TRADE_EVENT_TYPES.orderFilled)).toBe("BUSINESS");
    expect(classifyEventType("platform.scheduler.tick")).toBe("OPERATIONAL");
  });
});

describe("event store", () => {
  it("is idempotent on idempotencyKey and never mutates an appended envelope", async () => {
    const store = new InMemoryEventStore();
    const [event] = buildStream();
    const first = await store.appendChecked(event!);
    const second = await store.appendChecked(event!);

    expect(first.appended).toBe(true);
    expect(second.appended).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await store.count()).toBe(1);
  });

  it("rejects envelopes that violate the canonical schema", async () => {
    const store = new InMemoryEventStore();
    await expect(store.append({ type: "nope" } as unknown as EventEnvelope)).rejects.toBeDefined();
  });

  it("rejects an attempt to reuse an eventId with different content", async () => {
    const store = new InMemoryEventStore();
    const [event] = buildStream();
    await store.append(event!);
    const tampered = { ...event!, payload: { version: 99 }, idempotencyKey: "different" };
    await expect(store.append(tampered as EventEnvelope)).rejects.toBeInstanceOf(
      EventStoreViolationError,
    );
  });

  it("queries by correlation, classification and time window", async () => {
    const store = new InMemoryEventStore();
    for (const event of buildStream()) await store.append(event);

    expect((await store.readByCorrelation(CORRELATION)).length).toBeGreaterThan(0);
    const business = await store.query({ classification: "BUSINESS" });
    expect(business.every((event) => classifyEventType(event.type) === "BUSINESS")).toBe(true);
  });
});

describe("ledger", () => {
  it("reconstructs trade, fee and pnl records purely from business events", () => {
    const ledger = reconstructLedger(buildStream());
    const kinds = ledger.records.map((record) => record.kind);
    expect(kinds).toContain("TRADE");
    expect(ledger.summary.totalNotional).toBeCloseTo(20 * 0.52, 6);
    expect(ledger.summary.totalFees).toBeCloseTo(0.1, 6);
  });

  it("is deterministic — the same events reconstruct the same ledger", () => {
    const a = reconstructLedger(buildStream());
    const b = reconstructLedger(buildStream());
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
  });

  it("summarises an empty ledger without dividing by zero", () => {
    const summary = summariseLedger([]);
    expect(summary.totalNotional).toBe(0);
    expect(summary.realizedPnl).toBe(0);
  });

  it("persists records idempotently in the in-memory repository", async () => {
    const repo = new InMemoryLedgerRepository();
    const { records } = reconstructLedger(buildStream());
    await repo.append(records);
    await repo.append(records);
    expect((await repo.list()).length).toBe(records.length);
  });
});

describe("replay", () => {
  it("reconstructs projections deterministically with a stable digest", () => {
    const events = buildStream();
    const first = replayEvents(events, { runId: "run-1" });
    const second = replayEvents([...events].reverse(), { runId: "run-1" });

    expect(first.deterministic).toBe(true);
    expect(first.digest).toBe(second.digest);
    expect(first.eventCount).toBe(events.length);
    expect(first.projection.executionIntentIds).toEqual(["int-1"]);
    expect(first.projection.quota.consumed).toBe(1);
  });

  it("detects an illegal order FSM transition", () => {
    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const factory = new EventEnvelopeFactory(clock, "test");
    const bad = factory.create({
      correlationId: CORRELATION,
      source: "test",
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.orderSubmitted,
      reasonCode: "EXE_ORDER_SUBMITTED",
      payload: { order: { orderId: "ord-1", state: "SUBMITTED", executionIntentId: "int-1" } },
    });
    const result = replayEvents([...buildStream(), bad]);
    expect(result.deterministic).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });

  it("scopes replay to a single correlation id", () => {
    const result = replayEvents(buildStream(), { correlationId: "unrelated" });
    expect(result.eventCount).toBe(0);
  });
});

describe("analytics", () => {
  it("derives fill rate, slippage and quota utilization from events only", () => {
    const summary = computeAnalytics(buildStream());
    expect(summary.metrics.fillRate).toBe(1);
    expect(summary.metrics.averageSlippage).toBeCloseTo(0.02, 6);
    expect(summary.metrics.tradeQuotaUtilization).toBeCloseTo(0.25, 6);
    expect(summary.metrics.peakReservedExposure).toBe(10);
    expect(summary.perWindow[0]?.windowInstanceId).toBe("win-1");
    expect(summary.perProfile[0]?.executionProfileVersion).toBe("profile-a");
  });

  it("returns nulls instead of dividing by zero on an empty stream", () => {
    const summary = computeAnalytics([]);
    expect(summary.metrics.fillRate).toBeNull();
    expect(summary.eventCount).toBe(0);
  });

  it("stores and reads back the latest summary", async () => {
    const repo = new InMemoryAnalyticsRepository();
    await repo.save(computeAnalytics(buildStream()), "GLOBAL", "all");
    expect((await repo.latest("GLOBAL"))?.metrics.fillRate).toBe(1);
  });
});

describe("notifications", () => {
  it("raises warnings/criticals, suppresses duplicates and honours categories", async () => {
    const engine = new NotificationEngine();
    const channel = new RecordingNotificationChannel();
    engine.register(channel);

    const clock = new FixedClock("2026-01-01T00:00:00.000Z");
    const factory = new EventEnvelopeFactory(clock, "test");
    const denial = factory.create({
      correlationId: CORRELATION,
      source: "test",
      type: TRADE_EVENT_TYPES.riskDenied,
      reasonCode: "RSK_DENIED_KILL_SWITCH",
      payload: {},
    });

    const raised = await engine.ingest(denial);
    const duplicate = await engine.ingest(denial);

    expect(raised?.severity).toBe("CRITICAL");
    expect(raised?.category).toBe("RISK");
    expect(duplicate).toBeNull();
    expect(channel.delivered.length).toBe(1);
    expect(engine.suppressed[0]?.reason).toBe("DUPLICATE");
  });

  it("ignores routine informational events by default", async () => {
    const engine = new NotificationEngine();
    const [event] = buildStream();
    expect(await engine.ingest(event!)).toBeNull();
  });
});

describe("audit trail", () => {
  it("records configuration, profile and replay actions immutably", async () => {
    const repo = new InMemoryAuditRepository();
    const trail = new AuditTrail(repo, new FixedClock("2026-01-01T00:00:00.000Z"), "operator-1");

    await trail.configurationChanged("cfg-1", { field: "windows" });
    await trail.profileActivated("profile-a");
    await trail.replayCompleted("run-1", { deterministic: true });

    expect(repo.records.map((record) => record.action)).toEqual([
      "CONFIGURATION_CHANGED",
      "PROFILE_ACTIVATED",
      "REPLAY_COMPLETED",
    ]);
    expect(repo.records[0]?.metadata?.["actor"]).toBe("operator-1");
    expect(() => {
      (repo.records[0] as { action: string }).action = "TAMPERED";
    }).toThrow();
  });
});

describe("synchronization policy", () => {
  it("never synchronizes runtime execution state", () => {
    expect(isSynchronizableEvent(TRADE_EVENT_TYPES.orderSubmitted)).toBe(false);
    expect(isSynchronizableEvent(TRADE_EVENT_TYPES.orderFilled)).toBe(true);

    const plan = planSynchronization(buildStream());
    expect(plan.skipped.every((row) => row.reasonCode === "SYN_SKIPPED_RUNTIME_STATE")).toBe(true);
    expect(plan.synchronize.some((event) => event.type === TRADE_EVENT_TYPES.orderSubmitted)).toBe(
      false,
    );
  });

  it("is idempotent across repeated synchronization runs", async () => {
    const target = new InMemorySynchronizationTarget();
    const events = buildStream();
    const first = await synchronizeEvents(events, target);
    const second = await synchronizeEvents(events, target);

    expect(first.written).toBeGreaterThan(0);
    expect(second.written).toBe(0);
    expect(second.duplicates).toBe(first.written);
  });
});
