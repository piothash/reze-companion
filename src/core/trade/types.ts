/**
 * ARC — Trade Domain contracts (M3).
 *
 * The Trade Domain turns an immutable ExecutionIntent into orders. It contains
 * NO strategy: it never computes TWAP, never reads a price-to-beat, never
 * knows about buffers, execution windows, window offsets, execution profiles
 * or decision logic. The legacy Majority strategy (majority direction,
 * confidence, crowd sentiment, Binance direction) does not exist here and must
 * never be reintroduced.
 *
 * Everything below is a contract. Behaviour lives in the sibling modules.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

/** Risk answers exactly one question, with exactly two answers. */
export const RISK_DECISIONS = ["ALLOW", "DENY"] as const;
export type RiskDecision = (typeof RISK_DECISIONS)[number];

/** The complete, closed set of dimensions the Risk Engine may evaluate. */
export const RISK_CHECKS = [
  "KILL_SWITCH",
  "MARKET_VALIDITY",
  "FEED_FRESHNESS",
  "EXPOSURE",
  "POSITION_LIMIT",
  "LIQUIDITY",
  "POLICY",
] as const;
export type RiskCheckName = (typeof RISK_CHECKS)[number];

export const riskCheckResultSchema = z.object({
  check: z.enum(RISK_CHECKS),
  passed: z.boolean(),
  /** Human-auditable detail; never a directive and never a price opinion. */
  detail: z.string(),
  /** Observed value the check was evaluated on, when numeric. */
  observed: z.number().finite().nullable().default(null),
  /** Configured limit the observation was compared against, when numeric. */
  limit: z.number().finite().nullable().default(null),
});

export type RiskCheckResult = z.infer<typeof riskCheckResultSchema>;

export const riskVerdictSchema = z.object({
  decision: z.enum(RISK_DECISIONS),
  executionIntentId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  riskProfileVersion: z.string().min(1),
  /** Ordered evaluation trace; every configured check appears exactly once. */
  checks: z.array(riskCheckResultSchema),
  /** First failing check, null on ALLOW. */
  deniedBy: z.enum(RISK_CHECKS).nullable(),
  reason: z.string().nullable(),
  evaluatedAtIso: z.string().datetime({ offset: false }),
});

export type RiskVerdict = z.infer<typeof riskVerdictSchema>;

/**
 * Everything the Risk Engine is allowed to see. Deliberately free of TWAP,
 * PTB, buffers, windows and decision internals: risk evaluates conditions, it
 * never re-derives or second-guesses the decision.
 */
export const riskInputSchema = z.object({
  executionIntentId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  riskProfileVersion: z.string().min(1),
  /** Notional the intent wants to put at risk. */
  requestedExposure: z.number().finite().positive(),
  /** Quantity the intent wants to trade, in venue units. */
  requestedQuantity: z.number().finite().positive(),
  /** Opaque outcome key; risk never interprets it as a direction signal. */
  outcomeKey: z.string().min(1),
  killSwitchEngaged: z.boolean(),
  marketValid: z.boolean(),
  marketTradable: z.boolean(),
  feedFreshnessState: z.enum(["FRESH", "STALE", "UNAVAILABLE"]),
  feedAgeMillis: z.number().int().nonnegative().nullable(),
  /** Currently live (filled, unsettled) exposure for this market instance. */
  liveExposure: z.number().finite().nonnegative(),
  /** Currently reserved (in-flight) exposure for this market instance. */
  reservedExposure: z.number().finite().nonnegative(),
  /** Live position quantity already held on this outcome. */
  outcomePosition: z.number().finite().nonnegative(),
  /** Observable book liquidity on the outcome, null when unknown. */
  availableLiquidity: z.number().finite().nonnegative().nullable(),
  /** Observable spread on the outcome, null when unknown. */
  spread: z.number().finite().nonnegative().nullable(),
});

export type RiskInput = z.infer<typeof riskInputSchema>;

// ---------------------------------------------------------------------------
// Exposure reservations
// ---------------------------------------------------------------------------

export const RESERVATION_STATES = ["RESERVED", "COMMITTED", "RELEASED"] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

