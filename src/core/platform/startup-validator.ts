/**
 * ARC — startup validator (M6.5).
 *
 * The single gate in front of the runtime. Eleven checks run in a fixed order;
 * any failure produces `SYSTEM_START_BLOCKED` and the bot must not start.
 * Probes for anything external (database, schema version, scheduler) are
 * injected, which keeps the validator pure and unit-testable.
 */
import { bootstrapConfig } from "../configuration/environment";
import {
  validateEnvironment,
  type EnvSource,
  type EnvVarSpec,
} from "../configuration/env-validator";
import { type ArcConfig } from "../configuration/schema";
import { REASON_CODES, type ReasonCode } from "../contracts/reason-codes";
import { scanFiles, type SecretFinding } from "../infrastructure/secret-scanner";
import { type Clock, systemClock } from "../shared/time";
import { validateBootConfiguration, type BootValidationResult } from "./boot-validator";

export const STARTUP_GATES = [
  "environment-variables",
  "configuration-validity",
  "database-connectivity",
  "database-schema-version",
  "feed-configuration",
  "twap-configuration",
  "execution-profile",
  "window-definitions",
  "risk-profile",
  "trade-quota",
  "feature-flags",
  "scheduler-initialization",
  "network-environment",
  "secret-material",
] as const;

export type StartupGate = (typeof STARTUP_GATES)[number];

export type GateStatus = "passed" | "warning" | "failed" | "skipped";

export interface GateResult {
  readonly gate: StartupGate;
  readonly status: GateStatus;
  readonly reasonCode: string;
  readonly detail: string;
  readonly issues: readonly string[];
  readonly durationMillis: number;
}

export interface StartupReport {
  readonly allowed: boolean;
  readonly reasonCode: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly environment: string;
  readonly network: string;
  readonly gates: readonly GateResult[];
  readonly failedGates: readonly StartupGate[];
  readonly warnings: readonly string[];
}

export interface SchemaVersionProbeResult {
  readonly actual: string | null;
  readonly expected: string;
}

export interface StartupProbes {
  /** Resolves true when the control-plane database answered a trivial query. */
  databaseConnectivity?: () => Promise<boolean>;
  /** Returns the applied schema version, compared against `expected`. */
  schemaVersion?: () => Promise<SchemaVersionProbeResult>;
  /** Returns the resolved feature flag map. */
  featureFlags?: () => Promise<Record<string, boolean>>;
  /** Confirms the scheduler was constructed and has at least one task. */
  schedulerReady?: () => Promise<{ ready: boolean; taskCount: number }>;
  /** Files to run the secret scanner across (already read by the caller). */
  sourceFiles?: () => Promise<readonly { path: string; content: string }[]>;
}

export interface StartupOptions {
  env: EnvSource;
  clock?: Clock;
  probes?: StartupProbes;
  envSpecs?: readonly EnvVarSpec[];
  /** Flags that must exist for the runtime to be considered configured. */
  requiredFeatureFlags?: readonly string[];
  /** Mainnet requires an explicit, deliberate opt-in. */
  allowMainnet?: boolean;
}

export class SystemStartBlockedError extends Error {
  readonly reasonCode = "SYSTEM_START_BLOCKED";
  constructor(readonly report: StartupReport) {
    super(
      `SYSTEM_START_BLOCKED — failed gates: ${report.failedGates.join(", ") || "unknown"}`,
    );
    this.name = "SystemStartBlockedError";
  }
}

function gate(
  name: StartupGate,
  status: GateStatus,
  reasonCode: ReasonCode,
  detail: string,
  issues: readonly string[],
  durationMillis: number,
): GateResult {
  return {
    gate: name,
    status,
    reasonCode: REASON_CODES[reasonCode].code,
    detail,
    issues,
    durationMillis,
  };
}

function fromIssues(
  name: StartupGate,
  issues: readonly string[],
  warnings: readonly string[],
  okDetail: string,
  duration: number,
): GateResult {
  if (issues.length > 0) {
    return gate(name, "failed", "SYS_CHECK_FAILED", `${issues.length} issue(s)`, issues, duration);
  }
  if (warnings.length > 0) {
    return gate(name, "warning", "SYS_CHECK_WARNING", okDetail, warnings, duration);
  }
  return gate(name, "passed", "SYS_CHECK_PASSED", okDetail, [], duration);
}

function describe(issue: { path: string; message: string } | { key: string; message: string }) {
  const label = "path" in issue ? issue.path : issue.key;
  return `${label}: ${issue.message}`;
}

/**
 * Runs the full startup sequence. Never throws — inspect `allowed`, or call
 * {@link assertStartupAllowed} to fail fast.
 */
