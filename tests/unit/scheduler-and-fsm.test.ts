import { describe, expect, it } from "vitest";

import { bootstrapConfig } from "@/core/configuration/environment";
import { ManualTimerProvider, Scheduler } from "@/core/infrastructure/scheduler";
import { Logger, MemoryTransport } from "@/core/infrastructure/logging";
import {
  InvalidTransitionError,
  StateMachine,
  defineStateMachine,
  validateDefinition,
} from "@/core/infrastructure/fsm";
import { FixedClock } from "@/core/shared/time";

const config = bootstrapConfig({ ARC_ENVIRONMENT: "test", ARC_NETWORK: "testnet" });

function harness() {
  const clock = new FixedClock("2026-02-01T00:00:00.000Z");
  const timers = new ManualTimerProvider();
  const transport = new MemoryTransport();
  const log = new Logger({ engine: "scheduler", level: "debug", clock, transport });
  const scheduler = new Scheduler(config.scheduler, clock, log, timers);
  return { clock, timers, transport, scheduler };
}

describe("scheduler", () => {
  it("runs a registered task and reschedules it", async () => {
    const { timers, scheduler } = harness();
    let runs = 0;
    scheduler.register({ name: "tick", intervalMillis: 100, run: () => void (runs += 1) });
    scheduler.start();

    await timers.advance(350);
    expect(runs).toBe(3);
    expect(scheduler.statuses()[0]?.state).toBe("idle");
  });

  it("isolates a failing task without stopping the loop", async () => {
    const { timers, scheduler } = harness();
    let attempts = 0;
    scheduler.register({
      name: "flaky",
      intervalMillis: 100,
      run: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("first run fails");
      },
    });
    scheduler.start();

    await timers.advance(250);
    const status = scheduler.statuses()[0];
    expect(status?.failures).toBe(1);
    expect(status?.runs).toBe(1);
  });

  it("stops cleanly and cancels pending timers", async () => {
    const { timers, scheduler } = harness();
    let runs = 0;
    scheduler.register({ name: "tick", intervalMillis: 50, run: () => void (runs += 1) });
    scheduler.start();
    await timers.advance(50);
    scheduler.stop();
    await timers.advance(500);
    expect(runs).toBe(1);
    expect(scheduler.statuses()[0]?.state).toBe("stopped");
  });

  it("rejects duplicate task names", () => {
    const { scheduler } = harness();
    scheduler.register({ name: "tick", intervalMillis: 10, run: () => {} });
    expect(() => scheduler.register({ name: "tick", intervalMillis: 10, run: () => {} })).toThrow();
  });

  it("reports clock skew beyond tolerance without correcting it", () => {
    const { scheduler, clock } = harness();
    const skew = scheduler.checkClockSkew(clock.now() + config.scheduler.clockSkewToleranceMillis + 1);
    expect(skew.withinTolerance).toBe(false);
  });
});

type DoorState = "closed" | "open" | "locked";
type DoorEvent = "OPEN" | "CLOSE" | "LOCK";

const doorMachine = defineStateMachine<DoorState, DoorEvent>({
  id: "door",
  initial: "closed",
  states: ["closed", "open", "locked"],
  terminal: ["locked"],
  transitions: [
    { from: "closed", event: "OPEN", to: "open", reasonCode: "FSM_TRANSITION" },
    { from: "open", event: "CLOSE", to: "closed", reasonCode: "FSM_TRANSITION" },
    { from: "closed", event: "LOCK", to: "locked", reasonCode: "FSM_TRANSITION" },
  ],
});

describe("state machine framework", () => {
  it("transitions on a declared event and records history", () => {
    const machine = new StateMachine(doorMachine, new FixedClock("2026-02-01T00:00:00.000Z"));
    machine.send("OPEN");
    expect(machine.state).toBe("open");
    expect(machine.history[0]?.reasonCode).toBe("FSM_TRANSITION");
  });

  it("rejects an undeclared transition", () => {
    const machine = new StateMachine(doorMachine, new FixedClock(0));
    expect(() => machine.send("CLOSE")).toThrow(InvalidTransitionError);
    expect(machine.state).toBe("closed");
  });

  it("honours guards", () => {
    const guarded = defineStateMachine<DoorState, DoorEvent>({
      ...doorMachine,
      transitions: [
        { from: "closed", event: "OPEN", to: "open", reasonCode: "FSM_TRANSITION", guard: () => false },
      ],
    });
    const machine = new StateMachine(guarded, new FixedClock(0));
    expect(machine.can("OPEN")).toBe(false);
    expect(() => machine.send("OPEN")).toThrow(InvalidTransitionError);
  });

  it("marks terminal states", () => {
    const machine = new StateMachine(doorMachine, new FixedClock(0));
    machine.send("LOCK");
    expect(machine.isTerminal).toBe(true);
  });

  it("replays identically for identical input", () => {
    const events: DoorEvent[] = ["OPEN", "CLOSE", "LOCK"];
    const a = StateMachine.replay(doorMachine, new FixedClock(0), events);
    const b = StateMachine.replay(doorMachine, new FixedClock(0), events);
    expect(a.state).toBe(b.state);
    expect(a.history).toEqual(b.history);
  });

  it("rejects a definition referencing an undeclared state", () => {
    expect(() =>
      validateDefinition({
        id: "bad",
        initial: "a",
        states: ["a"],
        transitions: [{ from: "a", event: "GO", to: "b", reasonCode: "FSM_TRANSITION" }],
      } as never),
    ).toThrow();
  });
});
