/**
 * ARC — runtime composition root (P0/M0).
 *
 * Wires environment → configuration → logging → metrics → health → scheduler.
 * Fails fast: an invalid environment or configuration prevents startup rather
 * than degrading silently.
 */
import { bootstrapConfig, type EnvSource } from "./configuration/environment";
import { type ArcConfig } from "./configuration/schema";
import { HealthRegistry, type HealthReport } from "./infrastructure/health";
import {
  createLogger,
  JsonConsoleTransport,
  type Logger,
  type LogTransport,
} from "./infrastructure/logging";
import { createMetricsRegistry, type MetricsRegistry } from "./infrastructure/metrics";
import { Scheduler, type TimerProvider } from "./infrastructure/scheduler";
import { EventEnvelopeFactory } from "./contracts/event-envelope";
import { versionManifest } from "./contracts/versions";
import { systemClock, type Clock } from "./shared/time";

export interface ArcRuntime {
  config: ArcConfig;
  clock: Clock;
  logger: Logger;
  metrics: MetricsRegistry;
  health: HealthRegistry;
  scheduler: Scheduler;
  events: EventEnvelopeFactory;
  versions: ReturnType<typeof versionManifest>;
}

export interface RuntimeOptions {
  env: EnvSource;
  clock?: Clock;
  transport?: LogTransport;
  timers?: TimerProvider;
  configOverrides?: Record<string, unknown>;
  source?: string;
}

export function createRuntime(options: RuntimeOptions): ArcRuntime {
  const clock = options.clock ?? systemClock;
  const config = bootstrapConfig(options.env, options.configOverrides ?? {});
  const source = options.source ?? "runtime";

  const logger = createLogger({
    engine: source,
    level: config.logging.level,
    clock,
    transport: options.transport ?? new JsonConsoleTransport(),
    redactKeys: config.logging.redactKeys,
    baseFields: {
      environment: config.runtime.environment,
      network: config.runtime.network,
      instance: config.runtime.instanceLabel,
    },
  });

  const metrics = createMetricsRegistry(config.metrics.namespace, clock);
  const health = new HealthRegistry(config.health, clock);
  const scheduler = new Scheduler(config.scheduler, clock, logger, options.timers, metrics);
  const events = new EventEnvelopeFactory(clock, source);

  logger.info({
    reasonCode: "INF_STARTUP",
    fields: { configVersion: config.configVersion, ...versionManifest() },
  });

  return { config, clock, logger, metrics, health, scheduler, events, versions: versionManifest() };
}

/** Registers the foundation's own health checks (configuration + scheduler). */
export function registerFoundationHealthChecks(runtime: ArcRuntime): void {
  runtime.health.register({
    name: "configuration",
    critical: true,
    check: async () => ({
      status: "healthy",
      reasonCode: "CFG_LOADED",
      detail: `configVersion=${runtime.config.configVersion}`,
    }),
  });

  runtime.health.register({
    name: "scheduler",
    critical: false,
    check: async () => {
      const failed = runtime.scheduler.statuses().filter((task) => task.state === "failed");
      return failed.length === 0
        ? { status: "healthy", reasonCode: "HLT_HEALTHY" }
        : {
            status: "degraded",
            reasonCode: "SCH_TASK_FAILED",
            detail: failed.map((task) => task.name).join(","),
          };
    },
  });
}

export async function runtimeHealth(runtime: ArcRuntime): Promise<HealthReport> {
  return runtime.health.report();
}
