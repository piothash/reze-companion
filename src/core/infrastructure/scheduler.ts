/**
 * ARC — scheduler foundation (P0/M0).
 *
 * Timer, lifecycle and precision infrastructure only. There is no TWAP, no
 * polling of business endpoints and no trading cadence here. All time reads go
 * through the injected `Clock`, so a `FixedClock` makes scheduling replayable.
 */
import { type ArcConfig } from "../configuration/schema";
import { type Logger } from "./logging";
import { type MetricsRegistry } from "./metrics";
import { measureClockSkew, type Clock, type EpochMillis } from "../shared/time";

export type TaskState = "registered" | "running" | "idle" | "stopped" | "failed";

export interface ScheduledTaskDefinition {
  name: string;
  intervalMillis: number;
  /** Delay before the first run; defaults to one interval. */
  initialDelayMillis?: number;
  run: (context: TaskRunContext) => Promise<void> | void;
}

export interface TaskRunContext {
  taskName: string;
  scheduledFor: EpochMillis;
  driftMillis: number;
  correlationId: string;
}

export interface TaskStatus {
  name: string;
  state: TaskState;
  runs: number;
  failures: number;
  lastRunAt: string | null;
  lastDriftMillis: number | null;
}

export interface TimerHandle {
  cancel(): void;
}

/** Timer abstraction — swapped for a deterministic driver during replay. */
export interface TimerProvider {
  schedule(delayMillis: number, callback: () => void): TimerHandle;
}

export class HostTimerProvider implements TimerProvider {
  schedule(delayMillis: number, callback: () => void): TimerHandle {
    const handle = setTimeout(callback, Math.max(0, delayMillis));
    return { cancel: () => clearTimeout(handle) };
  }
}

/** Deterministic timer driver: nothing fires until `advance()` is called. */
export class ManualTimerProvider implements TimerProvider {
  private pending: { at: number; callback: () => void; cancelled: boolean }[] = [];
  private currentTime = 0;

  schedule(delayMillis: number, callback: () => void): TimerHandle {
    const entry = { at: this.currentTime + Math.max(0, delayMillis), callback, cancelled: false };
    this.pending.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }

  async advance(millis: number): Promise<void> {
    const target = this.currentTime + millis;
    for (;;) {
      const due = this.pending
        .filter((entry) => !entry.cancelled && entry.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.pending = this.pending.filter((entry) => entry !== due);
      this.currentTime = due.at;
      due.callback();
      await Promise.resolve();
    }
    this.currentTime = target;
  }
}

export class Scheduler {
  private readonly tasks = new Map<string, ScheduledTaskDefinition>();
  private readonly status = new Map<string, TaskStatus>();
  private readonly handles = new Map<string, TimerHandle>();
  private running = false;

  constructor(
    private readonly config: ArcConfig["scheduler"],
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly timers: TimerProvider = new HostTimerProvider(),
    private readonly metrics?: MetricsRegistry,
  ) {}

  register(definition: ScheduledTaskDefinition): void {
    if (this.tasks.has(definition.name)) {
      throw new Error(`Scheduler task already registered: ${definition.name}`);
    }
    if (this.tasks.size >= this.config.maxConcurrentTasks) {
      throw new Error(`Scheduler capacity exceeded (${this.config.maxConcurrentTasks})`);
    }
    this.tasks.set(definition.name, definition);
    this.status.set(definition.name, {
      name: definition.name,
      state: "registered",
      runs: 0,
      failures: 0,
      lastRunAt: null,
      lastDriftMillis: null,
    });
    this.logger.info({ reasonCode: "SCH_TASK_REGISTERED", fields: { task: definition.name } });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const definition of this.tasks.values()) {
      this.arm(definition, definition.initialDelayMillis ?? definition.intervalMillis);
    }
  }

  stop(): void {
    this.running = false;
    for (const handle of this.handles.values()) handle.cancel();
    this.handles.clear();
    for (const status of this.status.values()) status.state = "stopped";
  }

  statuses(): TaskStatus[] {
    return [...this.status.values()].map((entry) => ({ ...entry }));
  }

  /** Reports (never silently corrects) skew against an authoritative clock. */
  checkClockSkew(remoteNow: EpochMillis): ReturnType<typeof measureClockSkew> {
    const skew = measureClockSkew(this.clock.now(), remoteNow, this.config.clockSkewToleranceMillis);
    if (!skew.withinTolerance) {
      this.logger.warn({ reasonCode: "SCH_CLOCK_SKEW", fields: { offsetMillis: skew.offsetMillis } });
    }
    return skew;
  }

  private arm(definition: ScheduledTaskDefinition, delayMillis: number): void {
    const scheduledFor = this.clock.now() + delayMillis;
    const handle = this.timers.schedule(delayMillis, () => {
      void this.execute(definition, scheduledFor);
    });
    this.handles.set(definition.name, handle);
  }

  private async execute(definition: ScheduledTaskDefinition, scheduledFor: EpochMillis): Promise<void> {
    const status = this.status.get(definition.name);
    if (!status || !this.running) return;

    const startedMonotonic = this.clock.monotonic();
    const driftMillis = this.clock.now() - scheduledFor;
    status.state = "running";
    status.lastDriftMillis = driftMillis;

    if (Math.abs(driftMillis) > this.config.maxDriftMillis) {
      this.logger.warn({
        reasonCode: "SCH_TASK_OVERRUN",
        fields: { task: definition.name, driftMillis },
      });
    }

    this.logger.debug({ reasonCode: "SCH_TASK_STARTED", fields: { task: definition.name } });

    try {
      await definition.run({
        taskName: definition.name,
        scheduledFor,
        driftMillis,
        correlationId: `${definition.name}:${scheduledFor}`,
      });
      status.runs += 1;
      status.state = "idle";
      this.logger.debug({ reasonCode: "SCH_TASK_COMPLETED", fields: { task: definition.name } });
    } catch (error) {
      status.failures += 1;
      status.state = "failed";
      this.logger.error({
        reasonCode: "SCH_TASK_FAILED",
        message: error instanceof Error ? error.message : "task failed",
        fields: { task: definition.name },
      });
    } finally {
      status.lastRunAt = this.clock.isoNow();
      this.metrics?.observe("scheduler_task_duration_ms", this.clock.monotonic() - startedMonotonic, {
        task: definition.name,
      });
      if (this.running) this.arm(definition, definition.intervalMillis);
    }
  }
}
