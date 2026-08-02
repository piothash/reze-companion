/**
 * ARC — Execution Profile configuration (M2).
 *
 * Configuration-first and fully dynamic: window offsets are never hardcoded.
 * Changing `EXECUTION_WINDOWS` from `15m,10m,7m,5m,3m` to `20m,12m,8m,4m,2m`
 * requires no code change. Global values are inherited by every window;
 * per-window overrides are resolved immediately and then frozen.
 */
import { z } from "zod";

import { UNIT_MILLIS, WINDOW_OFFSET_UNITS, type WindowOffsetUnit } from "./types";
import { digest128, Ids } from "../shared/ids";

export const EXECUTION_PROFILE_VERSION = "1.0.0";
export const BUFFER_PROFILE_VERSION = "1.0.0";
export const RISK_PROFILE_VERSION = "1.0.0";

export const EXECUTION_MODES = ["SINGLE_TRADE", "MULTI_TRADE"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const TRIGGER_MODES = ["MARKET_STATE_UPDATE", "SCHEDULED_TICK"] as const;
export const LIMIT_MODES = ["EFFECTIVE_TWAP", "PTB_ANCHORED", "MID"] as const;
export const TICK_POLICIES = ["ROUND_NEAREST", "ROUND_DOWN", "ROUND_UP"] as const;
export const BUFFER_MODES = ["ABSOLUTE", "PERCENT"] as const;

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

/** Declarative window definition. Priority is derived, never configured. */
export const windowDefinitionInputSchema = z.object({
  offset: z.number().finite().positive(),
  unit: z.enum(WINDOW_OFFSET_UNITS).default("s"),
  enabled: z.boolean().default(true),
  twapBuffer: z.number().finite().nonnegative().default(0),
  positionSizeOverride: z.number().finite().positive().nullable().default(null),
  retryCountOverride: nonNegativeInt.nullable().default(null),
  /** Optional per-window order timeout override; inherits globally when null. */
  timeoutMillisOverride: positiveInt.nullable().default(null),
  /** Optional per-window maximum spread override; inherits globally when null. */
  maxSpreadOverride: z.number().finite().nonnegative().nullable().default(null),
});

export type WindowDefinitionInput = z.input<typeof windowDefinitionInputSchema>;

/**
 * Seed used by the operator console when no profile exists yet. It is a
 * starting point only — every value stays fully editable, and the engine never
 * reads this constant. Offsets are seconds before market resolution and
 * buffers are percentage fractions (0.002 = 0.20%).
 */
export const DEFAULT_PROFILE_SEED = {
  bufferMode: "PERCENT" as const,
  windows: [
    { offset: 15, unit: "s" as const, twapBuffer: 0.002 },
    { offset: 10, unit: "s" as const, twapBuffer: 0.0015 },
    { offset: 7, unit: "s" as const, twapBuffer: 0.0012 },
    { offset: 5, unit: "s" as const, twapBuffer: 0.0008 },
    { offset: 3, unit: "s" as const, twapBuffer: 0.0005 },
  ],
} satisfies { bufferMode: "PERCENT"; windows: WindowDefinitionInput[] };

export const executionProfileSchema = z.object({
  executionProfileId: z.string().min(1).default("default"),
  executionProfileVersion: z.string().min(1).default(EXECUTION_PROFILE_VERSION),
  bufferProfileVersion: z.string().min(1).default(BUFFER_PROFILE_VERSION),
  riskProfileVersion: z.string().min(1).default(RISK_PROFILE_VERSION),

  /** SINGLE_TRADE (default) allows exactly one intent per market instance. */
  executionMode: z.enum(EXECUTION_MODES).default("SINGLE_TRADE"),
  /** Trade quota for MULTI_TRADE. Ignored (forced to 1) for SINGLE_TRADE. */
  maxTrades: positiveInt.default(1),

  // Global configuration inherited by every window ---------------------------
  triggerMode: z.enum(TRIGGER_MODES).default("MARKET_STATE_UPDATE"),
  limitMode: z.enum(LIMIT_MODES).default("EFFECTIVE_TWAP"),
  compounding: z.boolean().default(false),
  positionSize: z.number().finite().positive().default(1),
  retryCount: nonNegativeInt.default(0),
  minLiquidity: z.number().finite().nonnegative().default(0),
  maxSpread: z.number().finite().nonnegative().default(1),
  repricingEnabled: z.boolean().default(false),
  repricingIntervalMillis: positiveInt.default(1_000),
  repricingMaxAttempts: nonNegativeInt.default(0),
  timeoutMillis: positiveInt.default(10_000),
  tickPolicy: z.enum(TICK_POLICIES).default("ROUND_NEAREST"),
  tickSize: z.number().finite().positive().default(0.01),
  bufferMode: z.enum(BUFFER_MODES).default("ABSOLUTE"),
  /** How long a window stays ACTIVE before it expires unfilled. */
  windowActiveMillis: positiveInt.default(30_000),
  precision: nonNegativeInt.max(12).default(2),

  windows: z.array(windowDefinitionInputSchema).min(1),
});

export type ExecutionProfile = z.infer<typeof executionProfileSchema>;
export type ExecutionProfileInput = z.input<typeof executionProfileSchema>;

export class ExecutionProfileError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(
      `ARC execution profile invalid — ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
    this.name = "ExecutionProfileError";
  }
}

export function parseExecutionProfileOrThrow(candidate: unknown): ExecutionProfile {
  const parsed = executionProfileSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ExecutionProfileError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    );
  }
  const profile = parsed.data;
  const seen = new Set<number>();
  for (const window of profile.windows) {
    const millis = offsetToMillis(window.offset, window.unit);
    if (seen.has(millis)) {
      throw new ExecutionProfileError([
        { path: "windows", message: `duplicate window offset ${window.offset}${window.unit}` },
      ]);
    }
    seen.add(millis);
  }
  return profile;
}

export function offsetToMillis(offset: number, unit: WindowOffsetUnit): number {
  return Math.round(offset * UNIT_MILLIS[unit]);
}

/** Deterministic digest of the profile in force. */
export function executionProfileDigest(profile: ExecutionProfile): string {
  return digest128(stableStringify(profile));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function windowDefinitionIdFor(
  profileId: string,
  offset: number,
  unit: WindowOffsetUnit,
): string {
  return Ids.windowDefinition(profileId, String(offset), unit);
}

// ---------------------------------------------------------------------------
// Environment loading
// ---------------------------------------------------------------------------

export type EnvSource = Record<string, string | undefined>;

/** Every environment variable the Decision Domain understands. */
export const EXECUTION_ENV_KEYS = [
  "EXECUTION_PROFILE_ID",
  "EXECUTION_MODE",
  "EXECUTION_MAX_TRADES",
  "EXECUTION_TRIGGER_MODE",
  "EXECUTION_LIMIT_MODE",
  "EXECUTION_COMPOUNDING",
  "EXECUTION_POSITION_SIZE",
  "EXECUTION_RETRY_COUNT",
  "EXECUTION_MIN_LIQUIDITY",
  "EXECUTION_MAX_SPREAD",
  "EXECUTION_REPRICING_ENABLED",
  "EXECUTION_REPRICING_INTERVAL_MS",
  "EXECUTION_REPRICING_MAX_ATTEMPTS",
  "EXECUTION_TIMEOUT_MS",
  "EXECUTION_TICK_POLICY",
  "EXECUTION_TICK_SIZE",
  "EXECUTION_BUFFER_MODE",
  "EXECUTION_WINDOW_ACTIVE_MS",
  "EXECUTION_PRECISION",
  "EXECUTION_WINDOWS",
] as const;

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ExecutionProfileError([{ path: "(env)", message: `not a number: ${value}` }]);
  }
  return parsed;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value === "true" || value === "1";
}

function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const WINDOW_TOKEN = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/;

/**
 * Parses `EXECUTION_WINDOWS`. Two accepted forms:
 *   JSON  — `[{"offset":15,"unit":"m","twapBuffer":0.5}]`
 *   DSL   — `15s@0.002|size=2|retry=1|timeout=10000|spread=0.5, 3s@0.0005|disabled`
 */
export function parseWindowsSpec(spec: string): WindowDefinitionInput[] {
  const trimmed = spec.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new ExecutionProfileError([
        { path: "EXECUTION_WINDOWS", message: "JSON form must be an array" },
      ]);
    }
    return parsed as WindowDefinitionInput[];
  }

  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split("|").map((part) => part.trim());
      const head = parts[0] ?? "";
      const [offsetToken, bufferToken] = head.split("@");
      const match = WINDOW_TOKEN.exec((offsetToken ?? "").trim());
      if (!match) {
        throw new ExecutionProfileError([
          { path: "EXECUTION_WINDOWS", message: `unparsable window "${entry}"` },
        ]);
      }
      const window: WindowDefinitionInput = {
        offset: Number(match[1]),
        unit: match[2] as WindowOffsetUnit,
        enabled: true,
        twapBuffer: bufferToken === undefined ? 0 : Number(bufferToken),
      };
      for (const modifier of parts.slice(1)) {
        if (modifier === "disabled") window.enabled = false;
        else if (modifier.startsWith("size=")) {
          window.positionSizeOverride = Number(modifier.slice(5));
        } else if (modifier.startsWith("retry=")) {
          window.retryCountOverride = Number(modifier.slice(6));
        } else if (modifier.startsWith("timeout=")) {
          window.timeoutMillisOverride = Number(modifier.slice(8));
        } else if (modifier.startsWith("spread=")) {
          window.maxSpreadOverride = Number(modifier.slice(7));
        } else {
          throw new ExecutionProfileError([
            { path: "EXECUTION_WINDOWS", message: `unknown modifier "${modifier}"` },
          ]);
        }
      }
      return window;
    });
}

/** Builds a validated execution profile from an environment source. */
export function loadExecutionProfile(env: EnvSource): ExecutionProfile {
  const windowsSpec = env["EXECUTION_WINDOWS"];
  if (!windowsSpec || windowsSpec.trim() === "") {
    throw new ExecutionProfileError([
      { path: "EXECUTION_WINDOWS", message: "required — window offsets are never hardcoded" },
    ]);
  }

  const document: ExecutionProfileInput = {
    ...defined({
      executionProfileId: env["EXECUTION_PROFILE_ID"],
      executionMode: env["EXECUTION_MODE"] as ExecutionMode | undefined,
      maxTrades: num(env["EXECUTION_MAX_TRADES"]),
      triggerMode: env["EXECUTION_TRIGGER_MODE"] as ExecutionProfileInput["triggerMode"],
      limitMode: env["EXECUTION_LIMIT_MODE"] as ExecutionProfileInput["limitMode"],
      compounding: bool(env["EXECUTION_COMPOUNDING"]),
      positionSize: num(env["EXECUTION_POSITION_SIZE"]),
      retryCount: num(env["EXECUTION_RETRY_COUNT"]),
      minLiquidity: num(env["EXECUTION_MIN_LIQUIDITY"]),
      maxSpread: num(env["EXECUTION_MAX_SPREAD"]),
      repricingEnabled: bool(env["EXECUTION_REPRICING_ENABLED"]),
      repricingIntervalMillis: num(env["EXECUTION_REPRICING_INTERVAL_MS"]),
      repricingMaxAttempts: num(env["EXECUTION_REPRICING_MAX_ATTEMPTS"]),
      timeoutMillis: num(env["EXECUTION_TIMEOUT_MS"]),
      tickPolicy: env["EXECUTION_TICK_POLICY"] as ExecutionProfileInput["tickPolicy"],
      tickSize: num(env["EXECUTION_TICK_SIZE"]),
      bufferMode: env["EXECUTION_BUFFER_MODE"] as ExecutionProfileInput["bufferMode"],
      windowActiveMillis: num(env["EXECUTION_WINDOW_ACTIVE_MS"]),
      precision: num(env["EXECUTION_PRECISION"]),
    }),
    windows: parseWindowsSpec(windowsSpec),
  };

  return parseExecutionProfileOrThrow(document);
}