export const exposureReservationSchema = z.object({
  reservationId: z.string().min(1),
  executionIntentId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  outcomeKey: z.string().min(1),
  /** Amount still reserved (not yet committed and not yet released). */
  reserved: z.number().finite().nonnegative(),
  /** Amount converted into live exposure by fills. */
  committed: z.number().finite().nonnegative(),
  /** Amount handed back because it will never be executed. */
  released: z.number().finite().nonnegative(),
  /** Original reservation amount; reserved + committed + released equals it. */
  amount: z.number().finite().positive(),
  state: z.enum(RESERVATION_STATES),
  reservedAtIso: z.string().datetime({ offset: false }),
  settledAtIso: z.string().datetime({ offset: false }).nullable(),
});

export type ExposureReservationRecord = z.infer<typeof exposureReservationSchema>;

export const exposureSnapshotSchema = z.object({
  marketInstanceId: z.string().min(1),
  limit: z.number().finite().positive(),
  live: z.number().finite().nonnegative(),
  reserved: z.number().finite().nonnegative(),
  /** limit - live - reserved, floored at zero. */
  available: z.number().finite().nonnegative(),
  reservations: z.array(exposureReservationSchema),
});

export type ExposureSnapshot = z.infer<typeof exposureSnapshotSchema>;

// ---------------------------------------------------------------------------
// Order FSM
// ---------------------------------------------------------------------------

