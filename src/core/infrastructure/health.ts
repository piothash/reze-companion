/**
 * ARC — health framework (P0/M0).
 *
 * Abstraction only. Components register a check; the aggregator reports
 * healthy / degraded / unavailable per dependency and for the runtime overall.
 * Consecutive-failure thresholds come from configuration, never hardcoded.
 */
import { type ArcConfig } from "../configuration/schema";
import { REASON_CODES, type ReasonCode } from "../contracts/reason-codes";
import { type Clock, systemClock } from "../shared/time";

export const HEALTH_STATUSES = ["healthy", "degraded", "unavailable"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

const SEVERITY: Record<HealthStatus, number> = { healthy: 0, degraded: 1, unavailable: 2 };

export interface HealthCheckResult {
  status: HealthStatus;
  reasonCode: ReasonCode;
  detail?: string;
  observedAt: string;
  latencyMillis: number;
}

export interface DependencyHealth extends HealthCheckResult {
  name: string;
  critical: boolean;
  consecutiveFailures: number;
}

export interface HealthReport {
  status: HealthStatus;
  reasonCode: string;
  observedAt: string;
  dependencies: DependencyHealth[];
}

export interface HealthCheckDefinition {
  name: string;
  /** Non-critical dependencies can only degrade the runtime, never fail it. */
  critical?: boolean;
  check: () => Promise<Omit<HealthCheckResult, "observedAt" | "latencyMillis">>;
}

export function worstStatus(statuses: readonly HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>(
    (worst, current) => (SEVERITY[current] > SEVERITY[worst] ? current : worst),
    "healthy",
  );
}

export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheckDefinition>();
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly config: HealthConfig,
    private readonly clock: Clock = systemClock,
  ) {}

  register(definition: HealthCheckDefinition): void {
    this.checks.set(definition.name, definition);
    this.failures.set(definition.name, 0);
  }

  names(): string[] {
    return [...this.checks.keys()];
  }

  private async runOne(definition: HealthCheckDefinition): Promise<DependencyHealth> {
    const started = this.clock.monotonic();
    let result: Omit<HealthCheckResult, "observedAt" | "latencyMillis">;

    try {
      result = await withTimeout(definition.check(), this.config.checkTimeoutMillis);
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      result = {
        status: "unavailable",
        reasonCode: timedOut ? "HLT_CHECK_TIMEOUT" : "INF_DEPENDENCY_UNREACHABLE",
        detail: error instanceof Error ? error.message : "unknown health check failure",
      };
    }

    const previous = this.failures.get(definition.name) ?? 0;
    const failures = result.status === "healthy" ? 0 : previous + 1;
    this.failures.set(definition.name, failures);

    let status = result.status;
    if (status !== "healthy") {
      status =
        failures >= this.config.unavailableAfterFailures
          ? "unavailable"
          : failures >= this.config.degradedAfterFailures
            ? "degraded"
            : "degraded";
    }

    return {
      name: definition.name,
      critical: definition.critical ?? true,
      status,
      reasonCode: result.reasonCode,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      observedAt: this.clock.isoNow(),
      latencyMillis: Math.max(0, this.clock.monotonic() - started),
      consecutiveFailures: failures,
    };
  }

  async report(): Promise<HealthReport> {
    const dependencies = await Promise.all([...this.checks.values()].map((c) => this.runOne(c)));

    const criticalStatus = worstStatus(dependencies.filter((d) => d.critical).map((d) => d.status));
    const anyStatus = worstStatus(dependencies.map((d) => d.status));
    const status: HealthStatus =
      criticalStatus === "healthy" && anyStatus !== "healthy" ? "degraded" : criticalStatus;

    const reasonCode: ReasonCode =
      status === "healthy" ? "HLT_HEALTHY" : status === "degraded" ? "HLT_DEGRADED" : "HLT_UNAVAILABLE";

    return {
      status,
      reasonCode: REASON_CODES[reasonCode].code,
      observedAt: this.clock.isoNow(),
      dependencies,
    };
  }
}

export class TimeoutError extends Error {
  constructor(millis: number) {
    super(`operation exceeded ${millis}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, millis: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(millis)), millis);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Freshness check shared by every future mirror surface. */
export function stalenessStatus(
  lastSeenIso: string | null,
  budgetMillis: number,
  nowMillis: number,
): { status: HealthStatus; reasonCode: ReasonCode; ageMillis: number | null } {
  if (!lastSeenIso) return { status: "unavailable", reasonCode: "HLT_DATA_STALE", ageMillis: null };
  const age = nowMillis - Date.parse(lastSeenIso);
  if (age <= budgetMillis) return { status: "healthy", reasonCode: "HLT_HEALTHY", ageMillis: age };
  if (age <= budgetMillis * 3)
    return { status: "degraded", reasonCode: "HLT_DATA_STALE", ageMillis: age };
  return { status: "unavailable", reasonCode: "HLT_DATA_STALE", ageMillis: age };
}
