/**
 * ARC — TWAP-native Decision Engine (M2).
 *
 * A PURE FUNCTION:
 *
 *   Decision = f(AuthoritativeMarketState, WindowInstance, ConfigurationSnapshot)
 *
 * It never queries a database, never calls an API, never reads Supabase, never
 * opens a socket, never uses randomness, timers or caches. Identical inputs
 * always produce identical outputs.
 *
 * Algorithm — the permanent ARC strategy:
 *   Effective TWAP  ±  Window Buffer   compared against   PTB
 *     → BUY_UP | BUY_DOWN | NO_SIGNAL
 *
 * Forbidden forever: majority direction, majority confidence, majority
 * thresholds, crowd sentiment, Binance direction, legacy strategy helpers,
 * hidden heuristics and any feature flag that would restore them.
 */
import { decisionSchema, freezeDeep, type Decision } from "./types";
import { type WindowConfigurationSnapshot } from "./types";
import { type AuthoritativeMarketState } from "../market/types";

export interface DecisionInput {
  readonly marketState: AuthoritativeMarketState;
  readonly windowInstanceId: string;
  readonly configuration: WindowConfigurationSnapshot;
}

/** Deterministic decimal rounding; identical in every runtime. */
function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function noSignal(
  input: DecisionInput,
  steps: string[],
  reason: string,
  effectiveTwap: number | null,
  ptb: number | null,
  appliedBuffer: number,
): Decision {
  return freezeDeep(
    decisionSchema.parse({
      outcome: "NO_SIGNAL",
      effectiveTwap,
      ptb,
      appliedBuffer,
      delta: effectiveTwap !== null && ptb !== null ? roundTo(effectiveTwap - ptb, 12) : null,
      marketStateVersion: input.marketState.marketStateVersion,
      windowInstanceId: input.windowInstanceId,
      appliedSteps: steps,
      rejectionReason: reason,
    } satisfies Decision),
  );
}

/** Resolves the window buffer into absolute price units. */
export function resolveBuffer(configuration: WindowConfigurationSnapshot, ptb: number): number {
  const raw =
    configuration.bufferMode === "PERCENT"
      ? Math.abs(ptb) * (configuration.twapBuffer / 100)
      : configuration.twapBuffer;
  return roundTo(Math.abs(raw), configuration.precision);
}

/** The pure decision function. No side effects of any kind. */
export function decide(input: DecisionInput): Decision {
  const { marketState, configuration } = input;
  const steps: string[] = [];

  if (marketState.lifecycle !== "ACTIVE" && marketState.lifecycle !== "CLOSING") {
    return noSignal(input, steps, `market lifecycle is ${marketState.lifecycle}`, null, null, 0);
  }
  steps.push(`lifecycle:${marketState.lifecycle}`);

  const signal = marketState.signal;
  if (!signal || !signal.usable || signal.effectiveTwap === null) {
    return noSignal(
      input,
      steps,
      signal?.rejectionReason ?? "effective TWAP unavailable",
      signal?.effectiveTwap ?? null,
      marketState.ptb?.value ?? null,
      0,
    );
  }
  const effectiveTwap = signal.effectiveTwap;
  steps.push(`effective-twap:${effectiveTwap}`);

  const ptbSnapshot = marketState.ptb;
  if (!ptbSnapshot || !ptbSnapshot.valid || ptbSnapshot.value === null) {
    return noSignal(
      input,
      steps,
      ptbSnapshot?.rejectionReason ?? "price-to-beat unavailable",
      effectiveTwap,
      null,
      0,
    );
  }
  const ptb = ptbSnapshot.value;
  steps.push(`ptb:${ptb}`);

  const appliedBuffer = resolveBuffer(configuration, ptb);
  steps.push(`buffer:${configuration.bufferMode}:${appliedBuffer}`);

  const delta = roundTo(effectiveTwap - ptb, configuration.precision);
  steps.push(`delta:${delta}`);

  let outcome: Decision["outcome"] = "NO_SIGNAL";
  let rejectionReason: string | null = null;
  if (delta > appliedBuffer) {
    outcome = "BUY_UP";
  } else if (delta < -appliedBuffer) {
    outcome = "BUY_DOWN";
  } else {
    rejectionReason = `|delta| ${Math.abs(delta)} within buffer ${appliedBuffer}`;
  }
  steps.push(`outcome:${outcome}`);

  return freezeDeep(
    decisionSchema.parse({
      outcome,
      effectiveTwap,
      ptb,
      appliedBuffer,
      delta,
      marketStateVersion: marketState.marketStateVersion,
      windowInstanceId: input.windowInstanceId,
      appliedSteps: steps,
      rejectionReason,
    } satisfies Decision),
  );
}
