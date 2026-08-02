/**
 * ARC — Window Instance (M2).
 *
 * One instance per (market instance, window definition). It owns its FSM, its
 * frozen configuration snapshot and its runtime counters. Configuration is
 * immutable from creation; the instance completes exactly once.
 */
import { type Clock } from "../shared/time";
import { StateMachine } from "../infrastructure/fsm";
import { WINDOW_FSM } from "./window-fsm";
import {
  freezeDeep,
  windowInstanceSnapshotSchema,
  type WindowCompletionReason,
  type WindowConfigurationSnapshot,
  type WindowInstanceSnapshot,
  type WindowOffsetUnit,
  type WindowState,
} from "./types";

export interface WindowInstanceOptions {
  windowInstanceId: string;
  windowDefinitionId: string;
  marketInstanceId: string;
  executionContextId: string;
  sequence: number;
  priority: number;
  offset: number;
  unit: WindowOffsetUnit;
  configuration: WindowConfigurationSnapshot;
  activatesAtIso: string;
  expiresAtIso: string;
  tradeQuotaAtCreation: number;
  clock: Clock;
}

export class WindowInstance {
  private readonly machine: StateMachine<WindowState, "OPEN" | "ACTIVATE" | "EVALUATE" | "EVALUATION_INCONCLUSIVE" | "INTENT_CREATED" | "COMPLETE">;
  private readonly createdAtIso: string;
  private completedAtIso: string | null = null;
  private completionReasonValue: WindowCompletionReason | null = null;
  private executionIntentIdValue: string | null = null;
  private marketStateVersionValue: number | null = null;
  private evaluationCountValue = 0;
  private tradeQuotaAtCompletionValue: number | null = null;

  /** Frozen at construction; never replaced for the life of the instance. */
  readonly configuration: WindowConfigurationSnapshot;

  constructor(private readonly options: WindowInstanceOptions) {
    this.configuration = freezeDeep({ ...options.configuration });
    this.machine = new StateMachine(WINDOW_FSM, options.clock);
    this.createdAtIso = options.clock.isoNow();
  }

  get id(): string {
    return this.options.windowInstanceId;
  }

  get priority(): number {
    return this.options.priority;
  }

  get sequence(): number {
    return this.options.sequence;
  }

  get state(): WindowState {
    return this.machine.state;
  }

  get isCompleted(): boolean {
    return this.machine.state === "COMPLETED";
  }

  get hasIntent(): boolean {
    return this.executionIntentIdValue !== null;
  }

  get executionIntentId(): string | null {
    return this.executionIntentIdValue;
  }

  get completionReason(): WindowCompletionReason | null {
    return this.completionReasonValue;
  }

  get activatesAtIso(): string {
    return this.options.activatesAtIso;
  }

  get expiresAtIso(): string {
    return this.options.expiresAtIso;
  }

  /** CONFIGURED → WAITING. */
  open(): void {
    this.machine.send("OPEN");
  }

  /** WAITING → ACTIVE. */
  activate(): void {
    this.machine.send("ACTIVATE");
  }

  /** ACTIVE → EVALUATING. Every market-state update triggers a fresh pass. */
  beginEvaluation(marketStateVersion: number): void {
    this.machine.send("EVALUATE");
    this.marketStateVersionValue = marketStateVersion;
    this.evaluationCountValue += 1;
  }

  /** EVALUATING → ACTIVE; the window stays open for the next update. */
  inconclusive(): void {
    this.machine.send("EVALUATION_INCONCLUSIVE");
  }

  /** EVALUATING → EXECUTING. At most one intent per window, forever. */
  attachIntent(executionIntentId: string): void {
    if (this.executionIntentIdValue !== null) {
      throw new Error(`Window ${this.id} already produced an execution intent`);
    }
    this.machine.send("INTENT_CREATED");
    this.executionIntentIdValue = executionIntentId;
  }

  /** Terminal transition. Idempotent: a completed window is never recompleted. */
  complete(reason: WindowCompletionReason, tradeQuotaRemaining: number): boolean {
    if (this.isCompleted) return false;
    this.machine.send("COMPLETE");
    this.completionReasonValue = reason;
    this.tradeQuotaAtCompletionValue = tradeQuotaRemaining;
    this.completedAtIso = this.options.clock.isoNow();
    return true;
  }

  snapshot(): WindowInstanceSnapshot {
    return freezeDeep(
      windowInstanceSnapshotSchema.parse({
        windowInstanceId: this.options.windowInstanceId,
        windowDefinitionId: this.options.windowDefinitionId,
        marketInstanceId: this.options.marketInstanceId,
        executionContextId: this.options.executionContextId,
        sequence: this.options.sequence,
        priority: this.options.priority,
        offset: this.options.offset,
        unit: this.options.unit,
        state: this.machine.state,
        configuration: this.configuration,
        activatesAtIso: this.options.activatesAtIso,
        expiresAtIso: this.options.expiresAtIso,
        tradeQuotaAtCreation: this.options.tradeQuotaAtCreation,
        tradeQuotaAtCompletion: this.tradeQuotaAtCompletionValue,
        marketStateVersion: this.marketStateVersionValue,
        evaluationCount: this.evaluationCountValue,
        executionIntentId: this.executionIntentIdValue,
        completionReason: this.completionReasonValue,
        createdAtIso: this.createdAtIso,
        completedAtIso: this.completedAtIso,
      } satisfies WindowInstanceSnapshot),
    );
  }
}
