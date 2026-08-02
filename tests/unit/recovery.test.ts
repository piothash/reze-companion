/**
 * ARC — M6 recovery validation.
 *
 * Restart at every lifecycle boundary (feed, window, decision, execution,
 * settlement, replay) and prove the rebuilt state converges and that nothing
 * is ever emitted twice.
 */
import { describe, expect, it } from "vitest";

import { EventEnvelopeFactory, type EventEnvelope } from "@/core/contracts/event-envelope";
import { FixedClock } from "@/core/shared/time";
import { MARKET_EVENT_TYPES } from "@/core/market/events";
import { DECISION_EVENT_TYPES } from "@/core/decision/events";
import { TRADE_EVENT_TYPES } from "@/core/trade/events";
import { EVENT_CATALOG } from "@/core/platform/event-catalog";
import { compareRecovery, createRecoveryGuard, recoverFromEvents } from "@/core/platform/recovery";
import { replayEvents } from "@/core/platform/replay";

const CORRELATION = "corr-m6-recovery";

export function buildLifecycleStream(): EventEnvelope[] {
  const factory = new EventEnvelopeFactory(new FixedClock("2026-02-01T00:00:00.000Z"), "test");
  const base = {
    correlationId: CORRELATION,
    source: "test",
    marketInstanceId: "mkt-1",
    windowInstanceId: "win-1",
  };
  const events: EventEnvelope[] = [];

  // Feed phase ---------------------------------------------------------------
  for (const version of [1, 2, 3]) {
    events.push(
      factory.create({
        ...base,
        type: MARKET_EVENT_TYPES.stateUpdated,
        reasonCode: "MKT_STATE_PUBLISHED",
        payload: { marketStateVersion: version, marketInstanceId: "mkt-1" },
      }),
    );
  }

  // Window phase -------------------------------------------------------------
  events.push(
    factory.create({
      ...base,
      type: DECISION_EVENT_TYPES.windowOpened,
      reasonCode: "DEC_WINDOW_OPENED",
      payload: { windowInstanceId: "win-1", executionContextId: "ctx-1" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      type: DECISION_EVENT_TYPES.windowActivated,
      reasonCode: "DEC_WINDOW_ACTIVATED",
      payload: { windowInstanceId: "win-1", executionContextId: "ctx-1" },
    }),
  );

  // Decision phase -----------------------------------------------------------
  events.push(
    factory.create({
      ...base,
      type: DECISION_EVENT_TYPES.windowEvaluated,
      reasonCode: "DEC_SIGNAL_UP",
      payload: { windowInstanceId: "win-1", executionContextId: "ctx-1", outcome: "SIGNAL" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: DECISION_EVENT_TYPES.executionIntentCreated,
      reasonCode: "DEC_INTENT_CREATED",
      payload: { executionIntentId: "int-1", windowInstanceId: "win-1" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: DECISION_EVENT_TYPES.tradeQuotaConsumed,
      reasonCode: "DEC_QUOTA_CONSUMED",
      payload: {
        windowInstanceId: "win-1",
        executionIntentId: "int-1",
        quota: { initial: 3, remaining: 2, consumed: 1 },
      },
    }),
  );

  // Execution phase ----------------------------------------------------------
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
      payload: {
        reservation: {
          reservationId: "res-1",
          executionIntentId: "int-1",
          marketInstanceId: "mkt-1",
          outcomeKey: "UP",
          reserved: 10,
          committed: 0,
          released: 0,
          amount: 10,
          state: "RESERVED",
        },
      },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.orderSubmitted,
      reasonCode: "EXE_ORDER_SUBMITTED",
      payload: {
        orderId: "ord-1",
        executionIntentId: "int-1",
        state: "SUBMITTED",
        filledQuantity: 0,
      },
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
          executionIntentId: "int-1",
          state: "FILLED",
          filledQuantity: 20,
          outcomeKey: "UP",
        },
        fill: { quantity: 20, price: 0.5 },
        cumulativeFilledQuantity: 20,
        complete: true,
      },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.executionCompleted,
      reasonCode: "EXE_COMPLETED",
      payload: { executionIntentId: "int-1" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: TRADE_EVENT_TYPES.exposureReleased,
      reasonCode: "RSK_EXPOSURE_RELEASED",
      payload: {
        reservation: {
          reservationId: "res-1",
          executionIntentId: "int-1",
          marketInstanceId: "mkt-1",
          outcomeKey: "UP",
          reserved: 0,
          committed: 10,
          released: 0,
          amount: 10,
          state: "SETTLED",
        },
        reason: "EXECUTION_COMPLETED",
      },
    }),
  );

  // Settlement phase ---------------------------------------------------------
  events.push(
    factory.create({
      ...base,
      executionIntentId: "int-1",
      type: EVENT_CATALOG.TradeSettled.type,
      reasonCode: "LDG_RECORDED",
      payload: { executionIntentId: "int-1", realizedPnl: 1.5, outcomeKey: "UP" },
    }),
  );
  events.push(
    factory.create({
      ...base,
      type: DECISION_EVENT_TYPES.windowCompleted,
      reasonCode: "DEC_WINDOW_COMPLETED",
      payload: {
        windowInstanceId: "win-1",
        executionContextId: "ctx-1",
        completionReason: "EXECUTED",
      },
    }),
  );

  return events;
}

