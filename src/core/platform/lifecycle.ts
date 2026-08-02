/**
 * ARC — process lifecycle (M6.5).
 *
 * Graceful shutdown runs an ordered, idempotent sequence with a per-step
 * budget: stop producers first, drain in-flight work, then flush every sink so
 * nothing is lost or half-written. Graceful restart restores execution context,
 * quota, active windows, exposure reservations and the replay position from the
 * event stream, with an idempotency guard that prevents duplicate business
 * events.
 */
import { REASON_CODES, type ReasonCode } from "../contracts/reason-codes";
import { type EventEnvelope } from "../contracts/event-envelope";
import { type Clock, systemClock } from "../shared/time";
import { withTimeout } from "../infrastructure/health";
import {
  createRecoveryGuard,
  recoverFromEvents,
  type RecoveryGuard,
  type RecoveryState,
} from "./recovery";

/** Fixed order. Producers stop before consumers drain, sinks flush last. */
export const SHUTDOWN_STEPS = [
  "stop-scheduler",
  "stop-feed",
  "finish-current-event",
  "flush-event-store",
  "flush-notifications",
  "persist-snapshots",
  "flush-logs",
] as const;

export type ShutdownStepName = (typeof SHUTDOWN_STEPS)[number];

export interface ShutdownStep {
  readonly name: ShutdownStepName;
  readonly run: () => Promise<void> | void;
  /** Per-step budget; a step that overruns is reported, never left hanging. */
  readonly timeoutMillis?: number;
  /** A non-critical step failing degrades the shutdown but does not abort it. */
  readonly critical?: boolean;
}

export interface ShutdownStepResult {
  readonly name: ShutdownStepName;
  readonly status: "completed" | "failed" | "timeout" | "skipped";
  readonly reasonCode: string;
  readonly detail?: string;
  readonly durationMillis: number;
}

export interface ShutdownReport {
  readonly clean: boolean;
  readonly reasonCode: string;
  readonly reason: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly steps: readonly ShutdownStepResult[];
  readonly exitCode: 0 | 1;
}

export interface ShutdownOptions {
  clock?: Clock;
  /** Default per-step budget. */
  stepTimeoutMillis?: number;
}

/**
 * Ordered shutdown coordinator. `shutdown()` is idempotent: a second signal
 * returns the first report instead of re-running the sequence.
 */
export class GracefulShutdown {
  private readonly steps = new Map<ShutdownStepName, ShutdownStep>();
  private readonly clock: Clock;
  private readonly stepTimeoutMillis: number;
  private inFlight: Promise<ShutdownReport> | null = null;
  private report: ShutdownReport | null = null;

  constructor(options: ShutdownOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.stepTimeoutMillis = options.stepTimeoutMillis ?? 5_000;
  }

  register(step: ShutdownStep): void {
    this.steps.set(step.name, step);
  }

  isShuttingDown(): boolean {
    return this.inFlight !== null;
  }

  lastReport(): ShutdownReport | null {
    return this.report;
  }

