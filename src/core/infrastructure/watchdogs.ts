/**
 * ARC — runtime watchdogs (M6.5).
 *
 * Every subsystem reports independently. A watchdog is a heartbeat plus an
 * error counter, graded against configured budgets into healthy / warning /
 * critical. Budgets are configuration, never hardcoded business values.
 */
import { REASON_CODES, type ReasonCode } from "../contracts/reason-codes";
import { type Clock, systemClock } from "../shared/time";

export const WATCHDOG_SUBSYSTEMS = [
  "feed",
  "scheduler",
  "twap",
  "ptb",
  "decision",
  "risk",
  "execution",
  "replay",
  "supabase",
  "api",
  "notifications",
] as const;

export type WatchdogSubsystem = (typeof WATCHDOG_SUBSYSTEMS)[number];

export const WATCHDOG_LEVELS = ["healthy", "warning", "critical"] as const;
export type WatchdogLevel = (typeof WATCHDOG_LEVELS)[number];

const LEVEL_SEVERITY: Record<WatchdogLevel, number> = { healthy: 0, warning: 1, critical: 2 };

export interface WatchdogPolicy {
  readonly subsystem: WatchdogSubsystem;
  /** Silence beyond this budget degrades the subsystem to `warning`. */
  readonly warnAfterMillis: number;
  /** Silence beyond this budget escalates the subsystem to `critical`. */
  readonly criticalAfterMillis: number;
  /** Consecutive errors that escalate to `warning`. */
  readonly warnAfterErrors?: number;
  /** Consecutive errors that escalate to `critical`. */
  readonly criticalAfterErrors?: number;
  /** A non-required subsystem can never make the runtime critical overall. */
  readonly required?: boolean;
  /** Subsystems that are legitimately idle until first used. */
  readonly optionalUntilFirstBeat?: boolean;
}

export interface WatchdogState {
  readonly subsystem: WatchdogSubsystem;
  readonly level: WatchdogLevel;
  readonly reasonCode: string;
  readonly detail: string;
  readonly lastHeartbeatAt: string | null;
  readonly lastErrorAt: string | null;
  readonly ageMillis: number | null;
  readonly consecutiveErrors: number;
  readonly required: boolean;
  readonly observedAt: string;
}

export interface WatchdogReport {
  readonly level: WatchdogLevel;
  readonly observedAt: string;
  readonly subsystems: readonly WatchdogState[];
}

interface Entry {
  policy: WatchdogPolicy;
  lastHeartbeatAt: string | null;
  lastHeartbeatMillis: number | null;
  lastErrorAt: string | null;
  lastErrorDetail: string | null;
  consecutiveErrors: number;
  degraded: boolean;
  degradedDetail: string | null;
}

export function worstWatchdogLevel(levels: readonly WatchdogLevel[]): WatchdogLevel {
  return levels.reduce<WatchdogLevel>(
    (worst, level) => (LEVEL_SEVERITY[level] > LEVEL_SEVERITY[worst] ? level : worst),
    "healthy",
  );
}

/** Default budgets, expressed as multiples of the caller's tick interval. */
export function defaultWatchdogPolicies(options: {
  tickIntervalMillis: number;
  feedStaleAfterMillis: number;
}): WatchdogPolicy[] {
  const tick = Math.max(1, options.tickIntervalMillis);
  const base = (multiplier: number) => tick * multiplier;
  const make = (
    subsystem: WatchdogSubsystem,
    warn: number,
    critical: number,
    extra: Partial<WatchdogPolicy> = {},
  ): WatchdogPolicy => ({
    subsystem,
    warnAfterMillis: warn,
    criticalAfterMillis: critical,
    warnAfterErrors: 1,
    criticalAfterErrors: 3,
    required: true,
    ...extra,
  });

  return [
    make("feed", options.feedStaleAfterMillis, options.feedStaleAfterMillis * 3),
    make("scheduler", base(5), base(15)),
    make("twap", options.feedStaleAfterMillis * 2, options.feedStaleAfterMillis * 6),
    make("ptb", options.feedStaleAfterMillis * 2, options.feedStaleAfterMillis * 6),
    make("decision", base(60), base(180)),
    make("risk", base(60), base(180)),
    make("execution", base(120), base(600), { optionalUntilFirstBeat: true }),
    make("replay", base(600), base(1_800), { required: false, optionalUntilFirstBeat: true }),
    make("supabase", base(120), base(600)),
    make("api", base(120), base(600), { required: false }),
    make("notifications", base(300), base(900), { required: false, optionalUntilFirstBeat: true }),
  ];
}

