/**
 * ARC — Decision Domain contracts (M2).
 *
 * The Decision Domain is TWAP-native. It owns windows, quota and decisions and
 * produces exactly one artefact: an immutable ExecutionIntent. It never
 * executes, never places orders, never touches risk or settlement.
 *
 * The legacy Majority strategy (majority direction, confidence, thresholds,
 * crowd sentiment, Binance direction) does not exist in ARC and must never be
 * reintroduced here or anywhere else.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Window definitions (fully dynamic — no offset is ever hardcoded)
// ---------------------------------------------------------------------------

export const WINDOW_OFFSET_UNITS = ["ms", "s", "m", "h"] as const;
export type WindowOffsetUnit = (typeof WINDOW_OFFSET_UNITS)[number];

export const UNIT_MILLIS: Record<WindowOffsetUnit, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

export const windowDefinitionSchema = z.object({
  /** Deterministic identifier derived from profile + offset + unit. */
  windowDefinitionId: z.string().min(1),
  /** Offset before market resolution at which the window activates. */
  offset: z.number().finite().positive(),
  unit: z.enum(WINDOW_OFFSET_UNITS),
  /** Resolved offset in milliseconds; the sole basis for derived priority. */
  offsetMillis: z.number().int().positive(),
  enabled: z.boolean(),
  /** TWAP buffer applied when comparing the effective TWAP against the PTB. */
  twapBuffer: z.number().finite().nonnegative(),
  /** Optional per-window position size override; inherits globally when null. */
  positionSizeOverride: z.number().finite().positive().nullable(),
  /** Optional per-window retry override; inherits globally when null. */
  retryCountOverride: z.number().int().nonnegative().nullable(),
});

export type WindowDefinition = z.infer<typeof windowDefinitionSchema>;

// ---------------------------------------------------------------------------
// Frozen per-window configuration snapshot
// ---------------------------------------------------------------------------

export const windowConfigurationSnapshotSchema = z.object({
  /** Deterministic digest identifying this exact frozen configuration. */
  configurationSnapshotId: z.string().min(1),
  executionProfileId: z.string().min(1),
  executionProfileVersion: z.string().min(1),
  bufferProfileVersion: z.string().min(1),
  riskProfileVersion: z.string().min(1),
  executionMode: z.enum(["SINGLE_TRADE", "MULTI_TRADE"]),
  triggerMode: z.string().min(1),
  limitMode: z.string().min(1),
  compounding: z.boolean(),
  tickPolicy: z.string().min(1),
  tickSize: z.number().finite().positive(),
  bufferMode: z.enum(["ABSOLUTE", "PERCENT"]),
  /** Resolved (inherited) effective values for this window. */
  offset: z.number().finite().positive(),
  unit: z.enum(WINDOW_OFFSET_UNITS),
  offsetMillis: z.number().int().positive(),
  twapBuffer: z.number().finite().nonnegative(),
  positionSize: z.number().finite().positive(),
  retryCount: z.number().int().nonnegative(),
  windowActiveMillis: z.number().int().positive(),
  timeoutMillis: z.number().int().positive(),
  repricingEnabled: z.boolean(),
  repricingIntervalMillis: z.number().int().positive(),
  repricingMaxAttempts: z.number().int().nonnegative(),
  minLiquidity: z.number().finite().nonnegative(),
  maxSpread: z.number().finite().nonnegative(),
  precision: z.number().int().nonnegative(),
});

export type WindowConfigurationSnapshot = z.infer<typeof windowConfigurationSnapshotSchema>;

// ---------------------------------------------------------------------------
// Window FSM
// ---------------------------------------------------------------------------

export const WINDOW_STATES = [
  "CONFIGURED",
  "WAITING",
  "ACTIVE",
  "EVALUATING",
  "EXECUTING",
  "COMPLETED",
] as const;
export type WindowState = (typeof WINDOW_STATES)[number];

export const WINDOW_EVENTS = [
  "OPEN",
  "ACTIVATE",
  "EVALUATE",
  "EVALUATION_INCONCLUSIVE",
  "INTENT_CREATED",
  "COMPLETE",
] as const;
export type WindowEvent = (typeof WINDOW_EVENTS)[number];