export const ORDER_STATES = [
  "CREATED",
  "SUBMITTED",
  "WORKING",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const ORDER_EVENTS = [
  "SUBMIT",
  "ACKNOWLEDGE",
  "PARTIAL_FILL",
  "FILL",
  "CANCEL",
  "REJECT",
  "EXPIRE",
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

export const ORDER_TERMINAL_STATES: readonly OrderState[] = [
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
];

/** Time in force. IOC is the configured fallback, never a strategy choice. */
export const TIME_IN_FORCE = ["GTC", "IOC"] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

export const fillSchema = z.object({
  fillId: z.string().min(1),
  orderId: z.string().min(1),
  quantity: z.number().finite().positive(),
  price: z.number().finite().positive(),
  /** Venue-reported fill identifier used for idempotent replay. */
  venueFillId: z.string().min(1),
  filledAtIso: z.string().datetime({ offset: false }),
});

export type Fill = z.infer<typeof fillSchema>;

export const orderSnapshotSchema = z.object({
  orderId: z.string().min(1),
  executionIntentId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  outcomeKey: z.string().min(1),
  /** Attempt ordinal within one execution session; 0 is the first attempt. */
  attempt: z.number().int().nonnegative(),
  /** Reprice ordinal for this attempt; 0 means never repriced. */
  repriceCount: z.number().int().nonnegative(),
  state: z.enum(ORDER_STATES),
  timeInForce: z.enum(TIME_IN_FORCE),
  postOnly: z.boolean(),
  limitPrice: z.number().finite().positive(),
  quantity: z.number().finite().positive(),
  filledQuantity: z.number().finite().nonnegative(),
  remainingQuantity: z.number().finite().nonnegative(),
  averageFillPrice: z.number().finite().nonnegative(),
  venueOrderId: z.string().min(1).nullable(),
  rejectionReason: z.string().nullable(),
  fills: z.array(fillSchema),
  createdAtIso: z.string().datetime({ offset: false }),
  updatedAtIso: z.string().datetime({ offset: false }),
  terminalAtIso: z.string().datetime({ offset: false }).nullable(),
});

export type OrderSnapshot = z.infer<typeof orderSnapshotSchema>;

// ---------------------------------------------------------------------------
// Execution constraints — the ONLY execution instruction the engine receives
// ---------------------------------------------------------------------------

/**
 * A fully resolved, strategy-free execution instruction. The Standing Limit
 * Order Engine consumes exactly this and nothing else: there is no field here
 * from which TWAP, PTB, a buffer, a window or an execution profile could be
 * reconstructed.
 */
export const executionConstraintsSchema = z.object({
  executionIntentId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  correlationId: z.string().min(1),
  /** Opaque venue outcome key. Not a direction, not a signal. */
  outcomeKey: z.string().min(1),
  quantity: z.number().finite().positive(),
  /** Upper bound the engine may never pay above. */
  limitPrice: z.number().finite().positive(),
  tickSize: z.number().finite().positive(),
  tickPolicy: z.enum(["ROUND_NEAREST", "ROUND_DOWN", "ROUND_UP"]),
  precision: z.number().int().nonnegative(),
  postOnly: z.boolean(),
  /** Whole execution session deadline, measured from session start. */
  timeoutMillis: z.number().int().positive(),
  retryCount: z.number().int().nonnegative(),
  retryDelayMillis: z.number().int().nonnegative(),
  repricingEnabled: z.boolean(),
  repricingIntervalMillis: z.number().int().positive(),
  repricingMaxAttempts: z.number().int().nonnegative(),
  iocFallbackEnabled: z.boolean(),
  /** Smallest cumulative quantity that counts as a real trade. */
  minMeaningfulQuantity: z.number().finite().positive(),
});

export type ExecutionConstraints = z.infer<typeof executionConstraintsSchema>;

// ---------------------------------------------------------------------------
// Execution session
// ---------------------------------------------------------------------------

export const EXECUTION_STATES = [
  "PENDING",
  "WORKING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const EXECUTION_FAILURE_REASONS = [
  "REJECTED",
  "RETRY_EXHAUSTED",
  "TIMEOUT",
  "CANCELLED",
  "NO_LIQUIDITY",
  "GATEWAY_ERROR",
] as const;
export type ExecutionFailureReason = (typeof EXECUTION_FAILURE_REASONS)[number];

export const executionSessionSnapshotSchema = z.object({
  executionIntentId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  outcomeKey: z.string().min(1),
  state: z.enum(EXECUTION_STATES),
  constraints: executionConstraintsSchema,
  orders: z.array(orderSnapshotSchema),
  /** Cumulative executed quantity across every order of this session. */
  cumulativeFilledQuantity: z.number().finite().nonnegative(),
  cumulativeNotional: z.number().finite().nonnegative(),
  attempts: z.number().int().nonnegative(),
  reprices: z.number().int().nonnegative(),
  iocFallbackUsed: z.boolean(),
  /** True once the cumulative fill first reached minMeaningfulQuantity. */
  quotaCommitted: z.boolean(),
  failureReason: z.enum(EXECUTION_FAILURE_REASONS).nullable(),
  startedAtIso: z.string().datetime({ offset: false }),
  deadlineIso: z.string().datetime({ offset: false }),
  terminalAtIso: z.string().datetime({ offset: false }).nullable(),
});

export type ExecutionSessionSnapshot = z.infer<typeof executionSessionSnapshotSchema>;

/** Terminal report handed to settlement hooks exactly once per session. */
export const executionReportSchema = z.object({
  executionIntentId: z.string().min(1),
  marketInstanceId: z.string().min(1),
  outcomeKey: z.string().min(1),
  filled: z.boolean(),
  partiallyFilled: z.boolean(),
  cumulativeFilledQuantity: z.number().finite().nonnegative(),
  cumulativeNotional: z.number().finite().nonnegative(),
  averagePrice: z.number().finite().nonnegative(),
  requestedQuantity: z.number().finite().positive(),
  failureReason: z.enum(EXECUTION_FAILURE_REASONS).nullable(),
  orders: z.array(orderSnapshotSchema),
  reportedAtIso: z.string().datetime({ offset: false }),
});

export type ExecutionReport = z.infer<typeof executionReportSchema>;

/** Deep-freezes a published snapshot so consumers cannot mutate it. */
export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const entry of Object.values(value as Record<string, unknown>)) freezeDeep(entry);
  return Object.freeze(value);
}

/** Rounds a price onto the venue tick grid under the configured policy. */
export function applyTick(
  price: number,
  tickSize: number,
  policy: ExecutionConstraints["tickPolicy"],
  precision: number,
): number {
  const ticks = price / tickSize;
  const rounded =
    policy === "ROUND_DOWN"
      ? Math.floor(ticks)
      : policy === "ROUND_UP"
        ? Math.ceil(ticks)
        : Math.round(ticks);
  const factor = 10 ** precision;
  return Math.round(rounded * tickSize * factor) / factor;
}