  shutdown(reason: string): Promise<ShutdownReport> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run(reason);
    return this.inFlight;
  }

  private async run(reason: string): Promise<ShutdownReport> {
    const startedAt = this.clock.isoNow();
    const results: ShutdownStepResult[] = [];

    for (const name of SHUTDOWN_STEPS) {
      const step = this.steps.get(name);
      if (!step) {
        results.push({
          name,
          status: "skipped",
          reasonCode: REASON_CODES.LIF_STEP_COMPLETED.code,
          detail: "no handler registered",
          durationMillis: 0,
        });
        continue;
      }

      const started = this.clock.monotonic();
      try {
        await withTimeout(
          Promise.resolve().then(() => step.run()),
          step.timeoutMillis ?? this.stepTimeoutMillis,
        );
        results.push({
          name,
          status: "completed",
          reasonCode: REASON_CODES.LIF_STEP_COMPLETED.code,
          durationMillis: Math.max(0, this.clock.monotonic() - started),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        const code: ReasonCode = timedOut ? "LIF_STEP_TIMEOUT" : "LIF_STEP_FAILED";
        results.push({
          name,
          status: timedOut ? "timeout" : "failed",
          reasonCode: REASON_CODES[code].code,
          detail: error instanceof Error ? error.message : String(error),
          durationMillis: Math.max(0, this.clock.monotonic() - started),
        });
      }
    }

    const failed = results.filter(
      (entry) => entry.status === "failed" || entry.status === "timeout",
    );
    const criticalFailed = failed.filter((entry) => this.steps.get(entry.name)?.critical !== false);
    const clean = criticalFailed.length === 0;

    this.report = {
      clean,
      reasonCode: clean
        ? REASON_CODES.LIF_SHUTDOWN_COMPLETED.code
        : REASON_CODES.LIF_SHUTDOWN_DEGRADED.code,
      reason,
      startedAt,
      completedAt: this.clock.isoNow(),
      steps: results,
      exitCode: clean ? 0 : 1,
    };
    return this.report;
  }
}

// ---------------------------------------------------------------------------
// Graceful restart
// ---------------------------------------------------------------------------

export interface RestoredContext {
  readonly executionContextIds: readonly string[];
  readonly quota: RecoveryState["quota"];
  readonly activeWindowIds: readonly string[];
  readonly openIntentIds: readonly string[];
  readonly openOrderIds: readonly string[];
  readonly reservations: RecoveryState["reservations"];
  readonly reservedTotal: number;
  /** Replay/append position — the next sequence the process may emit. */
  readonly resumeSequence: number;
  readonly lastEventId: string | null;
  readonly digest: string;
}

export interface RestoreReport {
  readonly restored: boolean;
  readonly reasonCode: string;
  readonly restoredAt: string;
  readonly eventsConsidered: number;
  readonly context: RestoredContext;
  readonly guard: RecoveryGuard;
  readonly detail: string;
}

/**
 * Rebuilds resumable state after a restart. Pure with respect to the event
 * stream: the same stream always restores the same context, and the returned
 * guard suppresses any business event that already exists.
 */
export function restoreAfterRestart(
  events: readonly EventEnvelope[],
  options: { clock?: Clock } = {},
): RestoreReport {
  const clock = options.clock ?? systemClock;
  const state = recoverFromEvents(events);
  const guard = createRecoveryGuard(state);

  return {
    restored: true,
    reasonCode: REASON_CODES.LIF_RESTORE_COMPLETED.code,
    restoredAt: clock.isoNow(),
    eventsConsidered: events.length,
    context: {
      executionContextIds: state.executionContextIds,
      quota: state.quota,
      activeWindowIds: state.activeWindowIds,
      openIntentIds: state.openIntentIds,
      openOrderIds: state.openOrderIds,
      reservations: state.reservations,
      reservedTotal: state.reservedTotal,
      resumeSequence: state.lastSequence + 1,
      lastEventId: state.lastEventId,
      digest: state.digest,
    },
    guard,
    detail: `restored ${state.activeWindowIds.length} active window(s), quota ${
      state.quota.remaining ?? "n/a"
    }, ${state.reservations.length} reservation(s)`,
  };
}

/**
 * Filters events a restarted process is about to emit, dropping anything the
 * stream already contains. This is the concrete "no duplicate business events"
 * guarantee for a PM2 restart.
 */
export function suppressDuplicateEmissions(
  candidates: readonly EventEnvelope[],
  guard: RecoveryGuard,
): { emit: EventEnvelope[]; suppressed: EventEnvelope[] } {
  const emit: EventEnvelope[] = [];
  const suppressed: EventEnvelope[] = [];

  for (const event of candidates) {
    const intentId = event.metadata.executionIntentId ?? null;
    const known =
      (intentId !== null &&
        guard.isKnownIntent(intentId) &&
        event.type.endsWith("intent.created")) ||
      (intentId !== null && guard.isSettled(intentId));
    if (known) suppressed.push(event);
    else emit.push(event);
  }

  return { emit, suppressed };
}
