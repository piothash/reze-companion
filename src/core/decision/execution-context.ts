/**
 * ARC — Execution Context (M2).
 *
 * Runtime state only. NOT business persistence, NOT a ledger, NOT Supabase
 * business history. It is reconstructible after a restart and owns exactly:
 *   • Trade Quota
 *   • Active Window Instances
 *   • Window runtime state
 *   • Execution runtime state
 *   • Exposure reservations (placeholder for the Risk Domain)
 * Nothing else.
 */
import { Ids } from "../shared/ids";
import { TradeQuota } from "./trade-quota";
import { freezeDeep, type TradeQuotaSnapshot, type WindowInstanceSnapshot } from "./types";
import { type WindowInstance } from "./window-instance";

export interface ExposureReservation {
  readonly windowInstanceId: string;
  readonly executionIntentId: string;
  readonly amount: number;
}

export interface ExecutionRuntimeState {
  readonly executionContextId: string;
  readonly marketInstanceId: string;
  readonly executionProfileId: string;
  readonly quota: TradeQuotaSnapshot;
  readonly windows: readonly WindowInstanceSnapshot[];
  readonly exposureReservations: readonly ExposureReservation[];
  readonly intentsCreated: number;
}

export interface ExecutionContextOptions {
  marketInstanceId: string;
  executionProfileId: string;
  /** Trade quota for this market instance; monotonically decreasing. */
  quota: number;
}

export class ExecutionContext {
  readonly executionContextId: string;
  readonly marketInstanceId: string;
  readonly executionProfileId: string;
  readonly quota: TradeQuota;

  private readonly windows = new Map<string, WindowInstance>();
  private readonly reservations: ExposureReservation[] = [];
  private intentsCreatedCount = 0;

  constructor(options: ExecutionContextOptions) {
    this.marketInstanceId = options.marketInstanceId;
    this.executionProfileId = options.executionProfileId;
    this.executionContextId = Ids.executionContext(
      options.marketInstanceId,
      options.executionProfileId,
    );
    this.quota = new TradeQuota(options.quota);
  }

  get intentsCreated(): number {
    return this.intentsCreatedCount;
  }

  registerWindow(window: WindowInstance): void {
    if (this.windows.has(window.id)) {
      throw new Error(`Window ${window.id} is already registered in this execution context`);
    }
    this.windows.set(window.id, window);
  }

  window(windowInstanceId: string): WindowInstance | undefined {
    return this.windows.get(windowInstanceId);
  }

  /** Window instances ordered by descending priority (earliest offset first). */
  orderedWindows(): readonly WindowInstance[] {
    return [...this.windows.values()].sort((a, b) => a.sequence - b.sequence);
  }

  activeWindows(): readonly WindowInstance[] {
    return this.orderedWindows().filter(
      (window) => window.state === "ACTIVE" || window.state === "EVALUATING",
    );
  }

  recordIntent(): void {
    this.intentsCreatedCount += 1;
  }

  /** Placeholder surface for the Risk Domain; no risk logic lives here. */
  reserveExposure(reservation: ExposureReservation): void {
    this.reservations.push(reservation);
  }

  releaseExposure(executionIntentId: string): void {
    const index = this.reservations.findIndex(
      (entry) => entry.executionIntentId === executionIntentId,
    );
    if (index >= 0) this.reservations.splice(index, 1);
  }

  runtimeState(): ExecutionRuntimeState {
    return freezeDeep({
      executionContextId: this.executionContextId,
      marketInstanceId: this.marketInstanceId,
      executionProfileId: this.executionProfileId,
      quota: this.quota.snapshot(),
      windows: this.orderedWindows().map((window) => window.snapshot()),
      exposureReservations: [...this.reservations],
      intentsCreated: this.intentsCreatedCount,
    } satisfies ExecutionRuntimeState);
  }
}