export const WINDOW_COMPLETION_REASONS = [
  "FILLED",
  "PARTIAL_FILLED",
  "NOT_FILLED",
  "NO_SIGNAL",
  "RISK_DENIED",
  "QUOTA_EXHAUSTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type WindowCompletionReason = (typeof WINDOW_COMPLETION_REASONS)[number];

// ---------------------------------------------------------------------------
// Window instance
// ---------------------------------------------------------------------------

export const windowInstanceSnapshotSchema = z.object({
  windowInstanceId: z.string().min(1),
  windowDefinitionId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  executionContextId: z.string().min(1),
  /** Ordinal position after descending-priority sorting; 0 is highest. */
  sequence: z.number().int().nonnegative(),
  /** Derived priority; equals offsetMillis, larger activates earlier. */
  priority: z.number().int().positive(),
  offset: z.number().finite().positive(),
  unit: z.enum(WINDOW_OFFSET_UNITS),
  state: z.enum(WINDOW_STATES),
  configuration: windowConfigurationSnapshotSchema,
  activatesAtIso: z.string().datetime({ offset: false }),
  expiresAtIso: z.string().datetime({ offset: false }),
  tradeQuotaAtCreation: z.number().int().nonnegative(),
  tradeQuotaAtCompletion: z.number().int().nonnegative().nullable(),
  /** Market state version of the most recent evaluation, null before any. */
  marketStateVersion: z.number().int().nonnegative().nullable(),
  evaluationCount: z.number().int().nonnegative(),
  executionIntentId: z.string().min(1).nullable(),
  completionReason: z.enum(WINDOW_COMPLETION_REASONS).nullable(),
  createdAtIso: z.string().datetime({ offset: false }),
  completedAtIso: z.string().datetime({ offset: false }).nullable(),
});

export type WindowInstanceSnapshot = z.infer<typeof windowInstanceSnapshotSchema>;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export const DECISION_OUTCOMES = ["BUY_UP", "BUY_DOWN", "NO_SIGNAL"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const decisionSchema = z.object({
  outcome: z.enum(DECISION_OUTCOMES),
  /** Conditioned TWAP the comparison was performed on. */
  effectiveTwap: z.number().finite().nullable(),
  /** Price-to-beat read from official market metadata. */
  ptb: z.number().finite().nullable(),
  /** Resolved buffer in absolute price units. */
  appliedBuffer: z.number().finite().nonnegative(),
  /** effectiveTwap - ptb, before buffer comparison. */
  delta: z.number().finite().nullable(),
  marketStateVersion: z.number().int().nonnegative(),
  windowInstanceId: z.string().min(1),
  /** Ordered, auditable comparison steps. */
  appliedSteps: z.array(z.string()).default([]),
  /** Present whenever the outcome is NO_SIGNAL. */
  rejectionReason: z.string().nullable(),
});

export type Decision = z.infer<typeof decisionSchema>;

// ---------------------------------------------------------------------------
// Execution intent (the only artefact the Decision Domain produces)
// ---------------------------------------------------------------------------

export const executionIntentSchema = z.object({
  executionIntentId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  windowInstanceId: z.string().min(1),
  correlationId: z.string().min(1),
  marketStateVersion: z.number().int().nonnegative(),
  configurationSnapshotId: z.string().min(1),
  executionProfileVersion: z.string().min(1),
  bufferProfileVersion: z.string().min(1),
  riskProfileVersion: z.string().min(1),
  engineVersions: z.record(z.string(), z.string()),
  platformVersion: z.string().min(1),
  /** Decision side. Never an order, never an execution instruction. */
  side: z.enum(["BUY_UP", "BUY_DOWN"]),
  positionSize: z.number().finite().positive(),
  retryCount: z.number().int().nonnegative(),
  referenceEffectiveTwap: z.number().finite(),
  referencePtb: z.number().finite(),
  appliedBuffer: z.number().finite().nonnegative(),
  createdAtIso: z.string().datetime({ offset: false }),
});

export type ExecutionIntent = z.infer<typeof executionIntentSchema>;

// ---------------------------------------------------------------------------
// Trade quota
// ---------------------------------------------------------------------------

export const tradeQuotaSnapshotSchema = z.object({
  initial: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  consumed: z.number().int().nonnegative(),
});

export type TradeQuotaSnapshot = z.infer<typeof tradeQuotaSnapshotSchema>;

/** Deep-freezes a published snapshot so consumers cannot mutate it. */
export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const entry of Object.values(value as Record<string, unknown>)) freezeDeep(entry);
  return Object.freeze(value);
}
