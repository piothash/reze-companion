/**
 * ARC — shared health surface (M6.5).
 *
 * Builds the payloads served by the four public health endpoints. Server-only:
 * it reads `process.env` and probes the control plane. No trading data, no
 * credentials and no user data ever leave this module.
 */
import { createRuntime, registerFoundationHealthChecks, type ArcRuntime } from "@/core/runtime";
import { versionManifest } from "@/core/contracts/versions";
import {
  defaultWatchdogPolicies,
  WatchdogRegistry,
  type WatchdogReport,
} from "@/core/infrastructure/watchdogs";
import { validateStartup, type StartupReport } from "@/core/platform/startup-validator";
import { type HealthReport } from "@/core/infrastructure/health";

export const EXPECTED_SCHEMA_VERSION = "2026.02.0";

export interface SurfaceEnv {
  [key: string]: string | undefined;
}

function env(): SurfaceEnv {
  return process.env as SurfaceEnv;
}

/** Trivial connectivity probe against the control-plane Data API. */
async function probeDatabase(source: SurfaceEnv): Promise<boolean> {
  const url = source["SUPABASE_URL"];
  const key = source["SUPABASE_PUBLISHABLE_KEY"] ?? source["SUPABASE_ANON_KEY"];
  if (!url || !key) return false;
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
    headers: { apikey: key },
  });
  return response.ok || response.status === 404;
}

export interface LivePayload {
  status: "live";
  reasonCode: string;
  observedAt: string;
  versions: ReturnType<typeof versionManifest>;
}

/** Liveness: the process answers. Never touches a dependency. */
export function livePayload(): LivePayload {
  return {
    status: "live",
    reasonCode: "HLT_HEALTHY",
    observedAt: new Date().toISOString(),
    versions: versionManifest(),
  };
}

function watchdogSnapshot(runtime: ArcRuntime): WatchdogReport {
  const registry = new WatchdogRegistry(
    defaultWatchdogPolicies({
      tickIntervalMillis: runtime.config.scheduler.tickIntervalMillis,
      feedStaleAfterMillis: runtime.config.feeds.staleAfterMillis,
    }),
    runtime.clock,
  );
  // The companion is a control plane: engine subsystems report through the
  // mirrored engine plane, not from inside this process. Absent a mirror the
  // watchdogs correctly read as "no heartbeat".
  registry.heartbeat("api");
  return registry.report();
}

export interface StartupPayload extends StartupReport {
  reasonCodeDetail: string;
}

/** Startup: the full gate report. 503 + SYSTEM_START_BLOCKED when any gate fails. */
export async function startupPayload(): Promise<StartupPayload> {
  const source = env();
  const report = await validateStartup({
    env: source,
    allowMainnet: source["ARC_ALLOW_MAINNET"] === "true",
    probes: {
      databaseConnectivity: () => probeDatabase(source),
      schemaVersion: async () => ({
        actual: source["ARC_DB_SCHEMA_VERSION"] ?? null,
        expected: EXPECTED_SCHEMA_VERSION,
      }),
    },
  });
  return {
    ...report,
    reasonCodeDetail: report.allowed
      ? "all startup gates passed"
      : `blocked by: ${report.failedGates.join(", ")}`,
  };
}

export interface ReadyPayload {
  status: "ready" | "not-ready";
  reasonCode: string;
  observedAt: string;
  health: HealthReport;
  watchdogs: WatchdogReport;
  blockedGates: readonly string[];
}

/** Readiness: dependencies answer, startup gates pass, no critical watchdog. */
export async function readyPayload(): Promise<ReadyPayload> {
  const runtime = createRuntime({ env: env(), source: "health.ready" });
  registerFoundationHealthChecks(runtime);
  const [health, startup] = await Promise.all([runtime.health.report(), startupPayload()]);
  const watchdogs = watchdogSnapshot(runtime);

  const ready =
    health.status !== "unavailable" && startup.allowed && watchdogs.level !== "critical";

  return {
    status: ready ? "ready" : "not-ready",
    reasonCode: ready
      ? "HLT_HEALTHY"
      : startup.allowed
        ? "HLT_UNAVAILABLE"
        : "SYSTEM_START_BLOCKED",
    observedAt: runtime.clock.isoNow(),
    health,
    watchdogs,
    blockedGates: startup.failedGates,
  };
}

export interface DetailsPayload {
  status: string;
  observedAt: string;
  environment: string;
  network: string;
  versions: ReturnType<typeof versionManifest>;
  health: HealthReport;
  watchdogs: WatchdogReport;
  startup: {
    allowed: boolean;
    reasonCode: string;
    gates: StartupReport["gates"];
    warnings: readonly string[];
  };
}

/** Details: every engine reports independently, in one document. */
export async function detailsPayload(): Promise<DetailsPayload> {
  const runtime = createRuntime({ env: env(), source: "health.details" });
  registerFoundationHealthChecks(runtime);
  const [health, startup] = await Promise.all([runtime.health.report(), startupPayload()]);
  const watchdogs = watchdogSnapshot(runtime);

  return {
    status: health.status,
    observedAt: runtime.clock.isoNow(),
    environment: runtime.config.runtime.environment,
    network: runtime.config.runtime.network,
    versions: runtime.versions,
    health,
    watchdogs,
    startup: {
      allowed: startup.allowed,
      reasonCode: startup.reasonCode,
      gates: startup.gates,
      warnings: startup.warnings,
    },
  };
}
