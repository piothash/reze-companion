/**
 * ARC — environment validator (M6.5).
 *
 * Every environment variable ARC reads is declared here with a kind, a range
 * and a requirement. Nothing is coerced silently: a variable that is absent is
 * either an explicit, documented default (reported as a warning) or a startup
 * failure. Secret-kind variables are validated by shape only — their values are
 * never returned, logged or echoed.
 */
import { NETWORKS, RUNTIME_ENVIRONMENTS, LOG_LEVELS } from "./schema";
import { type ReasonCode } from "../contracts/reason-codes";

export type EnvSource = Record<string, string | undefined>;

export const ENV_KINDS = [
  "string",
  "int",
  "number",
  "boolean",
  "enum",
  "url",
  "csv",
  "iso-datetime",
  "secret",
] as const;
export type EnvKind = (typeof ENV_KINDS)[number];

export interface EnvVarSpec {
  readonly key: string;
  readonly kind: EnvKind;
  readonly description: string;
  /** Required variables block startup when absent. */
  readonly required?: boolean;
  /** Documented default. Absence is reported as a warning, never applied silently. */
  readonly defaultValue?: string;
  readonly enumValues?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly minLength?: number;
  readonly pattern?: RegExp;
  /** Marks a variable required only when the network is mainnet. */
  readonly requiredOnMainnet?: boolean;
}

export interface EnvIssue {
  readonly key: string;
  readonly message: string;
  readonly reasonCode: ReasonCode;
}

export interface EnvValidationReport {
  readonly valid: boolean;
  readonly issues: readonly EnvIssue[];
  readonly warnings: readonly EnvIssue[];
  /** Parsed values. Secret-kind keys are represented as `"[present]"`. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly checkedKeys: readonly string[];
}

const BOOLEANS = new Set(["true", "false", "1", "0"]);

/**
 * Declarative catalog. Business meaning stays in the domain schemas — this is
 * purely the transport contract between the host and ARC.
 */
export const ARC_ENV_SPECS: readonly EnvVarSpec[] = [
  {
    key: "ARC_ENVIRONMENT",
    kind: "enum",
    enumValues: RUNTIME_ENVIRONMENTS,
    required: true,
    description: "Runtime environment",
  },
  {
    key: "ARC_NETWORK",
    kind: "enum",
    enumValues: NETWORKS,
    required: true,
    description: "Target network (testnet or mainnet)",
  },
  {
    key: "ARC_INSTANCE_LABEL",
    kind: "string",
    minLength: 1,
    defaultValue: "arc-companion",
    description: "Instance label surfaced in logs and health output",
  },
  {
    key: "ARC_ENGINE_BASE_URL",
    kind: "url",
    requiredOnMainnet: true,
    description: "Base URL of the VPS trading authority",
  },
  {
    key: "ARC_ENGINE_TIMEOUT_MS",
    kind: "int",
    min: 100,
    max: 120_000,
    defaultValue: "10000",
    description: "Engine request timeout",
  },
  {
    key: "ARC_ENGINE_FRESHNESS_MS",
    kind: "int",
    min: 1_000,
    max: 600_000,
    defaultValue: "30000",
    description: "Maximum acceptable age of mirrored engine data",
  },
  {
    key: "ARC_TWAP_PROVIDER",
    kind: "string",
    minLength: 1,
    required: true,
    description: "Authoritative TWAP provider identifier",
  },
  { key: "ARC_TWAP_PROVIDER_URL", kind: "url", description: "TWAP provider endpoint" },
  {
    key: "ARC_TWAP_WINDOW_SECONDS",
    kind: "int",
    min: 1,
    max: 86_400,
    required: true,
    description: "TWAP sliding window length",
  },
  { key: "ARC_FEED_IDS", kind: "csv", required: true, description: "Provider feed identifiers" },
  { key: "ARC_RPC_URLS", kind: "csv", description: "RPC endpoints" },
  { key: "ARC_API_URLS", kind: "csv", description: "API endpoints" },
  {
    key: "ARC_FEED_STALE_AFTER_MS",
    kind: "int",
    min: 500,
    max: 600_000,
    defaultValue: "15000",
    description: "Feed staleness budget",
  },
  {
    key: "ARC_SCHEDULER_TICK_MS",
    kind: "int",
    min: 50,
    max: 60_000,
    defaultValue: "1000",
    description: "Scheduler tick interval",
  },
  {
    key: "ARC_SCHEDULER_MAX_DRIFT_MS",
    kind: "int",
    min: 10,
    max: 60_000,
    defaultValue: "250",
    description: "Tolerated scheduler drift",
  },
  {
    key: "ARC_CLOCK_SKEW_TOLERANCE_MS",
    kind: "int",
    min: 10,
    max: 300_000,
    defaultValue: "2000",
    description: "Tolerated clock skew",
  },
  {
    key: "ARC_LOG_LEVEL",
    kind: "enum",
    enumValues: LOG_LEVELS,
    defaultValue: "info",
    description: "Log level",
  },
  {
    key: "ARC_LOG_FORMAT",
    kind: "enum",
    enumValues: ["json", "pretty"],
    defaultValue: "json",
    description: "Log format — json is mandatory in production",
  },
  { key: "ARC_METRICS_ENABLED", kind: "boolean", defaultValue: "true", description: "Metrics" },
  {
    key: "ARC_METRICS_NAMESPACE",
    kind: "string",
    minLength: 1,
    defaultValue: "arc",
    description: "Metric namespace",
  },
  {
    key: "ARC_HEALTH_TIMEOUT_MS",
    kind: "int",
    min: 100,
    max: 60_000,
    defaultValue: "3000",
    description: "Health probe timeout",
  },
  {
    key: "ARC_RETRY_MAX_ATTEMPTS",
    kind: "int",
    min: 1,
    max: 20,
    defaultValue: "3",
    description: "Retry attempts",
  },
  {
    key: "ARC_RETRY_INITIAL_DELAY_MS",
    kind: "int",
    min: 1,
    max: 60_000,
    defaultValue: "200",
    description: "Initial retry delay",
  },
  {
    key: "ARC_RETRY_MAX_DELAY_MS",
    kind: "int",
    min: 1,
    max: 300_000,
    defaultValue: "5000",
    description: "Maximum retry delay",
  },
  { key: "ARC_REPLAY_ENABLED", kind: "boolean", defaultValue: "false", description: "Replay mode" },
  { key: "ARC_REPLAY_CLOCK_ORIGIN", kind: "iso-datetime", description: "Deterministic clock origin" },
  {
    key: "EXECUTION_PROFILE_ID",
    kind: "string",
    minLength: 1,
    required: true,
    description: "Active execution profile identifier",
  },
  {
    key: "EXECUTION_WINDOWS",
    kind: "string",
    minLength: 2,
    required: true,
    description: "Dynamic window definitions — offsets are never hardcoded",
  },
  {
    key: "EXECUTION_MODE",
    kind: "enum",
    enumValues: ["SINGLE_TRADE", "MULTI_TRADE"],
    required: true,
    description: "Single or multi trade execution mode",
  },
  {
    key: "SUPABASE_URL",
    kind: "url",
    required: true,
    description: "Control-plane database URL",
  },
  {
    key: "SUPABASE_ANON_KEY",
    kind: "secret",
    minLength: 20,
    required: true,
    description: "Publishable control-plane key",
  },
];

function issue(key: string, message: string, reasonCode: ReasonCode): EnvIssue {
  return { key, message, reasonCode };
}

function parseOne(
  spec: EnvVarSpec,
  raw: string,
): { value: unknown } | { error: string } {
  switch (spec.kind) {
    case "secret": {
      if (raw.length < (spec.minLength ?? 8)) return { error: "secret is implausibly short" };
      if (/\s/.test(raw)) return { error: "secret contains whitespace" };
      return { value: "[present]" };
    }
    case "string": {
      if (raw.length < (spec.minLength ?? 1)) return { error: "value is empty or too short" };
      if (spec.pattern && !spec.pattern.test(raw)) return { error: "value does not match pattern" };
      return { value: raw };
    }
    case "enum": {
      const allowed = spec.enumValues ?? [];
      if (!allowed.includes(raw)) return { error: `must be one of ${allowed.join(" | ")}` };
      return { value: raw };
    }
    case "int": {
      if (!/^-?\d+$/.test(raw)) return { error: "must be an integer" };
      const parsed = Number(raw);
      if (spec.min !== undefined && parsed < spec.min) return { error: `must be >= ${spec.min}` };
      if (spec.max !== undefined && parsed > spec.max) return { error: `must be <= ${spec.max}` };
      return { value: parsed };
    }
    case "number": {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return { error: "must be a finite number" };
      if (spec.min !== undefined && parsed < spec.min) return { error: `must be >= ${spec.min}` };
      if (spec.max !== undefined && parsed > spec.max) return { error: `must be <= ${spec.max}` };
      return { value: parsed };
    }
    case "boolean": {
      if (!BOOLEANS.has(raw)) return { error: "must be true | false | 1 | 0" };
      return { value: raw === "true" || raw === "1" };
    }
    case "url": {
      try {
        const url = new URL(raw);
        if (!/^https?:$/.test(url.protocol)) return { error: "must be an http(s) URL" };
        return { value: url.toString() };
      } catch {
        return { error: "must be a valid absolute URL" };
      }
    }
    case "csv": {
      const parts = raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) return { error: "must contain at least one entry" };
      return { value: parts };
    }
    case "iso-datetime": {
      if (Number.isNaN(Date.parse(raw))) return { error: "must be an ISO-8601 timestamp" };
      return { value: raw };
    }
    default:
      return { error: "unknown kind" };
  }
}

