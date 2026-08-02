/**
 * ARC — Market Lifecycle Engine (M1).
 *
 * Owns lifecycle only: DISCOVERED → ACTIVE → CLOSING → RESOLVED, or INVALID
 * from any non-terminal state. No trading semantics attach to these states.
 */
import { defineStateMachine, StateMachine } from "../infrastructure/fsm";
import { fromIsoUtc, type Clock } from "../shared/time";
import { type MarketDomainConfig } from "./configuration";
import {
  MARKET_LIFECYCLE_STATES,
  type MarketDescriptor,
  type MarketLifecycleEvent,
  type MarketLifecycleState,
} from "./types";

export const marketLifecycleMachine = defineStateMachine<
  MarketLifecycleState,
  MarketLifecycleEvent
>({
  id: "market-lifecycle",
  initial: "DISCOVERED",
  states: MARKET_LIFECYCLE_STATES,
  terminal: ["RESOLVED", "INVALID"],
  transitions: [
    { from: "DISCOVERED", event: "ACTIVATE", to: "ACTIVE", reasonCode: "MKT_LIFECYCLE_UPDATED" },
    { from: "DISCOVERED", event: "INVALIDATE", to: "INVALID", reasonCode: "MKT_INVALIDATED" },
    { from: "ACTIVE", event: "BEGIN_CLOSING", to: "CLOSING", reasonCode: "MKT_LIFECYCLE_UPDATED" },
    { from: "ACTIVE", event: "RESOLVE", to: "RESOLVED", reasonCode: "MKT_LIFECYCLE_UPDATED" },
    { from: "ACTIVE", event: "INVALIDATE", to: "INVALID", reasonCode: "MKT_INVALIDATED" },
    { from: "CLOSING", event: "RESOLVE", to: "RESOLVED", reasonCode: "MKT_LIFECYCLE_UPDATED" },
    { from: "CLOSING", event: "INVALIDATE", to: "INVALID", reasonCode: "MKT_INVALIDATED" },
  ],
});

export interface LifecycleEvaluation {
  from: MarketLifecycleState;
  to: MarketLifecycleState;
  changed: boolean;
  reason: string;
}

/**
 * Derives the lifecycle state a market should occupy from official metadata
 * and the clock. Pure and deterministic: identical inputs, identical output.
 */
export function evaluateLifecycle(
  current: MarketLifecycleState,
  descriptor: MarketDescriptor,
  config: MarketDomainConfig,
  clock: Clock,
): { event: MarketLifecycleEvent | null; reason: string } {
  if (!descriptor.valid) return { event: "INVALIDATE", reason: "market metadata invalid" };
  if (current === "RESOLVED" || current === "INVALID") {
    return { event: null, reason: "terminal state" };
  }

  const now = clock.now();
  const resolvesAt = fromIsoUtc(descriptor.resolvesAtIso);
  const opensAt = fromIsoUtc(descriptor.opensAtIso);

  if (descriptor.venueClosed || now >= resolvesAt) {
    return { event: "RESOLVE", reason: descriptor.venueClosed ? "venue closed" : "resolution time reached" };
  }
  if (now >= resolvesAt - config.discovery.closingLeadMillis) {
    return current === "CLOSING"
      ? { event: null, reason: "already closing" }
      : current === "DISCOVERED"
        ? { event: "ACTIVATE", reason: "activating before closing transition" }
        : { event: "BEGIN_CLOSING", reason: "closing lead window entered" };
  }
  if (current === "DISCOVERED" && (descriptor.venueActive || now >= opensAt)) {
    return { event: "ACTIVATE", reason: "market open on venue" };
  }
  return { event: null, reason: "no lifecycle change" };
}

/** Stateful lifecycle holder for one market instance. */
export class MarketLifecycleEngine {
  private readonly machine: StateMachine<MarketLifecycleState, MarketLifecycleEvent>;

  constructor(
    private readonly config: MarketDomainConfig,
    private readonly clock: Clock,
    initial?: MarketLifecycleState,
  ) {
    this.machine = new StateMachine(marketLifecycleMachine, clock, initial);
  }

  get state(): MarketLifecycleState {
    return this.machine.state;
  }

  get isTerminal(): boolean {
    return this.machine.isTerminal;
  }

  get history() {
    return this.machine.history;
  }

  /** Advances the lifecycle to whatever metadata + clock imply. */
  evaluate(descriptor: MarketDescriptor): LifecycleEvaluation {
    const from = this.machine.state;
    const { event, reason } = evaluateLifecycle(from, descriptor, this.config, this.clock);
    if (!event || !this.machine.can(event)) return { from, to: from, changed: false, reason };
    this.machine.send(event, descriptor);
    return { from, to: this.machine.state, changed: true, reason };
  }

  /** Deterministic replay from a recorded lifecycle event list. */
  static replay(
    config: MarketDomainConfig,
    clock: Clock,
    events: readonly MarketLifecycleEvent[],
  ): MarketLifecycleEngine {
    const engine = new MarketLifecycleEngine(config, clock);
    for (const event of events) engine.machine.send(event);
    return engine;
  }
}
