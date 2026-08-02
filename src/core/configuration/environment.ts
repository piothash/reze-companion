/**
 * ARC — environment system (P0/M0).
 *
 * Strongly typed environment loading with fail-fast validation. Env values are
 * never read at module scope: callers pass a source record from inside a server
 * function handler, which is the only place `process.env` is populated on the
 * Worker runtime.
 */
import { z } from "zod";

import {
  arcConfigSchema,
  parseConfigOrThrow,
  RUNTIME_ENVIRONMENTS,
  NETWORKS,
  LOG_LEVELS,
  type ArcConfig,
} from "./schema";
import { versionOf } from "../contracts/versions";

export type EnvSource = Record<string, string | undefined>;

const optionalUrl = z
  .string()
  .url()
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalInt = z
  .string()
  .regex(/^\d+$/, "must be a non-negative integer")
  .transform(Number)
  .optional();

const optionalBool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1")
  .optional();

const csv = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .optional();

/**
 * Declarative catalog of every environment variable ARC understands.
 * Adding an integration means adding a key here — never an inline read.
 */
export const envSchema = z.object({
  ARC_ENVIRONMENT: z.enum(RUNTIME_ENVIRONMENTS).default("development"),
  ARC_NETWORK: z.enum(NETWORKS).default("testnet"),
  ARC_INSTANCE_LABEL: z.string().min(1).optional(),

  ARC_ENGINE_BASE_URL: optionalUrl,
  ARC_ENGINE_TIMEOUT_MS: optionalInt,
  ARC_ENGINE_FRESHNESS_MS: optionalInt,

  ARC_TWAP_PROVIDER: z.string().min(1).optional(),
  ARC_TWAP_PROVIDER_URL: optionalUrl,
  ARC_TWAP_WINDOW_SECONDS: optionalInt,

  ARC_FEED_IDS: csv,
  ARC_RPC_URLS: csv,
  ARC_API_URLS: csv,
  ARC_FEED_STALE_AFTER_MS: optionalInt,

  ARC_SCHEDULER_TICK_MS: optionalInt,
  ARC_SCHEDULER_MAX_DRIFT_MS: optionalInt,
  ARC_CLOCK_SKEW_TOLERANCE_MS: optionalInt,

  ARC_LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  ARC_LOG_FORMAT: z.enum(["json", "pretty"]).optional(),

  ARC_METRICS_ENABLED: optionalBool,
  ARC_METRICS_NAMESPACE: z.string().min(1).optional(),

  ARC_HEALTH_TIMEOUT_MS: optionalInt,

  ARC_RETRY_MAX_ATTEMPTS: optionalInt,
  ARC_RETRY_INITIAL_DELAY_MS: optionalInt,
  ARC_RETRY_MAX_DELAY_MS: optionalInt,

  ARC_REPLAY_ENABLED: optionalBool,
  ARC_REPLAY_CLOCK_ORIGIN: z.string().datetime({ offset: false }).optional(),

  ARC_EXECUTION_PROFILE_ID: z.string().min(1).optional(),
});

export type ArcEnv = z.infer<typeof envSchema>;

export class EnvironmentValidationError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(
      `ARC environment invalid — ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
    this.name = "EnvironmentValidationError";
  }
}

/** Fail-fast environment parse. Startup must not continue past a throw here. */
export function loadEnv(source: EnvSource): ArcEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvironmentValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Projects a validated environment onto the configuration document. */
export function configFromEnv(env: ArcEnv, overrides: Record<string, unknown> = {}): ArcConfig {
  const document = {
    configVersion: versionOf("configuration"),
    runtime: defined({
      environment: env.ARC_ENVIRONMENT,
      network: env.ARC_NETWORK,
      instanceLabel: env.ARC_INSTANCE_LABEL,
    }),
    enginePlane: defined({
      baseUrl: env.ARC_ENGINE_BASE_URL,
      requestTimeoutMillis: env.ARC_ENGINE_TIMEOUT_MS,
      freshnessBudgetMillis: env.ARC_ENGINE_FRESHNESS_MS,
    }),
    twap: defined({
      provider: env.ARC_TWAP_PROVIDER,
      providerUrl: env.ARC_TWAP_PROVIDER_URL,
      windowSeconds: env.ARC_TWAP_WINDOW_SECONDS,
    }),
    feeds: defined({
      feedIds: env.ARC_FEED_IDS,
      rpcUrls: env.ARC_RPC_URLS,
      apiUrls: env.ARC_API_URLS,
      staleAfterMillis: env.ARC_FEED_STALE_AFTER_MS,
    }),
    scheduler: defined({
      tickIntervalMillis: env.ARC_SCHEDULER_TICK_MS,
      maxDriftMillis: env.ARC_SCHEDULER_MAX_DRIFT_MS,
      clockSkewToleranceMillis: env.ARC_CLOCK_SKEW_TOLERANCE_MS,
    }),
    logging: defined({ level: env.ARC_LOG_LEVEL, format: env.ARC_LOG_FORMAT }),
    metrics: defined({ enabled: env.ARC_METRICS_ENABLED, namespace: env.ARC_METRICS_NAMESPACE }),
    health: defined({ checkTimeoutMillis: env.ARC_HEALTH_TIMEOUT_MS }),
    retry: defined({
      maxAttempts: env.ARC_RETRY_MAX_ATTEMPTS,
      initialDelayMillis: env.ARC_RETRY_INITIAL_DELAY_MS,
      maxDelayMillis: env.ARC_RETRY_MAX_DELAY_MS,
    }),
    replay: defined({ enabled: env.ARC_REPLAY_ENABLED, clockOriginIso: env.ARC_REPLAY_CLOCK_ORIGIN }),
    featureFlags: {},
    ...defined({ activeExecutionProfileId: env.ARC_EXECUTION_PROFILE_ID }),
    ...overrides,
  };

  return parseConfigOrThrow(document);
}

/** Convenience: environment → validated configuration, failing fast on both. */
export function bootstrapConfig(source: EnvSource, overrides: Record<string, unknown> = {}): ArcConfig {
  return configFromEnv(loadEnv(source), overrides);
}

export const ENV_KEYS = Object.keys(arcConfigSchema.shape).length > 0 ? Object.keys(envSchema.shape) : [];