export class WatchdogRegistry {
  private readonly entries = new Map<WatchdogSubsystem, Entry>();

  constructor(
    policies: readonly WatchdogPolicy[],
    private readonly clock: Clock = systemClock,
  ) {
    for (const policy of policies) {
      this.entries.set(policy.subsystem, {
        policy,
        lastHeartbeatAt: null,
        lastHeartbeatMillis: null,
        lastErrorAt: null,
        lastErrorDetail: null,
        consecutiveErrors: 0,
        degraded: false,
        degradedDetail: null,
      });
    }
  }

  subsystems(): WatchdogSubsystem[] {
    return [...this.entries.keys()];
  }

  private entry(subsystem: WatchdogSubsystem): Entry {
    const entry = this.entries.get(subsystem);
    if (!entry) throw new Error(`unregistered watchdog subsystem: ${subsystem}`);
    return entry;
  }

  /** Records a successful cycle for a subsystem. */
  heartbeat(subsystem: WatchdogSubsystem): void {
    const entry = this.entry(subsystem);
    entry.lastHeartbeatAt = this.clock.isoNow();
    entry.lastHeartbeatMillis = this.clock.now();
    entry.consecutiveErrors = 0;
    entry.degraded = false;
    entry.degradedDetail = null;
  }

  /** Records a failed cycle. Consecutive failures escalate the level. */
  fail(subsystem: WatchdogSubsystem, detail: string): void {
    const entry = this.entry(subsystem);
    entry.lastErrorAt = this.clock.isoNow();
    entry.lastErrorDetail = detail;
    entry.consecutiveErrors += 1;
  }

  /** Records a known-degraded but non-failing condition. */
  degrade(subsystem: WatchdogSubsystem, detail: string): void {
    const entry = this.entry(subsystem);
    entry.degraded = true;
    entry.degradedDetail = detail;
  }

  private grade(entry: Entry): WatchdogState {
    const now = this.clock.now();
    const policy = entry.policy;
    const age = entry.lastHeartbeatMillis === null ? null : now - entry.lastHeartbeatMillis;

    let level: WatchdogLevel = "healthy";
    let reasonCode: ReasonCode = "WDG_HEALTHY";
    let detail = "nominal";

    if (entry.consecutiveErrors >= (policy.criticalAfterErrors ?? 3)) {
      level = "critical";
      reasonCode = "WDG_CRITICAL";
      detail = entry.lastErrorDetail ?? `${entry.consecutiveErrors} consecutive failures`;
    } else if (entry.consecutiveErrors >= (policy.warnAfterErrors ?? 1)) {
      level = "warning";
      reasonCode = "WDG_WARNING";
      detail = entry.lastErrorDetail ?? `${entry.consecutiveErrors} consecutive failures`;
    }

    if (age === null) {
      if (!policy.optionalUntilFirstBeat && level !== "critical") {
        level = worstWatchdogLevel([level, "warning"]);
        reasonCode = level === "critical" ? "WDG_CRITICAL" : "WDG_SILENT";
        detail = "no heartbeat recorded yet";
      }
    } else if (age > policy.criticalAfterMillis) {
      level = "critical";
      reasonCode = "WDG_SILENT";
      detail = `silent for ${age}ms (budget ${policy.criticalAfterMillis}ms)`;
    } else if (age > policy.warnAfterMillis && level !== "critical") {
      level = "warning";
      reasonCode = "WDG_WARNING";
      detail = `silent for ${age}ms (budget ${policy.warnAfterMillis}ms)`;
    }

    if (entry.degraded && level === "healthy") {
      level = "warning";
      reasonCode = "WDG_WARNING";
      detail = entry.degradedDetail ?? "degraded";
    }

    return {
      subsystem: policy.subsystem,
      level,
      reasonCode: REASON_CODES[reasonCode].code,
      detail,
      lastHeartbeatAt: entry.lastHeartbeatAt,
      lastErrorAt: entry.lastErrorAt,
      ageMillis: age,
      consecutiveErrors: entry.consecutiveErrors,
      required: policy.required !== false,
      observedAt: this.clock.isoNow(),
    };
  }

  report(): WatchdogReport {
    const subsystems = [...this.entries.values()].map((entry) => this.grade(entry));
    const requiredLevel = worstWatchdogLevel(
      subsystems.filter((state) => state.required).map((state) => state.level),
    );
    const anyLevel = worstWatchdogLevel(subsystems.map((state) => state.level));
    const level: WatchdogLevel =
      requiredLevel === "healthy" && anyLevel !== "healthy" ? "warning" : requiredLevel;

    return { level, observedAt: this.clock.isoNow(), subsystems };
  }
}
