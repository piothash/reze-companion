/**
 * ARC — configuration schema (P0/M0).
 *
 * Configuration First: every configurable value in ARC is declared here with a
 * schema, a default where a default is safe, and validation. No business value
 * is ever hardcoded in an engine.
 *
 * Note on scope: several sections below (execution/position/exposure defaults,
 * TWAP provider, feed ids) describe values the companion *transports and
 * displays*. The VPS remains the sole trading authority — nothing here computes
 * a trading decision.
 */
import { z } from "zod";

export const RUNTIME_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export const NETWORKS = ["testnet", "mainnet"] as const;
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];
export type NetworkName = (typeof NETWORKS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const url = z.string().url();

export const runtimeSectionSchema = z.object({
  environment: z.enum(RUNTIME_ENVIRONMENTS),
  network: z.enum(NETWORKS),
  /** Human label surfaced in logs and health output. */
  instanceLabel: z.string().min(1).default("arc-companion"),
});

export const enginePlaneSectionSchema = z.object({
  /** Base URL of the VPS trading authority. Never a browser-visible value. */
  baseUrl: url.optional(),
  requestTimeoutMillis: positiveInt.default(10_000),
  /** Maximum acceptable age of mirrored engine data before it reads as stale. */
  freshnessBudgetMillis: positiveInt.default(30_000),
});

export const twapSectionSchema = z.object({
  /** Identifier of the authoritative TWAP provider used by the engine. */
  provider: z.string().min(1).default("engine-native"),
  /** Provider endpoint, transported only; the companion never computes TWAP. */
  providerUrl: url.optional(),
  windowSeconds: positiveInt.default(300),
});

export const feedsSectionSchema = z.object({
  /** Opaque provider feed identifiers, e.g. price/oracle feeds. */
  feedIds: z.array(z.string().min(1)).default([]),
  rpcUrls: z.array(url).default([]),
  apiUrls: z.array(url).default([]),
  staleAfterMillis: positiveInt.default(15_000),
});

export const schedulerSectionSchema = z.object({
  tickIntervalMillis: positiveInt.default(1_000),
  maxDriftMillis: positiveInt.default(250),
  clockSkewToleranceMillis: positiveInt.default(2_000),
  maxConcurrentTasks: positiveInt.default(8),
});

export const loggingSectionSchema = z.object({
  level: z.enum(LOG_LEVELS).default("info"),
  /** Structured JSON is mandatory in every environment except local debug. */
  format: z.enum(["json", "pretty"]).default("json"),
  redactKeys: z.array(z.string().min(1)).default(["authorization", "apikey", "token", "secret", "password"]),
});

export const metricsSectionSchema = z.object({
  enabled: z.boolean().default(true),
  /** Namespace prefix applied to every metric name. */
  namespace: z.string().min(1).default("arc"),
  flushIntervalMillis: positiveInt.default(15_000),
});

export const healthSectionSchema = z.object({
  checkTimeoutMillis: positiveInt.default(3_000),
  degradedAfterFailures: positiveInt.default(1),
  unavailableAfterFailures: positiveInt.default(3),
  cacheTtlMillis: nonNegativeInt.default(5_000),
});

export const retrySectionSchema = z.object({
  maxAttempts: positiveInt.default(3),
  initialDelayMillis: positiveInt.default(200),
  maxDelayMillis: positiveInt.default(5_000),
  backoffMultiplier: z.number().min(1).default(2),
  jitterRatio: ratio.default(0.2),
});

export const positionDefaultsSectionSchema = z.object({
  /** Transported defaults only — the engine owns sizing. */
  maxNotionalUsd: z.number().nonnegative().default(0),
  minNotionalUsd: z.number().nonnegative().default(0),
  perWindowBufferRatio: ratio.default(0),
});

export const exposureDefaultsSectionSchema = z.object({
  maxOpenWindows: nonNegativeInt.default(0),
  maxDailyNotionalUsd: z.number().nonnegative().default(0),
  tradeQuotaPerWindow: nonNegativeInt.default(0),
});

export const replaySectionSchema = z.object({
  enabled: z.boolean().default(false),
  /** Deterministic runs require a fixed clock origin. */
  clockOriginIso: z.string().datetime({ offset: false }).optional(),
  strictDivergenceCheck: z.boolean().default(true),
});

export const featureFlagsSectionSchema = z.record(z.string().min(1), z.boolean()).default({});

export const executionProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  network: z.enum(NETWORKS),
  /** Profile-scoped overrides, validated against the same section schemas. */
  overrides: z
    .object({
      scheduler: schedulerSectionSchema.partial().optional(),
      retry: retrySectionSchema.partial().optional(),
      positionDefaults: positionDefaultsSectionSchema.partial().optional(),
      exposureDefaults: exposureDefaultsSectionSchema.partial().optional(),
    })
    .default({}),
});

export type ExecutionProfile = z.infer<typeof executionProfileSchema>;

export const arcConfigSchema = z.object({
  configVersion: z.string().min(1),
  runtime: runtimeSectionSchema,
  enginePlane: enginePlaneSectionSchema.default({}),
  twap: twapSectionSchema.default({}),
  feeds: feedsSectionSchema.default({}),
  scheduler: schedulerSectionSchema.default({}),
  logging: loggingSectionSchema.default({}),
  metrics: metricsSectionSchema.default({}),
  health: healthSectionSchema.default({}),
  retry: retrySectionSchema.default({}),
  positionDefaults: positionDefaultsSectionSchema.default({}),
  exposureDefaults: exposureDefaultsSectionSchema.default({}),
  replay: replaySectionSchema.default({}),
  featureFlags: featureFlagsSectionSchema,
  activeExecutionProfileId: z.string().min(1).optional(),
});

export type ArcConfig = z.infer<typeof arcConfigSchema>;
export type ArcConfigInput = z.input<typeof arcConfigSchema>;

export interface ConfigValidationIssue {
  path: string;
  message: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  issues: ConfigValidationIssue[];
  config?: ArcConfig;
}

export function validateConfig(candidate: unknown): ConfigValidationResult {
  const parsed = arcConfigSchema.safeParse(candidate);
  if (parsed.success) return { valid: true, issues: [], config: parsed.data };
  return {
    valid: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    })),
  };
}

/** Fail-fast variant used at startup. */
export function parseConfigOrThrow(candidate: unknown): ArcConfig {
  const result = validateConfig(candidate);
  if (!result.config) {
    const detail = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`ARC configuration invalid — ${detail}`);
  }
  return result.config;
}

export function applyExecutionProfile(config: ArcConfig, profile: ExecutionProfile): ArcConfig {
  const merged: unknown = {
    ...config,
    runtime: { ...config.runtime, network: profile.network },
    scheduler: { ...config.scheduler, ...(profile.overrides.scheduler ?? {}) },
    retry: { ...config.retry, ...(profile.overrides.retry ?? {}) },
    positionDefaults: { ...config.positionDefaults, ...(profile.overrides.positionDefaults ?? {}) },
    exposureDefaults: { ...config.exposureDefaults, ...(profile.overrides.exposureDefaults ?? {}) },
    activeExecutionProfileId: profile.id,
  };
  return parseConfigOrThrow(merged);
}
