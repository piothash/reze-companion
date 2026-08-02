/**
 * ARC — Execution Adapter (M3).
 *
 * The single translation boundary between the Decision Domain and the Trade
 * Domain. It converts an immutable ExecutionIntent into strategy-free
 * ExecutionConstraints and nothing else.
 *
 * The adapter deliberately never re-derives, re-evaluates or second-guesses a
 * decision: it reads no TWAP, no PTB, no buffer and no window. The intent's
 * side is mapped onto an opaque venue outcome key through configuration, and
 * the price ceiling is supplied by the caller from venue data.
 */
import { deterministicId } from "../shared/ids";
import { executionConstraintsSchema, freezeDeep, type ExecutionConstraints } from "./types";
import { type OrderExecutionConfig } from "./configuration";

/** Intent fields the adapter is allowed to read. Nothing strategic here. */
export interface AdaptableIntent {
  executionIntentId: string;
  marketInstanceId: string;
  correlationId: string;
  side: "BUY_UP" | "BUY_DOWN";
  positionSize: number;
  retryCount: number;
}

/** Venue-supplied inputs; the adapter never invents these. */
export interface ExecutionAdapterInput {
  /** Opaque venue outcome keys, one per decision side. */
  outcomeKeys: { BUY_UP: string; BUY_DOWN: string };
  /**
   * Maximum price the engine may pay, taken from venue data or operator
   * configuration. Never derived from TWAP, PTB or a buffer.
   */
  maxPrice: number;
  execution: OrderExecutionConfig;
}

export class ExecutionAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionAdapterError";
  }
}

/**
 * Pure mapping: identical inputs always yield identical constraints, which is
 * what makes execution replayable.
 */
export function adaptIntent(
  intent: AdaptableIntent,
  input: ExecutionAdapterInput,
): ExecutionConstraints {
  const outcomeKey = input.outcomeKeys[intent.side];
  if (!outcomeKey) {
    throw new ExecutionAdapterError(`No venue outcome key configured for side ${intent.side}`);
  }
  if (!(input.maxPrice > 0)) {
    throw new ExecutionAdapterError(`maxPrice must be positive, got ${input.maxPrice}`);
  }

  const quantity = intent.positionSize / input.maxPrice;

  return freezeDeep(
    executionConstraintsSchema.parse({
      executionIntentId: intent.executionIntentId,
      marketInstanceId: intent.marketInstanceId,
      correlationId: intent.correlationId,
      outcomeKey,
      quantity: Math.round(quantity * 1e8) / 1e8,
      limitPrice: input.maxPrice,
      tickSize: input.execution.tickSize,
      tickPolicy: input.execution.tickPolicy,
      precision: input.execution.precision,
      postOnly: input.execution.postOnly,
      timeoutMillis: input.execution.timeoutMillis,
      // The decision owns the retry count; execution config owns the delay.
      retryCount: intent.retryCount,
      retryDelayMillis: input.execution.retryDelayMillis,
      repricingEnabled: input.execution.repricingEnabled,
      repricingIntervalMillis: input.execution.repricingIntervalMillis,
      repricingMaxAttempts: input.execution.repricingMaxAttempts,
      iocFallbackEnabled: input.execution.iocFallbackEnabled,
      minMeaningfulQuantity: input.execution.minMeaningfulQuantity,
    } satisfies ExecutionConstraints),
  );
}

/** Stable key for de-duplicating an execution across restarts. */
export function executionIdempotencyKey(constraints: ExecutionConstraints): string {
  return deterministicId(
    "ExecutionIntentId",
    "execution",
    constraints.executionIntentId,
    constraints.outcomeKey,
  );
}
