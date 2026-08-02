/**
 * ARC — generic finite state machine framework (P0/M0).
 *
 * Reusable infrastructure only. No Window FSM, Order FSM, Retry FSM,
 * Settlement FSM or Lifecycle FSM is defined here — later milestones declare
 * those on top of this framework.
 */
import { type ReasonCode } from "../contracts/reason-codes";
import { type Clock } from "../shared/time";

export interface Transition<TState extends string, TEvent extends string> {
  from: TState;
  event: TEvent;
  to: TState;
  reasonCode: ReasonCode;
  /** Optional guard; a false result rejects the transition. */
  guard?: (context: TransitionContext<TState, TEvent>) => boolean;
}

export interface TransitionContext<TState extends string, TEvent extends string> {
  from: TState;
  event: TEvent;
  payload: unknown;
  at: string;
}

export interface StateMachineDefinition<TState extends string, TEvent extends string> {
  id: string;
  initial: TState;
  states: readonly TState[];
  terminal?: readonly TState[];
  transitions: readonly Transition<TState, TEvent>[];
}

export interface TransitionRecord<TState extends string, TEvent extends string> {
  from: TState;
  to: TState;
  event: TEvent;
  reasonCode: ReasonCode;
  at: string;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly machineId: string,
    readonly from: string,
    readonly event: string,
  ) {
    super(`No transition from "${from}" on "${event}" in machine "${machineId}"`);
    this.name = "InvalidTransitionError";
  }
}

export function validateDefinition<TState extends string, TEvent extends string>(
  definition: StateMachineDefinition<TState, TEvent>,
): void {
  const states = new Set<string>(definition.states);
  if (!states.has(definition.initial)) {
    throw new Error(`Initial state "${definition.initial}" is not declared in ${definition.id}`);
  }
  for (const transition of definition.transitions) {
    if (!states.has(transition.from) || !states.has(transition.to)) {
      throw new Error(
        `Transition ${transition.from} -> ${transition.to} references an undeclared state in ${definition.id}`,
      );
    }
  }
  for (const terminal of definition.terminal ?? []) {
    if (!states.has(terminal)) {
      throw new Error(`Terminal state "${terminal}" is not declared in ${definition.id}`);
    }
  }
}

export class StateMachine<TState extends string, TEvent extends string> {
  private current: TState;
  readonly history: TransitionRecord<TState, TEvent>[] = [];

  constructor(
    private readonly definition: StateMachineDefinition<TState, TEvent>,
    private readonly clock: Clock,
    initial?: TState,
  ) {
    validateDefinition(definition);
    this.current = initial ?? definition.initial;
  }

  get state(): TState {
    return this.current;
  }

  get isTerminal(): boolean {
    return (this.definition.terminal ?? []).includes(this.current);
  }

  can(event: TEvent): boolean {
    return this.resolve(event, undefined) !== undefined;
  }

  send(event: TEvent, payload?: unknown): TransitionRecord<TState, TEvent> {
    const transition = this.resolve(event, payload);
    if (!transition) throw new InvalidTransitionError(this.definition.id, this.current, event);

    const record: TransitionRecord<TState, TEvent> = {
      from: this.current,
      to: transition.to,
      event,
      reasonCode: transition.reasonCode,
      at: this.clock.isoNow(),
    };
    this.current = transition.to;
    this.history.push(record);
    return record;
  }

  /** Replays a recorded transition list; identical input yields identical state. */
  static replay<TState extends string, TEvent extends string>(
    definition: StateMachineDefinition<TState, TEvent>,
    clock: Clock,
    events: readonly TEvent[],
  ): StateMachine<TState, TEvent> {
    const machine = new StateMachine(definition, clock);
    for (const event of events) machine.send(event);
    return machine;
  }

  private resolve(event: TEvent, payload: unknown): Transition<TState, TEvent> | undefined {
    return this.definition.transitions.find((transition) => {
      if (transition.from !== this.current || transition.event !== event) return false;
      if (!transition.guard) return true;
      return transition.guard({ from: this.current, event, payload, at: this.clock.isoNow() });
    });
  }
}

export function defineStateMachine<TState extends string, TEvent extends string>(
  definition: StateMachineDefinition<TState, TEvent>,
): StateMachineDefinition<TState, TEvent> {
  validateDefinition(definition);
  return definition;
}