/** Validates an environment source against the declared catalog. */
export function validateEnvironment(
  source: EnvSource,
  specs: readonly EnvVarSpec[] = ARC_ENV_SPECS,
): EnvValidationReport {
  const issues: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];
  const values: Record<string, unknown> = {};
  const network = source["ARC_NETWORK"];

  for (const spec of specs) {
    const raw = source[spec.key];
    const present = raw !== undefined && raw.trim() !== "";
    const required = spec.required === true || (spec.requiredOnMainnet === true && network === "mainnet");

    if (!present) {
      if (required) {
        issues.push(issue(spec.key, `required — ${spec.description}`, "SYS_ENV_MISSING"));
      } else if (spec.defaultValue !== undefined) {
        warnings.push(
          issue(
            spec.key,
            `absent — documented default "${spec.defaultValue}" applied`,
            "SYS_ENV_SILENT_DEFAULT",
          ),
        );
        const parsed = parseOne(spec, spec.defaultValue);
        if ("value" in parsed) values[spec.key] = parsed.value;
      }
      continue;
    }

    const parsed = parseOne(spec, raw.trim());
    if ("error" in parsed) {
      issues.push(issue(spec.key, parsed.error, "SYS_ENV_INVALID"));
      continue;
    }
    values[spec.key] = parsed.value;
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    values,
    checkedKeys: specs.map((spec) => spec.key),
  };
}

/** Convenience predicate used by the startup validator. */
export function isMainnet(source: EnvSource): boolean {
  return source["ARC_NETWORK"] === "mainnet";
}
