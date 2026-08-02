/**
 * ARC — M7.9 activation checklist, M7.10 diagnostics.
 *
 * Pure. Turns the M7.8 live evidence snapshot into the ordered list of actions
 * that still stand between the control plane and a green qualification console.
 *
 * This module decides nothing about trading. It only reports which operational
 * step is next, who owns it (the operator or the VPS trading authority), and
 * what evidence would close it. Steps never self-report DONE without evidence.
 *
 * Every step carries full diagnostics: current state, the evidence that is
 * missing, the required action, and the transition that will follow.
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
  /** Why the step is in its current state, in operator language. */
  readonly reason: string;
  /** The concrete call, page or command that produces the missing evidence. */
  readonly required: string;
  /** What the console will show once the evidence arrives. */
  readonly transition: string;
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
  const prerequisites = signingKeyDone && ownershipDone;
  const registered = authority !== null && authority.status !== "revoked";
  const fresh =
    authority !== null &&
    heartbeatFresh(authority.lastSeenIso, authority.heartbeatIntervalMillis, nowMillis);
  const active = registered && fresh && authority.runtimeIdentity !== null;
  const missingTelemetry = missingTelemetryFields(authority);

  const blockedBy = (what: string) => `Blocked: ${what}`;

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
      reason: signingKeyDone
        ? "The gateway reports signature verification is enforced."
        : "No shared signing key is present, so every authority message is refused with KEY_UNCONFIGURED.",
      required: "Set ARC_AUTHORITY_SIGNING_KEY (32+ chars) on the companion and the VPS engine.",
      transition: "Authority Signing on the System page turns to CONFIGURED.",
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
      reason: ownershipDone
        ? "Ownership is finalized and registration is permanently closed."
        : "Ownership is still open, so an unintended account could still claim the control plane.",
      required: "Finalize ownership on the Ownership page as the intended operator account.",
      transition: "Registration closes permanently and the security gate stops failing.",
    },
    {
      id: "register",
      owner: "VPS",
      title: "Authority registers with the control plane",
      action:
        "Start the PM2 engine so it POSTs a signed registration to /api/public/authority/register.",
      evidence: "A non-revoked authority row with a runtime identity.",
      status: registered ? "DONE" : prerequisites ? "WAITING" : "BLOCKED",
      detail: registered
        ? `Authority ${authority.authorityId} registered in ${authority.environment}.`
        : prerequisites
          ? "Awaiting the first signed registration from the VPS."
          : blockedBy("the signing key and finalized ownership must come first."),
      reason: registered
        ? `Authority ${authority.authorityId} holds a non-revoked registry row.`
        : prerequisites
          ? "No verified VPS authority registration has been received."
          : "The signing key and finalized ownership are prerequisites and are not both in place.",
      required: "POST /api/public/authority/register — signed by the engine on boot.",
      transition: "Engine Registry shows the authority; the heartbeat step opens.",
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
          : blockedBy("the authority must register first."),
      reason: active
        ? "A verified heartbeat arrived inside the declared interval with a runtime identity."
        : registered
          ? authority.runtimeIdentity === null
            ? "The authority has not reported a runtime identity."
            : "No verified VPS authority heartbeat received inside the declared interval."
          : "No authority is registered, so no heartbeat can be verified.",
      required: "POST /api/public/authority/heartbeat — on the engine's declared interval.",
      transition: "Engine Registry status moves from STALE to ACTIVE.",
    },
    {
      id: "startup",
      owner: "VPS",
      title: "Engine startup chain reported complete",
      action:
        "Let the engine complete configuration → feed → discovery → PTB → TWAP → signal → market state → windows armed.",
      evidence: "Telemetry reports every startup step.",
      status: startup?.allowed === true ? "DONE" : active ? "WAITING" : "BLOCKED",
      detail:
        startup?.allowed === true
          ? "Every startup step reported by the authority."
          : startup && startup.failedGates.length > 0
            ? `Unreported step(s): ${startup.failedGates.join(", ")}.`
            : active
              ? "Awaiting startup telemetry from the authority."
              : blockedBy("the authority must be ACTIVE first."),
      reason:
        startup?.allowed === true
          ? "The authority reported every step of the startup chain."
          : startup && startup.failedGates.length > 0
            ? `The authority has not reported: ${startup.failedGates.join(", ")}.`
            : active
              ? "No startup telemetry has been received from the authority."
              : "The authority is not ACTIVE, so no startup evidence can be trusted.",
      required: "Engine telemetry covering all eight startup steps on the Startup Evidence panel.",
      transition: "Startup Evidence turns fully green and the startup gate passes.",
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
          : blockedBy("the authority must be ACTIVE first."),
      reason: !active
        ? "The authority is not ACTIVE, so it cannot confirm a configuration."
        : configuration?.drift
          ? "The running configuration hash does not match the published version."
          : configuration?.live === true
            ? "The authority has not confirmed the published version as LIVE."
            : "No live configuration read has been answered by the authority.",
      required: "Publish an execution profile version, then let the engine pull and ACCEPT it.",
      transition: "Configuration activation moves PENDING → ACCEPTED → ACTIVE.",
    },
    {
      id: "telemetry",
      owner: "VPS",
      title: "Telemetry complete and current",
      action: "Let the engine publish full telemetry on its sync interval.",
      evidence: "Live telemetry within the sync budget carrying every mandated field.",
      status:
        active && telemetry?.source === "LIVE" && missingTelemetry.length === 0
          ? "DONE"
          : active
            ? "WAITING"
            : "BLOCKED",
      detail:
        telemetry?.source === "LIVE"
          ? missingTelemetry.length === 0
            ? "All mandated telemetry fields reported."
            : `Missing field(s): ${missingTelemetry.join(", ")}.`
          : active
            ? `Telemetry source is ${telemetry?.source ?? "NONE"} — live telemetry required.`
            : blockedBy("the authority must be ACTIVE first."),
      reason: !active
        ? "The authority is not ACTIVE, so its telemetry cannot be trusted."
        : telemetry?.source !== "LIVE"
          ? `Telemetry is ${telemetry?.source ?? "NONE"} rather than a live read.`
          : missingTelemetry.length > 0
            ? `The authority did not report: ${missingTelemetry.join(", ")}.`
            : "All mandated telemetry fields arrived on a current heartbeat.",
      required: "Engine telemetry carrying all eight mandated fields on its sync interval.",
      transition: "The telemetry gate passes and the dashboard shows live values.",
    },
  ];

  return steps;
}
