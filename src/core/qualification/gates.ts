/**
 * ARC — M7.7 qualification gates.
 *
 * Pure gate catalogue and evaluation. The gates describe what must be true
 * before the runtime may be promoted; they never mutate state and never talk
 * to the VPS. Deterministic evidence comes from the qualification scenario,
 * live evidence is supplied by the caller.
 */
import { type QualificationRun } from "./scenario";

export type GateStatus = "PASS" | "FAIL" | "PENDING";

export type GateCategory =
  | "STARTUP"
  | "LIFECYCLE"
  | "MULTI_WINDOW"
  | "REPLAY"
  | "RECOVERY"
  | "CONFIGURATION"
  | "OBSERVABILITY";

export interface QualificationGate {
  id: string;
  category: GateCategory;
  title: string;
  requirement: string;
}

export const QUALIFICATION_GATES: readonly QualificationGate[] = Object.freeze([
  {
    id: "startup.sequence",
    category: "STARTUP",
    title: "Startup sequence completes",
    requirement:
      "Environment validated, market discovered, feed live and windows prepared before the first evaluation.",
  },
  {
    id: "lifecycle.complete",
    category: "LIFECYCLE",
    title: "Full trading lifecycle observed",
    requirement:
      "Market state → decision → intent → risk → exposure → order → fill → settlement, in order, exactly once.",
  },
  {
    id: "lifecycle.settlement",
    category: "LIFECYCLE",
    title: "Settlement releases exposure",
    requirement: "Every settled execution releases its reservation; no exposure is left reserved.",
  },
  {
    id: "multiwindow.ordering",
    category: "MULTI_WINDOW",
    title: "Windows activate by descending offset",
    requirement: "Priority is derived from the offset; the largest offset always activates first.",
  },
  {
    id: "multiwindow.quota",
    category: "MULTI_WINDOW",
    title: "Trade quota is enforced",
    requirement:
      "Once the quota is exhausted no further window may produce an ExecutionIntent for the market instance.",
  },
  {
    id: "replay.deterministic",
    category: "REPLAY",
    title: "Replay is byte-identical",
    requirement: "Re-running the recorded inputs reproduces the same event stream with no drift.",
  },
  {
    id: "recovery.no_duplicate",
    category: "RECOVERY",
    title: "Restart never double-executes",
    requirement: "Re-submitting a recorded execution intent after a restart is suppressed.",
  },
  {
    id: "configuration.dispatch",
    category: "CONFIGURATION",
    title: "Configuration reaches the authority",
    requirement:
      "A published configuration version is acknowledged by the VPS and becomes the active runtime configuration.",
  },
  {
    id: "observability.telemetry",
    category: "OBSERVABILITY",
    title: "Telemetry and events are visible",
    requirement:
      "Authority heartbeat is current and every canonical event is queryable from the console.",
  },
]);

/** Live evidence the deterministic harness cannot produce on its own. */
export interface RuntimeQualificationInputs {
  environmentValidated?: boolean;
  authorityRegistered?: boolean;
  telemetryCurrent?: boolean;
  configurationActive?: boolean;
  replayDeterministic?: boolean;
}

export interface GateResult extends QualificationGate {
  status: GateStatus;
  detail: string;
}

function verdict(condition: boolean | undefined, pass: string, fail: string): [GateStatus, string] {
  if (condition === undefined) return ["PENDING", "Awaiting live evidence from the VPS authority."];
  return condition ? ["PASS", pass] : ["FAIL", fail];
}

const LIFECYCLE_SEQUENCE = [
  "market.state.updated",
  "decision.window.activated",
  "decision.intent.created",
  "trade.risk.approved",
  "trade.exposure.reserved",
  "trade.order.submitted",
  "trade.order.filled",
  "trade.execution.completed",
] as const;

/** True when every step appears at least once, in relative order. */
export function lifecycleSequenceObserved(eventTypes: readonly string[]): boolean {
  let cursor = 0;
  for (const type of eventTypes) {
    if (type === LIFECYCLE_SEQUENCE[cursor]) cursor += 1;
    if (cursor === LIFECYCLE_SEQUENCE.length) return true;
  }
  return false;
}

export function evaluateQualificationGates(
  run: QualificationRun,
  runtime: RuntimeQualificationInputs = {},
): readonly GateResult[] {
  const accepted = run.intents.filter((intent) => intent.submitted === "ACCEPTED");
  const orderingCorrect = run.windowOffsets.every(
    (offset, index) => index === 0 || run.windowOffsets[index - 1]! > offset,
  );
  const settledAll = run.settlements.length === accepted.length && accepted.length > 0;

  const results: GateResult[] = QUALIFICATION_GATES.map((gate) => {
    let status: GateStatus;
    let detail: string;

    switch (gate.id) {
      case "startup.sequence":
        [status, detail] = verdict(
          runtime.environmentValidated,
          "Startup validator passed every gate.",
          "Startup validator reported a failed gate.",
        );
        break;
      case "lifecycle.complete":
        [status, detail] = verdict(
          lifecycleSequenceObserved(run.eventTypes),
          `Observed ${run.eventTypes.length} canonical events across the full lifecycle.`,
          "The canonical lifecycle sequence was not observed end to end.",
        );
        break;
      case "lifecycle.settlement":
        [status, detail] = verdict(
          settledAll && run.exposure.reserved === 0,
          `${run.settlements.length} settlement(s); reserved exposure returned to zero.`,
          "Settlement did not release every reservation.",
        );
        break;
      case "multiwindow.ordering":
        [status, detail] = verdict(
          orderingCorrect && run.windowOffsets.length > 1,
          `Windows ordered by offset: ${run.windowOffsets.map((ms) => `${ms / 1000}s`).join(" → ")}.`,
          "Window activation order does not follow descending offset.",
        );
        break;
      case "multiwindow.quota":
        [status, detail] = verdict(
          run.quotaExhausted,
          `Quota consumed by ${accepted.length} execution intent(s); later windows suppressed.`,
          "Trade quota was not enforced across the window set.",
        );
        break;
      case "replay.deterministic":
        [status, detail] = verdict(
          runtime.replayDeterministic,
          "Replay reproduced the recorded stream with zero mismatches.",
          "Replay produced a mismatch against the recorded stream.",
        );
        break;
      case "recovery.no_duplicate":
        [status, detail] = verdict(
          run.duplicateSuppressed,
          "A replayed execution intent was suppressed as a duplicate.",
          "A replayed execution intent was executed twice.",
        );
        break;
      case "configuration.dispatch":
        [status, detail] = verdict(
          runtime.configurationActive,
          "Published configuration is LIVE on the trading authority.",
          "Published configuration has not been activated by the authority.",
        );
        break;
      default:
        [status, detail] = verdict(
          runtime.telemetryCurrent === undefined && runtime.authorityRegistered === undefined
            ? undefined
            : Boolean(runtime.telemetryCurrent && runtime.authorityRegistered),
          "Authority registered and telemetry heartbeat current.",
          "Authority telemetry is stale or the authority is not registered.",
        );
        break;
    }

    return { ...gate, status, detail };
  });

  return Object.freeze(results);
}

export function qualificationVerdict(results: readonly GateResult[]): GateStatus {
  if (results.some((result) => result.status === "FAIL")) return "FAIL";
  if (results.some((result) => result.status === "PENDING")) return "PENDING";
  return "PASS";
}
