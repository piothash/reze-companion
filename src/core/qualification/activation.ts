/**
 * ARC — M7.9 activation checklist.
 *
 * Pure. Turns the M7.8 live evidence snapshot into the ordered list of actions
 * that still stand between the control plane and a green qualification console.
 *
 * This module decides nothing about trading. It only reports which operational
 * step is next, who owns it (the operator or the VPS trading authority), and
 * what evidence would close it. Steps never self-report DONE without evidence.
 */
import type { LiveEvidenceSnapshot } from "./live-gates";
import { heartbeatFresh, missingTelemetryFields } from "./live-gates";

export type ActivationOwner = "OPERATOR" | "VPS";

/**
 * READY  — nothing blocks it; do it now.
 * BLOCKED — an earlier step must complete first.
 * WAITING — done on this side; awaiting evidence from the authority.
 * DONE   — closed by observed evidence.
 */
export type ActivationStatus = "DONE" | "READY" | "WAITING" | "BLOCKED";

export interface ActivationStep {
  readonly id: string;
  readonly owner: ActivationOwner;
  readonly title: string;
  /** What the operator or engine must do. */
  readonly action: string;
  /** The evidence that closes the step — never a manual tick-box. */
  readonly evidence: string;
  readonly status: ActivationStatus;
  readonly detail: string;
}

export const ACTIVATION_STEP_IDS = [
  "signing-key",
  "ownership",
  "register",
  "heartbeat",
  "startup",
  "configuration",
  "telemetry",
] as const;

export type ActivationStepId = (typeof ACTIVATION_STEP_IDS)[number];

/** Ordered blockers with no evidence yet — the operator's next actions. */
export function pendingActivationSteps(
  steps: readonly ActivationStep[],
): readonly ActivationStep[] {
  return steps.filter((step) => step.status !== "DONE");
}

/** True only when every step is closed by evidence. */
export function activationComplete(steps: readonly ActivationStep[]): boolean {
  return steps.length > 0 && steps.every((step) => step.status === "DONE");
}

export function buildActivationChecklist(
  snapshot: LiveEvidenceSnapshot,
): readonly ActivationStep[] {
  const { authority, telemetry, configuration, security, startup, nowMillis } = snapshot;

  const signingKeyDone = security?.signatureVerificationEnabled === true;
  const ownershipDone = security?.ownershipFinalized === true;
  const registered = authority !== null && authority.status !== "revoked";
  const fresh =
    authority !== null &&
    heartbeatFresh(authority.lastSeenIso, authority.heartbeatIntervalMillis, nowMillis);
  const active = registered && fresh && authority.runtimeIdentity !== null;

  const steps: ActivationStep[] = [
    {
      id: "signing-key",
      owner: "OPERATOR",
      title: "Shared signing key configured on both sides",
      action:
        "Set ARC_AUTHORITY_SIGNING_KEY to the same value on the companion and on the VPS engine.",
      evidence: "Gateway verifies HMAC signatures instead of rejecting with KEY_UNCONFIGURED.",
      status: signingKeyDone ? "DONE" : "READY",
      detail: signingKeyDone
        ? "Signing key present; every authority message is signature-verified."
        : "No signing key configured — the gateway fail-closes and rejects all authority traffic.",
    },
    {
      id: "ownership",
      owner: "OPERATOR",
      title: "Operator ownership finalized",
      action:
        "Sign in as the intended operator and finalize ownership at /ownership. This permanently disables registration.",
      evidence: "ownership_finalized() returns true and an ownership.finalized audit entry exists.",
      status: ownershipDone ? "DONE" : "READY",
      detail: ownershipDone
        ? "Ownership is finalized; signup is permanently closed."
        : "Ownership is not finalized — registration is still open.",
    },
    {
      id: "register",
      owner: "VPS",
      title: "Authority registers with the control plane",
      action:
        "Start the PM2 engine so it POSTs a signed registration to /api/public/authority/register.",
      evidence: "A non-revoked authority row with a runtime identity.",
      status: registered
        ? "DONE"
        : signingKeyDone && ownershipDone
          ? "WAITING"
          : "BLOCKED",
      detail: registered
        ? `Authority ${authority.authorityId} registered in ${authority.environment}.`
        : signingKeyDone && ownershipDone
          ? "Awaiting the first signed registration from the VPS."
          : "Blocked: the signing key and finalized ownership must come first.",
    },
    {
      id: "heartbeat",
      owner: "VPS",
      title: "Authority reports ACTIVE with a fresh heartbeat",
      action: "Let the engine publish heartbeats on its declared interval.",
      evidence: "Heartbeat within 2× the declared interval, runtime identity and latency reported.",
      status: active ? "DONE" : registered ? "WAITING" : "BLOCKED",
      detail: active
        ? `Heartbeat fresh; runtime identity ${authority.runtimeIdentity}.`
        : registered
          ? "Registered, but no fresh heartbeat with a runtime identity yet."
          : "Blocked: the authority must register first.",
    },
    {
      id: "startup",
      owner: "VPS",
      title: "Engine startup chain reported complete",
      action:
        "Let the engine complete configuration → feed → discovery → PTB → TWAP → signal → market state → windows armed.",
      evidence: "Telemetry reports every startup step.",
      status:
        startup?.allowed === true
          ? "DONE"
          : startup && startup.failedGates.length > 0
            ? "WAITING"
            : active
              ? "WAITING"
              : "BLOCKED",
      detail:
        startup?.allowed === true
          ? "Every startup step reported by the authority."
          : startup && startup.failedGates.length > 0
            ? `Unreported step(s): ${startup.failedGates.join(", ")}.`
            : active
              ? "Awaiting startup telemetry from the authority."
              : "Blocked: the authority must be ACTIVE first.",
    },
    {
      id: "configuration",
      owner: "OPERATOR",
      title: "Configuration activation round-trip",
      action:
        "Publish an execution profile version and let the engine pull, hash-validate and ACCEPT it.",
      evidence: "Runtime status LIVE with a matching config hash, a snapshot id and no drift.",
      status:
        configuration?.live === true &&
        configuration.drift === false &&
        configuration.runtimeConfigHash !== null &&
        configuration.runtimeConfigHash === configuration.publishedConfigHash
          ? "DONE"
          : active
            ? "READY"
            : "BLOCKED",
      detail: configuration
        ? configuration.drift
          ? "Runtime configuration has drifted from the published version."
          : configuration.live
            ? `Runtime version ${configuration.runtimeVersion ?? "—"} vs published ${configuration.publishedVersion ?? "—"}.`
            : `Runtime status ${configuration.runtimeStatus ?? "unknown"} — not yet LIVE.`
        : active
          ? "No configuration version has reached the authority yet."
          : "Blocked: the authority must be ACTIVE first.",
    },
    {
      id: "telemetry",
      owner: "VPS",
      title: "Telemetry complete and current",
      action: "Let the engine publish full telemetry on its sync interval.",
      evidence:
        "Live telemetry within the sync budget carrying every mandated field.",
      status:
        active && telemetry?.source === "LIVE" && missingTelemetryFields(authority).length === 0
          ? "DONE"
          : active
            ? "WAITING"
            : "BLOCKED",
      detail:
        telemetry?.source === "LIVE"
          ? missingTelemetryFields(authority).length === 0
            ? "All mandated telemetry fields reported."
            : `Missing field(s): ${missingTelemetryFields(authority).join(", ")}.`
          : active
            ? `Telemetry source is ${telemetry?.source ?? "NONE"} — live telemetry required.`
            : "Blocked: the authority must be ACTIVE first.",
    },
  ];

  return steps;
}
