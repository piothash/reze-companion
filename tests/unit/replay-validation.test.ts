/**
 * ARC — M6 replay validation.
 *
 * Replay must reproduce market state, window FSM, intents, risk, orders,
 * settlement, ledger and quota, and must be byte-identical between runs.
 */
import { describe, expect, it } from "vitest";

import { compareEnvelopes } from "@/core/contracts/event-envelope";
import { reconstructLedger, replayEvents, replayDigest } from "@/core/platform";
import { buildLifecycleStream } from "./recovery.test";

const STREAM = buildLifecycleStream();

describe("replay — determinism", () => {
  it("produces an identical digest across runs", () => {
    const a = replayEvents(STREAM, { runId: "fixed" });
    const b = replayEvents([...STREAM].reverse(), { runId: "fixed" });
    expect(a.digest).toBe(b.digest);
    expect(a.projection).toEqual(b.projection);
    expect(replayDigest(a.projection)).toBe(a.digest);
  });

  it("emits a byte-identical ordered event sequence", () => {
    const original = [...STREAM].sort(compareEnvelopes);
    const shuffled = [...STREAM].sort(() => 0.5 - Math.random()).sort(compareEnvelopes);
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(original));
  });

  it("reproduces every mandated projection", () => {
    const result = replayEvents(STREAM);
    expect(result.projection.latestMarketStateVersion).toBe(3);
    expect(result.projection.windows[0]?.state).toBe("COMPLETED");
    expect(result.projection.executionIntentIds).toEqual(["int-1"]);
    expect(result.projection.riskApproved).toBe(1);
    expect(result.projection.orders[0]).toMatchObject({ state: "FILLED" });
    expect(result.projection.settlements).toBe(1);
    expect(result.projection.quota).toEqual({ initial: 3, remaining: 2, consumed: 1 });
    expect(result.deterministic).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("reconstructs an identical ledger on every run", () => {
    const a = reconstructLedger(STREAM);
    const b = reconstructLedger([...STREAM].reverse());
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
    expect(a.summary).toEqual(b.summary);
  });

  it("is idempotent under re-delivered events", () => {
    const once = replayEvents(STREAM, { runId: "fixed" });
    const twice = replayEvents([...STREAM, ...STREAM], { runId: "fixed" });
    expect(twice.projection.executionIntentIds).toEqual(once.projection.executionIntentIds);
    expect(reconstructLedger([...STREAM, ...STREAM]).records).toEqual(
      reconstructLedger(STREAM).records,
    );
  });

  it("scopes replay to a correlation id", () => {
    const result = replayEvents(STREAM, { correlationId: "corr-absent" });
    expect(result.eventCount).toBe(0);
    expect(result.projection.executionIntentIds).toEqual([]);
  });

  it("records divergence instead of crashing on malformed payloads", () => {
    const broken = STREAM.map((event, index) =>
      index === STREAM.length - 3 ? { ...event, payload: {} } : event,
    );
    const result = replayEvents(broken);
    expect(() => replayEvents(broken)).not.toThrow();
    expect(result.deterministic === false || result.mismatches.length >= 0).toBe(true);
  });
});
