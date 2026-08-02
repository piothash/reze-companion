import { describe, expect, it } from "vitest";

import { InMemoryEventSink, type EventEnvelope } from "@/core/contracts/event-envelope";
import {
  DECISION_EVENT_TYPES,
  ExecutionWindowManager,
  TradeQuota,
  decide,
  loadExecutionProfile,
  offsetToMillis,
  parseWindowsSpec,
  resolveWindowConfiguration,
  type ExecutionProfile,
} from "@/core/decision";
import { authoritativeMarketStateSchema, type AuthoritativeMarketState } from "@/core/market/types";
import { FixedClock, fromIsoUtc } from "@/core/shared/time";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESOLVES_AT = "2026-02-01T00:05:00.000Z";
const MARKET_ID = "mkt_test_instance";

const BASE_ENV = {
  EXECUTION_PROFILE_ID: "arc-default",
  EXECUTION_MODE: "SINGLE_TRADE",
  EXECUTION_POSITION_SIZE: "10",
  EXECUTION_RETRY_COUNT: "1",
  EXECUTION_WINDOW_ACTIVE_MS: "60000",
  EXECUTION_PRECISION: "2",
  EXECUTION_BUFFER_MODE: "ABSOLUTE",
  EXECUTION_WINDOWS: "3m@1, 2m@1, 1m@1",
};

function profileFrom(overrides: Record<string, string> = {}): ExecutionProfile {
  return loadExecutionProfile({ ...BASE_ENV, ...overrides });
}

function makeState(input: {
  version: number;
  effectiveTwap: number | null;
  ptb: number | null;
  lifecycle?: AuthoritativeMarketState["lifecycle"];
  iso?: string;
}): AuthoritativeMarketState {
  const iso = input.iso ?? "2026-02-01T00:02:30.000Z";
  return authoritativeMarketStateSchema.parse({
    marketInstanceId: MARKET_ID,
    marketStateVersion: input.version,
    timestampIso: iso,
    lifecycle: input.lifecycle ?? "ACTIVE",
    descriptor: {
      marketInstanceId: MARKET_ID,
      venueMarketId: "0xcond",
      slug: "btc-updown-5m-1",
      question: "BTC up or down?",
      network: "testnet",
      outcomes: [
        { label: "Up", key: "up", tokenId: "tok-up" },
        { label: "Down", key: "down", tokenId: "tok-down" },
      ],
      opensAtIso: "2026-02-01T00:00:00.000Z",
      resolvesAtIso: RESOLVES_AT,
      venueActive: true,
      venueClosed: false,
      valid: true,
      invalidReasons: [],
      discoveredAtIso: "2026-02-01T00:00:00.000Z",
    },
    freshness: {
      state: "FRESH",
      ageMillis: 500,
      maxStalenessMillis: 10_000,
      lastObservedAtIso: iso,
    },
    twap: {
      value: input.effectiveTwap,
      windowSeconds: 300,
      precision: 2,
      observationCount: 5,
      windowStartIso: "2026-02-01T00:00:00.000Z",
      windowEndIso: iso,
      freshness: {
        state: "FRESH",
        ageMillis: 500,
        maxStalenessMillis: 10_000,
        lastObservedAtIso: iso,
      },
      computedAtIso: iso,
    },
    signal: {
      effectiveTwap: input.effectiveTwap,
      rawTwap: input.effectiveTwap,
      precision: 2,
      usable: input.effectiveTwap !== null,
      appliedSteps: ["running-twap"],
      rejectionReason: input.effectiveTwap === null ? "running TWAP unavailable" : null,
      conditionedAtIso: iso,
    },
    ptb: {
      value: input.ptb,
      precision: 2,
      valid: input.ptb !== null,
      source: { source: "market-metadata", field: "ptb" },
      rejectionReason: input.ptb === null ? "price-to-beat unavailable" : null,
      resolvedAtIso: iso,
    },
    configuration: {
      configVersion: "0.1.0",
      marketConfigVersion: "1.0.0",
      marketConfigDigest: "digest",
      activeExecutionProfileId: "arc-default",
    },
  } satisfies AuthoritativeMarketState);
}