export async function validateStartup(options: StartupOptions): Promise<StartupReport> {
  const clock = options.clock ?? systemClock;
  const startedAt = clock.isoNow();
  const probes = options.probes ?? {};
  const gates: GateResult[] = [];
  const warnings: string[] = [];

  const timed = async <T>(run: () => Promise<T> | T): Promise<[T, number]> => {
    const started = clock.monotonic();
    const value = await run();
    return [value, Math.max(0, clock.monotonic() - started)];
  };

  // 1 — environment variables ------------------------------------------------
  const [envReport, envDuration] = await timed(() =>
    validateEnvironment(options.env, options.envSpecs),
  );
  gates.push(
    fromIssues(
      "environment-variables",
      envReport.issues.map(describe),
      envReport.warnings.map(describe),
      `${envReport.checkedKeys.length} variables validated`,
      envDuration,
    ),
  );

  // 2 — configuration validity ----------------------------------------------
  const configHolder: { value: ArcConfig | null } = { value: null };
  const [configGate, configDuration] = await timed(() => {
    try {
      configHolder.value = bootstrapConfig(options.env, {});
      return [] as string[];
    } catch (error) {
      return [error instanceof Error ? error.message : String(error)];
    }
  });
  gates.push(
    fromIssues(
      "configuration-validity",
      configGate,
      [],
      configHolder.value ? `configVersion=${configHolder.value.configVersion}` : "configuration rejected",
      configDuration,
    ),
  );

  // 3 — database connectivity ------------------------------------------------
  if (probes.databaseConnectivity) {
    const [result, duration] = await timed(async () => {
      try {
        return (await probes.databaseConnectivity!()) ? [] : ["control-plane database unreachable"];
      } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
      }
    });
    gates.push(fromIssues("database-connectivity", result, [], "database reachable", duration));
  } else {
    gates.push(
      gate("database-connectivity", "skipped", "SYS_CHECK_SKIPPED", "no probe supplied", [], 0),
    );
  }

  // 4 — database schema version ---------------------------------------------
  if (probes.schemaVersion) {
    const [result, duration] = await timed(async () => {
      try {
        const { actual, expected } = await probes.schemaVersion!();
        if (actual === null) return ["schema version could not be read"];
        return actual === expected ? [] : [`schema version ${actual} != expected ${expected}`];
      } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
      }
    });
    gates.push(
      fromIssues("database-schema-version", result, [], "schema version matches", duration),
    );
  } else {
    gates.push(
      gate("database-schema-version", "skipped", "SYS_CHECK_SKIPPED", "no probe supplied", [], 0),
    );
  }

  // 5..10 — business configuration ------------------------------------------
  const [boot, bootDuration] = await timed(() => validateBootConfiguration(options.env));
  const bootIssues = (prefix: string): string[] =>
    boot.issues.filter((issue) => issue.path.startsWith(prefix)).map(describe);
  const bootWarnings = (prefix: string): string[] =>
    boot.warnings.filter((issue) => issue.path.startsWith(prefix)).map(describe);

  gates.push(
    fromIssues(
      "feed-configuration",
      [...bootIssues("feed"), ...bootIssues("marketConfiguration"), ...bootIssues("discovery")],
      bootWarnings("feed"),
      boot.marketConfig ? `feed=${boot.marketConfig.feed.feedId}` : "feed configuration rejected",
      bootDuration,
    ),
  );
  gates.push(
    fromIssues(
      "twap-configuration",
      [...bootIssues("twap"), ...bootIssues("ptb")],
      bootWarnings("twap"),
      boot.marketConfig ? `twapWindowSeconds=${boot.marketConfig.twap.windowSeconds}` : "rejected",
      0,
    ),
  );
  gates.push(
    fromIssues(
      "execution-profile",
      [
        ...bootIssues("executionProfile"),
        ...bootIssues("positionSize"),
        ...bootIssues("retryCount"),
        ...bootIssues("timeoutMillis"),
        ...bootIssues("repricing"),
        ...bootIssues("tickSize"),
        ...bootIssues("precision"),
        ...bootIssues("maxSpread"),
        ...bootIssues("minLiquidity"),
      ],
      [...bootWarnings("positionSize")],
      boot.executionProfile
        ? `${boot.executionProfile.executionProfileId} (${boot.executionProfile.executionMode})`
        : "execution profile rejected",
      0,
    ),
  );
  gates.push(
    fromIssues(
      "window-definitions",
      bootIssues("windows"),
      bootWarnings("windows"),
      boot.executionProfile ? `${boot.executionProfile.windows.length} windows declared` : "rejected",
      0,
    ),
  );
  gates.push(
    fromIssues(
      "risk-profile",
      [...bootIssues("risk"), ...bootIssues("execution.")],
      bootWarnings("risk"),
      boot.tradeConfig ? `maxExposure=${boot.tradeConfig.risk.maxExposure}` : "risk profile rejected",
      0,
    ),
  );
  gates.push(
    fromIssues(
      "trade-quota",
      bootIssues("maxTrades"),
      bootWarnings("maxTrades"),
      boot.executionProfile
        ? `quota=${boot.executionProfile.executionMode === "SINGLE_TRADE" ? 1 : boot.executionProfile.maxTrades}`
        : "quota unresolved",
      0,
    ),
  );

  // Any boot issue not attributed above must still block startup.
  const attributed = new Set(
    gates.flatMap((entry) => entry.issues.map((issue) => issue)),
  );
  const unattributed = boot.issues.map(describe).filter((issue) => !attributed.has(issue));
  if (unattributed.length > 0) {
    gates.push(
      gate(
        "execution-profile",
        "failed",
        "SYS_BOOT_CONFIG_INVALID",
        "unattributed configuration issues",
        unattributed,
        0,
      ),
    );
  }

  // 11 — feature flags -------------------------------------------------------
  if (probes.featureFlags) {
    const [result, duration] = await timed(async () => {
      try {
        const flags = await probes.featureFlags!();
        const missing = (options.requiredFeatureFlags ?? []).filter(
          (key) => !(key in flags),
        );
        return missing.map((key) => `required feature flag missing: ${key}`);
      } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
      }
    });
    gates.push(fromIssues("feature-flags", result, [], "feature flags resolved", duration));
  } else {
    const declared = Object.keys(configHolder.value?.featureFlags ?? {});
    const missing = (options.requiredFeatureFlags ?? []).filter(
      (key) => !declared.includes(key),
    );
    gates.push(
      fromIssues(
        "feature-flags",
        missing.map((key) => `required feature flag missing: ${key}`),
        [],
        `${declared.length} flags declared`,
        0,
      ),
    );
  }

  // 12 — scheduler initialization -------------------------------------------
  if (probes.schedulerReady) {
    const [result, duration] = await timed(async () => {
      try {
        const status = await probes.schedulerReady!();
        if (!status.ready) return ["scheduler did not initialize"];
        return status.taskCount > 0 ? [] : ["scheduler has no registered tasks"];
      } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
      }
    });
    gates.push(fromIssues("scheduler-initialization", result, [], "scheduler ready", duration));
  } else {
    const issues = configHolder.value === null ? ["scheduler cannot initialize without configuration"] : [];
    gates.push(
      fromIssues(
        "scheduler-initialization",
        issues,
        [],
        configHolder.value
          ? `tickIntervalMillis=${configHolder.value.scheduler.tickIntervalMillis}`
          : "n/a",
        0,
      ),
    );
  }

  // 13 — network / environment coherence ------------------------------------
  const network = configHolder.value?.runtime.network ?? options.env["ARC_NETWORK"] ?? "unknown";
  const environment =
    configHolder.value?.runtime.environment ?? options.env["ARC_ENVIRONMENT"] ?? "unknown";
  const networkIssues: string[] = [];
  const networkWarnings: string[] = [];
  if (network !== "testnet" && network !== "mainnet") {
    networkIssues.push(`unknown network "${network}" — must be testnet or mainnet`);
  }
  if (network === "mainnet" && options.allowMainnet !== true) {
    networkIssues.push("mainnet requires an explicit allowMainnet opt-in");
  }
  if (network === "mainnet" && environment !== "production") {
    networkIssues.push(`mainnet may only run in the production environment (got "${environment}")`);
  }
  if (network === "testnet" && environment === "production") {
    networkWarnings.push("production environment is pointed at testnet");
  }
  gates.push(
    fromIssues(
      "network-environment",
      networkIssues,
      networkWarnings,
      `${environment}/${network}`,
      0,
    ),
  );

  // 14 — secret material -----------------------------------------------------
  if (probes.sourceFiles) {
    const [result, duration] = await timed(async () => {
      try {
        const files = await probes.sourceFiles!();
        const scan = scanFiles(files);
        return scan.findings.map(
          (finding: SecretFinding) =>
            `${finding.path}:${finding.line} ${finding.ruleId} (${finding.masked})`,
        );
      } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
      }
    });
    gates.push(fromIssues("secret-material", result, [], "no secret material detected", duration));
  } else {
    gates.push(
      gate("secret-material", "skipped", "SYS_CHECK_SKIPPED", "no source probe supplied", [], 0),
    );
  }

  for (const entry of gates) {
    if (entry.status === "warning") warnings.push(...entry.issues);
  }

  const failedGates = gates.filter((entry) => entry.status === "failed").map((entry) => entry.gate);
  const allowed = failedGates.length === 0;

  return {
    allowed,
    reasonCode: allowed ? REASON_CODES.SYS_START_OK.code : "SYSTEM_START_BLOCKED",
    startedAt,
    completedAt: clock.isoNow(),
    environment: String(environment),
    network: String(network),
    gates,
    failedGates: [...new Set(failedGates)],
    warnings,
  };
}

/** Fail-fast wrapper — the bot must not start when this throws. */
export async function assertStartupAllowed(options: StartupOptions): Promise<StartupReport> {
  const report = await validateStartup(options);
  if (!report.allowed) throw new SystemStartBlockedError(report);
  return report;
}