const STREAM = buildLifecycleStream();

describe("recovery — deterministic rebuild", () => {
  it("is pure: identical streams recover to an identical digest", () => {
    expect(recoverFromEvents(STREAM).digest).toBe(recoverFromEvents([...STREAM]).digest);
  });

  it("restores quota, execution context, windows, reservations and settlement", () => {
    const state = recoverFromEvents(STREAM);
    expect(state.quota).toEqual({ initial: 3, remaining: 2, consumed: 1 });
    expect(state.executionContextIds).toEqual(["ctx-1"]);
    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]?.state).toBe("COMPLETED");
    expect(state.activeWindowIds).toEqual([]);
    expect(state.reservations).toHaveLength(1);
    expect(state.reservedTotal).toBe(0);
    expect(state.settledIntentIds).toEqual(["int-1"]);
    expect(state.orders[0]).toMatchObject({ state: "FILLED", terminal: true });
    expect(state.openOrderIds).toEqual([]);
  });

  it("recovers unfinished work as still open", () => {
    const midExecution = STREAM.slice(0, 11); // stops after orderSubmitted
    const state = recoverFromEvents(midExecution);
    expect(state.activeWindowIds).toEqual(["win-1"]);
    expect(state.openOrderIds).toEqual(["ord-1"]);
    expect(state.openIntentIds).toEqual(["int-1"]);
    expect(state.reservedTotal).toBe(10);
    expect(state.quota.remaining).toBe(2);
  });
});

describe("recovery — restart at every lifecycle boundary", () => {
  const boundaries = [
    { label: "feed", cut: 3 },
    { label: "window", cut: 5 },
    { label: "decision", cut: 8 },
    { label: "execution", cut: 12 },
    { label: "settlement", cut: 14 },
    { label: "replay", cut: STREAM.length },
  ];

  for (const boundary of boundaries) {
    it(`restart during ${boundary.label} resumes without duplicates`, () => {
      const before = STREAM.slice(0, boundary.cut);
      const guard = createRecoveryGuard(recoverFromEvents(before));

      // Everything already in the stream must be recognised as known, so a
      // resumed runtime suppresses re-emission.
      for (const event of before) {
        const intentId = event.metadata.executionIntentId;
        if (intentId) expect(guard.isKnownIntent(intentId)).toBe(true);
      }
      expect(guard.nextSequence()).toBe((before[before.length - 1]?.sequence ?? -1) + 1);

      // Resuming and consuming the remainder converges on the full-stream state.
      const resumed = recoverFromEvents([...before, ...STREAM.slice(boundary.cut)]);
      expect(compareRecovery(recoverFromEvents(STREAM), resumed)).toEqual([]);
    });
  }

  it("re-delivered events after restart do not duplicate intents, orders, settlement or ledger", () => {
    const baseline = recoverFromEvents(STREAM);
    const redelivered = recoverFromEvents([...STREAM, ...STREAM.slice(8)]);
    expect(redelivered.intents).toHaveLength(baseline.intents.length);
    expect(redelivered.orders).toHaveLength(baseline.orders.length);
    expect(redelivered.settledIntentIds).toEqual(baseline.settledIntentIds);
    expect(redelivered.ledgerRecordIds).toEqual(baseline.ledgerRecordIds);
    expect(redelivered.reservations).toHaveLength(baseline.reservations.length);
  });

  it("guard blocks re-emitting known ids", () => {
    const guard = createRecoveryGuard(recoverFromEvents(STREAM));
    expect(guard.isKnownIntent("int-1")).toBe(true);
    expect(guard.isKnownOrder("ord-1")).toBe(true);
    expect(guard.isSettled("int-1")).toBe(true);
    expect(guard.isKnownReservation("res-1")).toBe(true);
    expect(guard.isKnownIntent("int-unseen")).toBe(false);
  });

  it("detects divergence between two recovered states", () => {
    const truncated = recoverFromEvents(STREAM.slice(0, 10));
    expect(compareRecovery(recoverFromEvents(STREAM), truncated).length).toBeGreaterThan(0);
  });

  it("recovery agrees with replay on intents, orders and quota", () => {
    const state = recoverFromEvents(STREAM);
    const replay = replayEvents(STREAM);
    expect(state.intents.map((i) => i.executionIntentId)).toEqual(replay.projection.executionIntentIds);
    expect(state.orders.map((o) => o.orderId)).toEqual(replay.projection.orders.map((o) => o.orderId));
    expect(state.quota).toEqual(replay.projection.quota);
  });
});
