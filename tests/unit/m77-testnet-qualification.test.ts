/**
 * ARC — M7.7 Testnet Qualification.
 *
 * Validation only: no new strategy logic, no frozen contract changes. These
 * tests are the qualification evidence for the production gate checklist.
 */
import { describe, expect, it } from "vitest";

import { replayEvents } from "@/core/platform/replay";
import {
  QUALIFICATION_GATES,
  QUALIFICATION_SPEC,
  evaluateQualificationGates,
  lifecycleSequenceObserved,
  qualificationProfile,
  qualificationTradeConfig,
  qualificationVerdict,
  runQualificationScenario,
  type QualificationRun,
} from "@/core/qualification";

let cached: QualificationRun | null = null;
async function baseline(): Promise<QualificationRun> {
  cached ??= await runQualificationScenario(QUALIFICATION_SPEC);
  return cached;
}

describe("M7.7 — startup and lifecycle qualification", () => {
  it("publishes an ordered, monotonic market state stream", async () => {
    const run = await baseline();
    expect(run.marketStateVersions.length).toBeGreaterThan(1);
    expect(run.marketStateVersions).toEqual(
      [...run.marketStateVersions].sort((a, b) => a - b),
    );
  });

  it("walks the full lifecycle: state → decision → intent → risk → order → fill → settlement", async () => {
    const run = await baseline();
    expect(lifecycleSequenceObserved(run.eventTypes)).toBe(true);
    expect(run.intents.some((intent) => intent.submitted === "ACCEPTED")).toBe(true);
    expect(run.settlements.length).toBeGreaterThan(0);
  });

  it("releases every reservation at settlement", async () => {
    const run = await baseline();
    expect(run.exposure.reserved).toBe(0);
    expect(run.settledNotional).toBeGreaterThan(0);
  });

  it("emits each execution intent exactly once", async () => {
    const run = await baseline();
    const ids = run.intents.map((intent) => intent.executionIntentId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("M7.7 — multi window qualification", () => {
  it("orders windows by descending offset, never by configuration", async () => {
    const run = await baseline();
    expect(run.windowOffsets).toEqual([15_000, 10_000, 7_000, 5_000, 3_000]);
  });

  it("stops producing intents once the trade quota is exhausted", async () => {
    const run = await baseline();
    const accepted = run.intents.filter((intent) => intent.submitted === "ACCEPTED");
    expect(accepted.length).toBeLessThanOrEqual(qualificationProfile().maxTrades);
    expect(run.quotaExhausted).toBe(true);
  });

  it("honours SINGLE_TRADE by allowing exactly one intent", async () => {
    const run = await runQualificationScenario({
      ...QUALIFICATION_SPEC,
      profile: qualificationProfile({ executionMode: "SINGLE_TRADE", maxTrades: 1 }),
    });
    expect(run.intents).toHaveLength(1);
  });
});

describe("M7.7 — replay qualification", () => {
  it("is deterministic: two identical runs produce an identical event stream", async () => {
    const first = await runQualificationScenario(QUALIFICATION_SPEC);
    const second = await runQualificationScenario(QUALIFICATION_SPEC);
    expect(second.eventTypes).toEqual(first.eventTypes);
    expect(second.intents).toEqual(first.intents);
    expect(second.settledNotional).toBe(first.settledNotional);
  });

  it("replays the recorded stream with zero mismatches", async () => {
    const run = await baseline();
    const result = replayEvents([...run.events]);
    expect(result.deterministic).toBe(true);
    expect(result.mismatches).toEqual([]);
  });
});

describe("M7.7 — recovery qualification", () => {
  it("suppresses a replayed execution intent instead of trading twice", async () => {
    const run = await baseline();
    expect(run.duplicateSuppressed).toBe(true);
  });
});

describe("M7.7 — risk qualification", () => {
  it("denies every intent while the kill switch is engaged", async () => {
    const run = await runQualificationScenario({ ...QUALIFICATION_SPEC, killSwitch: true });
    expect(run.intents.length).toBeGreaterThan(0);
    expect(run.intents.every((intent) => intent.submitted === "RISK_DENIED")).toBe(true);
    expect(run.intents.every((intent) => intent.deniedBy === "KILL_SWITCH")).toBe(true);
    expect(run.settlements).toHaveLength(0);
  });

  it("denies an intent whose spread exceeds the risk profile", async () => {
    const run = await runQualificationScenario({
      ...QUALIFICATION_SPEC,
      book: { bestBid: 0.2, bestAsk: 0.9, bidSize: 500, askSize: 500 },
      tradeConfig: qualificationTradeConfig({ risk: { maxSpread: 0.05 } }),
    });
    expect(run.intents.every((intent) => intent.submitted === "RISK_DENIED")).toBe(true);
  });
});

describe("M7.7 — production gate checklist", () => {
  it("passes every deterministic gate and marks live gates as pending", async () => {
    const run = await baseline();
    const results = evaluateQualificationGates(run);
    const deterministic = results.filter((gate) =>
      ["LIFECYCLE", "MULTI_WINDOW", "RECOVERY"].includes(gate.category),
    );
    expect(deterministic.every((gate) => gate.status === "PASS")).toBe(true);
    expect(qualificationVerdict(results)).toBe("PENDING");
  });

  it("reaches PASS only when the live authority evidence is supplied", async () => {
    const run = await baseline();
    const results = evaluateQualificationGates(run, {
      environmentValidated: true,
      authorityRegistered: true,
      telemetryCurrent: true,
      configurationActive: true,
      replayDeterministic: true,
    });
    expect(results).toHaveLength(QUALIFICATION_GATES.length);
    expect(qualificationVerdict(results)).toBe("PASS");
  });

  it("fails the checklist when live evidence is negative", async () => {
    const run = await baseline();
    const results = evaluateQualificationGates(run, {
      environmentValidated: true,
      authorityRegistered: true,
      telemetryCurrent: true,
      configurationActive: false,
      replayDeterministic: true,
    });
    expect(qualificationVerdict(results)).toBe("FAIL");
  });
});