interface ScenarioResult {
  events: EventEnvelope[];
  runtime: ReturnType<
    NonNullable<ExecutionWindowManager["executionContext"]>["runtimeState"]
  > | null;
}

/** Deterministic end-to-end scenario used for the replay assertions. */
async function runScenario(profile: ExecutionProfile): Promise<ScenarioResult> {
  const clock = new FixedClock("2026-02-01T00:00:00.000Z");
  const sink = new InMemoryEventSink();
  const manager = new ExecutionWindowManager({ profile, clock, sink });
  await manager.prepare({ marketInstanceId: MARKET_ID, resolvesAtIso: RESOLVES_AT });

  const steps: { iso: string; twap: number | null; ptb: number }[] = [
    { iso: "2026-02-01T00:02:05.000Z", twap: 100, ptb: 100 },
    { iso: "2026-02-01T00:02:20.000Z", twap: 100.5, ptb: 100 },
    { iso: "2026-02-01T00:02:40.000Z", twap: 104, ptb: 100 },
    { iso: "2026-02-01T00:03:10.000Z", twap: 104, ptb: 100 },
    { iso: "2026-02-01T00:04:30.000Z", twap: 90, ptb: 100 },
  ];

  let version = 0;
  for (const step of steps) {
    clock.set(fromIsoUtc(step.iso));
    await manager.tick(fromIsoUtc(step.iso));
    version += 1;
    await manager.onMarketState(
      makeState({ version, effectiveTwap: step.twap, ptb: step.ptb, iso: step.iso }),
    );
  }
  clock.set(fromIsoUtc(RESOLVES_AT));
  await manager.tick(fromIsoUtc(RESOLVES_AT));

  return {
    events: sink.ordered(),
    runtime: manager.executionContext?.runtimeState() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Execution profile & dynamic windows
// ---------------------------------------------------------------------------

describe("execution profile configuration", () => {
  it("parses the DSL window spec with buffers and overrides", () => {
    const windows = parseWindowsSpec("15m@0.5|size=2|retry=3, 10m@0.4, 3m@0.2|disabled");
    expect(windows).toHaveLength(3);
    expect(windows[0]).toMatchObject({
      offset: 15,
      unit: "m",
      twapBuffer: 0.5,
      positionSizeOverride: 2,
      retryCountOverride: 3,
    });
    expect(windows[2]?.enabled).toBe(false);
  });

  it("parses the JSON window spec", () => {
    const profile = profileFrom({
      EXECUTION_WINDOWS: '[{"offset":20,"unit":"m","twapBuffer":0.3}]',
    });
    expect(profile.windows[0]).toMatchObject({ offset: 20, unit: "m", twapBuffer: 0.3 });
  });

  it("supports a completely different window set without code changes", async () => {
    const profile = profileFrom({ EXECUTION_WINDOWS: "20m@1, 12m@1, 8m@1, 4m@1, 2m@1" });
    const clock = new FixedClock("2026-02-01T00:00:00.000Z");
    const manager = new ExecutionWindowManager({
      profile,
      clock,
      sink: new InMemoryEventSink(),
    });
    const context = await manager.prepare({
      marketInstanceId: MARKET_ID,
      resolvesAtIso: "2026-02-01T00:30:00.000Z",
    });
    expect(context.orderedWindows().map((w) => w.priority)).toEqual([
      offsetToMillis(20, "m"),
      offsetToMillis(12, "m"),
      offsetToMillis(8, "m"),
      offsetToMillis(4, "m"),
      offsetToMillis(2, "m"),
    ]);
  });

  it("rejects duplicate offsets and a missing window spec", () => {
    expect(() => profileFrom({ EXECUTION_WINDOWS: "3m@1, 3m@2" })).toThrow(/duplicate/);
    expect(() => profileFrom({ EXECUTION_WINDOWS: "" })).toThrow(/required/);
  });

  it("resolves global inheritance and per-window overrides, then freezes", () => {
    const profile = profileFrom({ EXECUTION_WINDOWS: "5m@0.5, 3m@0.5|size=99|retry=7" });
    const inherited = resolveWindowConfiguration(profile, profile.windows[0]!);
    const overridden = resolveWindowConfiguration(profile, profile.windows[1]!);

    expect(inherited.positionSize).toBe(10);
    expect(inherited.retryCount).toBe(1);
    expect(overridden.positionSize).toBe(99);
    expect(overridden.retryCount).toBe(7);
    expect(Object.isFrozen(inherited)).toBe(true);
    expect(() => {
      (inherited as { positionSize: number }).positionSize = 1;
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Decision engine — pure function
// ---------------------------------------------------------------------------

describe("TWAP-native decision engine", () => {
  const profile = profileFrom();
  const configuration = resolveWindowConfiguration(profile, profile.windows[0]!);

  it("produces BUY UP above PTB plus buffer", () => {
    const decision = decide({
      marketState: makeState({ version: 1, effectiveTwap: 102, ptb: 100 }),
      windowInstanceId: "win_a",
      configuration,
    });
    expect(decision.outcome).toBe("BUY_UP");
    expect(decision.appliedBuffer).toBe(1);
    expect(decision.delta).toBe(2);
  });

  it("produces BUY DOWN below PTB minus buffer", () => {
    const decision = decide({
      marketState: makeState({ version: 1, effectiveTwap: 98, ptb: 100 }),
      windowInstanceId: "win_a",
      configuration,
    });
    expect(decision.outcome).toBe("BUY_DOWN");
  });

  it("produces NO SIGNAL inside the buffer band", () => {
    for (const twap of [99.5, 100, 100.5, 101, 99]) {
      const decision = decide({
        marketState: makeState({ version: 1, effectiveTwap: twap, ptb: 100 }),
        windowInstanceId: "win_a",
        configuration,
      });
      expect(decision.outcome).toBe("NO_SIGNAL");
      expect(decision.rejectionReason).toBeTruthy();
    }
  });

  it("supports percent buffers", () => {
    const percentProfile = profileFrom({
      EXECUTION_BUFFER_MODE: "PERCENT",
      EXECUTION_WINDOWS: "3m@2",
    });
    const percentConfig = resolveWindowConfiguration(percentProfile, percentProfile.windows[0]!);
    expect(
      decide({
        marketState: makeState({ version: 1, effectiveTwap: 101, ptb: 100 }),
        windowInstanceId: "win_a",
        configuration: percentConfig,
      }).outcome,
    ).toBe("NO_SIGNAL");
    expect(
      decide({
        marketState: makeState({ version: 1, effectiveTwap: 103, ptb: 100 }),
        windowInstanceId: "win_a",
        configuration: percentConfig,
      }).outcome,
    ).toBe("BUY_UP");
  });

  it("returns NO SIGNAL when inputs are unusable", () => {
    expect(
      decide({
        marketState: makeState({ version: 1, effectiveTwap: null, ptb: 100 }),
        windowInstanceId: "win_a",
        configuration,
      }).outcome,
    ).toBe("NO_SIGNAL");
    expect(
      decide({
        marketState: makeState({ version: 1, effectiveTwap: 120, ptb: null }),
        windowInstanceId: "win_a",
        configuration,
      }).outcome,
    ).toBe("NO_SIGNAL");
    expect(
      decide({
        marketState: makeState({ version: 1, effectiveTwap: 120, ptb: 100, lifecycle: "RESOLVED" }),
        windowInstanceId: "win_a",
        configuration,
      }).rejectionReason,
    ).toMatch(/lifecycle/);
  });

  it("is deterministic and side-effect free", () => {
    const state = makeState({ version: 7, effectiveTwap: 105.25, ptb: 100 });
    const first = decide({ marketState: state, windowInstanceId: "win_a", configuration });
    const second = decide({ marketState: state, windowInstanceId: "win_a", configuration });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trade quota
// ---------------------------------------------------------------------------

describe("trade quota", () => {
  it("decreases monotonically, never below zero and never replenishes", () => {
    const quota = new TradeQuota(2);
    expect(quota.consume()).toBe(true);
    expect(quota.consume()).toBe(true);
    expect(quota.consume()).toBe(false);
    expect(quota.remaining).toBe(0);
    expect(quota.consumed).toBe(2);
    expect(quota.exhausted).toBe(true);
  });

  it("restores after a restart without exceeding the initial allowance", () => {
    const restored = TradeQuota.restore({ initial: 3, remaining: 9, consumed: 0 });
    expect(restored.remaining).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Window manager, FSM and quota interaction
// ---------------------------------------------------------------------------

describe("execution window manager", () => {
  it("orders windows by descending derived priority and opens each once", async () => {
    const sink = new InMemoryEventSink();
    const clock = new FixedClock("2026-02-01T00:00:00.000Z");
    const manager = new ExecutionWindowManager({ profile: profileFrom(), clock, sink });
    const context = await manager.prepare({
      marketInstanceId: MARKET_ID,
      resolvesAtIso: RESOLVES_AT,
    });

    expect(context.orderedWindows().map((w) => w.activatesAtIso)).toEqual([
      "2026-02-01T00:02:00.000Z",
      "2026-02-01T00:03:00.000Z",
      "2026-02-01T00:04:00.000Z",
    ]);
    expect(context.orderedWindows().every((w) => w.state === "WAITING")).toBe(true);
    expect(sink.ordered().filter((e) => e.type === DECISION_EVENT_TYPES.windowOpened)).toHaveLength(
      3,
    );
  });

  it("single trade mode allows exactly one intent and exhausts the quota", async () => {
    const result = await runScenario(profileFrom());
    const intents = result.events.filter(
      (e) => e.type === DECISION_EVENT_TYPES.executionIntentCreated,
    );
    expect(intents).toHaveLength(1);
    expect(result.runtime?.quota).toMatchObject({ initial: 1, remaining: 0, consumed: 1 });

    const completions = result.events
      .filter((e) => e.type === DECISION_EVENT_TYPES.windowCompleted)
      .map((e) => (e.payload as { completionReason: string }).completionReason);
    expect(completions).toContain("NOT_FILLED");
    expect(completions).toContain("QUOTA_EXHAUSTED");
    expect(completions).toHaveLength(3);
  });

  it("multi trade mode consumes quota across several windows", async () => {
    const result = await runScenario(
      profileFrom({ EXECUTION_MODE: "MULTI_TRADE", EXECUTION_MAX_TRADES: "2" }),
    );
    const intents = result.events.filter(
      (e) => e.type === DECISION_EVENT_TYPES.executionIntentCreated,
    );
    expect(intents).toHaveLength(2);
    expect(result.runtime?.quota).toMatchObject({ initial: 2, remaining: 0, consumed: 2 });
    expect(
      result.events.filter((e) => e.type === DECISION_EVENT_TYPES.tradeQuotaConsumed),
    ).toHaveLength(2);
  });

  it("re-evaluates on every market state update until an intent is produced", async () => {
    const sink = new InMemoryEventSink();
    const clock = new FixedClock("2026-02-01T00:02:00.000Z");
    const manager = new ExecutionWindowManager({
      profile: profileFrom({ EXECUTION_WINDOWS: "3m@1" }),
      clock,
      sink,
    });
    await manager.prepare({ marketInstanceId: MARKET_ID, resolvesAtIso: RESOLVES_AT });
    await manager.tick(fromIsoUtc("2026-02-01T00:02:00.000Z"));

    const outcomes = [];
    for (const [index, twap] of [100, 100.5, 104, 106].entries()) {
      outcomes.push(
        (
          await manager.onMarketState(
            makeState({ version: index + 1, effectiveTwap: twap, ptb: 100 }),
          )
        )[0]!,
      );
    }

    expect(outcomes.map((o) => o.decision?.outcome ?? null)).toEqual([
      "NO_SIGNAL",
      "NO_SIGNAL",
      "BUY_UP",
      null,
    ]);
    // Fourth update is ignored: one window produces at most one intent.
    expect(outcomes[3]?.suppressed).toBe(true);
    expect(
      sink.ordered().filter((e) => e.type === DECISION_EVENT_TYPES.executionIntentCreated),
    ).toHaveLength(1);
  });

  it("expires a window that never evaluated, and completes exactly once", async () => {
    const sink = new InMemoryEventSink();
    const clock = new FixedClock("2026-02-01T00:00:00.000Z");
    const manager = new ExecutionWindowManager({
      profile: profileFrom({ EXECUTION_WINDOWS: "3m@1" }),
      clock,
      sink,
    });
    const context = await manager.prepare({
      marketInstanceId: MARKET_ID,
      resolvesAtIso: RESOLVES_AT,
    });
    clock.set(fromIsoUtc("2026-02-01T00:04:00.000Z"));
    await manager.tick(fromIsoUtc("2026-02-01T00:04:00.000Z"));
    await manager.tick(fromIsoUtc("2026-02-01T00:04:30.000Z"));

    const window = context.orderedWindows()[0]!;
    expect(window.state).toBe("COMPLETED");
    expect(window.completionReason).toBe("EXPIRED");
    expect(
      sink.ordered().filter((e) => e.type === DECISION_EVENT_TYPES.windowCompleted),
    ).toHaveLength(1);
    expect(await manager.completeWindow(window.id, "CANCELLED")).toBe(false);
  });

  it("never invokes the decision engine once the quota is exhausted", async () => {
    const sink = new InMemoryEventSink();
    const clock = new FixedClock("2026-02-01T00:00:00.000Z");
    const manager = new ExecutionWindowManager({
      profile: profileFrom({ EXECUTION_WINDOWS: "3m@1, 2m@1" }),
      clock,
      sink,
    });
    const context = await manager.prepare({
      marketInstanceId: MARKET_ID,
      resolvesAtIso: RESOLVES_AT,
    });
    await manager.tick(fromIsoUtc("2026-02-01T00:02:00.000Z"));
    await manager.onMarketState(makeState({ version: 1, effectiveTwap: 110, ptb: 100 }));
    expect(context.quota.exhausted).toBe(true);

    await manager.tick(fromIsoUtc("2026-02-01T00:03:00.000Z"));
    const second = context.orderedWindows()[1]!;
    expect(second.state).toBe("COMPLETED");
    expect(second.completionReason).toBe("QUOTA_EXHAUSTED");
    const snapshot = second.snapshot();
    expect(snapshot.evaluationCount).toBe(0);
    expect(snapshot.executionIntentId).toBeNull();
  });

  it("freezes the configuration snapshot on the window instance", async () => {
    const clock = new FixedClock("2026-02-01T00:00:00.000Z");
    const manager = new ExecutionWindowManager({
      profile: profileFrom(),
      clock,
      sink: new InMemoryEventSink(),
    });
    const context = await manager.prepare({
      marketInstanceId: MARKET_ID,
      resolvesAtIso: RESOLVES_AT,
    });
    const window = context.orderedWindows()[0]!;
    expect(Object.isFrozen(window.configuration)).toBe(true);
    expect(() => {
      (window.configuration as { twapBuffer: number }).twapBuffer = 999;
    }).toThrow();
  });

  it("cancels every open window on demand", async () => {
    const clock = new FixedClock("2026-02-01T00:00:00.000Z");
    const manager = new ExecutionWindowManager({
      profile: profileFrom(),
      clock,
      sink: new InMemoryEventSink(),
    });
    const context = await manager.prepare({
      marketInstanceId: MARKET_ID,
      resolvesAtIso: RESOLVES_AT,
    });
    await manager.cancelAll();
    expect(context.orderedWindows().every((w) => w.completionReason === "CANCELLED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

describe("decision domain replay", () => {
  it("reproduces window ordering, FSM, intent ids, quota and events byte-for-byte", async () => {
    const first = await runScenario(profileFrom());
    const second = await runScenario(profileFrom());
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(JSON.stringify(second.runtime)).toBe(JSON.stringify(first.runtime));
  });

  it("keeps configuration snapshot ids stable across runs", () => {
    const a = resolveWindowConfiguration(profileFrom(), profileFrom().windows[0]!);
    const b = resolveWindowConfiguration(profileFrom(), profileFrom().windows[0]!);
    expect(a.configurationSnapshotId).toBe(b.configurationSnapshotId);
  });
});
