/**
 * ARC — M8.1 operator incident model.
 *
 * Pure. Turns evidence gaps into operator-actionable incidents. Every incident
 * carries the same five fields, because a production console must never show a
 * bare failure string:
 *
 *   problem          — what is wrong, in one line
 *   reason           — why the control plane believes that
 *   missingEvidence  — the observation that would settle it
 *   requiredAction   — what the operator does next, on which machine
 *   expectedRecovery — what changes on screen once the action worked
 *
 * Nothing here trades, restarts or repairs anything. The VPS remains the sole
 * trading authority (charter §Hybrid, ADR-0001); the console only explains.
 */
import {
  deriveAuthorityDisplay,
  formatHeartbeatAge,
  type AuthorityDisplay,
} from "./authority-presentation";
import {
  deriveConfigurationActivation,
  type ConfigurationActivation,
} from "./configuration-activation";
import type { LiveEvidenceSnapshot } from "../qualification/live-gates";
import { STARTUP_CHAIN_STEPS, STARTUP_STEP_LABELS } from "../qualification/live-gates";

export type IncidentSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface OperatorIncident {
  readonly id: string;
  readonly severity: IncidentSeverity;
  readonly area: "AUTHORITY" | "CONFIGURATION" | "STARTUP" | "SECURITY" | "TELEMETRY";
  readonly problem: string;
  readonly reason: string;
  readonly missingEvidence: string;
  readonly requiredAction: string;
  readonly expectedRecovery: string;
}

/** Startup step as the operations console displays it. */
export type StartupStepStatus = "PASS" | "WAITING" | "FAILED";

export interface StartupStepView {
  readonly step: string;
  readonly label: string;
  readonly status: StartupStepStatus;
}

export interface OperationsDiagnostics {
  readonly authority: AuthorityDisplay;
  readonly configuration: ConfigurationActivation;
  readonly startup: readonly StartupStepView[];
  readonly startupComplete: boolean;
  readonly incidents: readonly OperatorIncident[];
}

function seconds(millis: number | null): string {
  if (millis === null) return "never";
  return `${Math.round(millis / 1000)} seconds`;
}

/**
 * The startup chain as the operator sees it. A step the authority never
 * reported is WAITING, not FAILED: silence is not a failure verdict. A step is
 * only FAILED when the authority reported it as not ok while a later step in
 * the chain did report ok, which means the engine moved past a broken stage.
 */
export function deriveStartupSteps(
  startup: LiveEvidenceSnapshot["startup"],
): readonly StartupStepView[] {
  const reported = new Map<string, boolean>(
    (startup?.steps ?? []).map((entry) => [entry.step, entry.ok]),
  );
  const lastOkIndex = STARTUP_CHAIN_STEPS.reduce(
    (last, step, index) => (reported.get(step) === true ? index : last),
    -1,
  );

  return Object.freeze(
    STARTUP_CHAIN_STEPS.map((step, index): StartupStepView => {
      const value = reported.get(step);
      if (value === true) return { step, label: STARTUP_STEP_LABELS[step], status: "PASS" };
      const failed = value === false && index < lastOkIndex;
      return {
        step,
        label: STARTUP_STEP_LABELS[step],
        status: failed ? "FAILED" : "WAITING",
      };
    }),
  );
}

function authorityIncidents(
  snapshot: LiveEvidenceSnapshot,
  display: AuthorityDisplay,
): OperatorIncident[] {
  const out: OperatorIncident[] = [];

  if (display.status === "UNREGISTERED") {
    out.push({
      id: "authority.unregistered",
      severity: "CRITICAL",
      area: "AUTHORITY",
      problem: "No trading authority has registered with the control plane.",
      reason:
        "The authority registry holds no non-revoked row, so no VPS engine has completed a signed registration.",
      missingEvidence: "A signed POST to /api/public/authority/register with a runtime identity.",
      requiredAction:
        "Start the engine on the VPS with PM2 and confirm it points at this control plane URL.",
      expectedRecovery:
        "The authority appears in Engine Registry as STALE, then turns ACTIVE on its first verified heartbeat.",
    });
    return out;
  }

  if (display.status === "REVOKED") {
    out.push({
      id: "authority.revoked",
      severity: "CRITICAL",
      area: "AUTHORITY",
      problem: "The registered trading authority is revoked.",
      reason: "An operator revoked this authority, so it may not trade and its telemetry is ignored.",
      missingEvidence: "A fresh registration from an authority that is not revoked.",
      requiredAction:
        "Rotate the signing key on the VPS and register the engine again under a new authority id.",
      expectedRecovery: "A new authority row appears and reaches ACTIVE after its first heartbeat.",
    });
    return out;
  }

  if (display.status === "STALE") {
    const age = display.heartbeatAgeMillis;
    out.push({
      id: "authority.heartbeat",
      severity: "CRITICAL",
      area: "AUTHORITY",
      problem: "Authority heartbeat missing.",
      reason:
        age === null
          ? "The authority registered but has never sent a verified heartbeat."
          : `No heartbeat received in ${seconds(age)}; the stale threshold is ${seconds(display.heartbeatDeadlineMillis)}.`,
      missingEvidence: `A signed heartbeat newer than ${formatHeartbeatAge(display.heartbeatDeadlineMillis)}.`,
      requiredAction:
        "On the VPS, check `pm2 status`, restart the engine if it is not online, and confirm outbound network access to the control plane.",
      expectedRecovery: "The authority returns to ACTIVE after the next verified heartbeat.",
    });
  }

  if (snapshot.authority && snapshot.authority.latencyMillis === null) {
    out.push({
      id: "authority.latency",
      severity: "WARNING",
      area: "TELEMETRY",
      problem: "Heartbeat latency is not reported.",
      reason: "The authority's heartbeat payload carries no measured round-trip latency.",
      missingEvidence: "A latencyMillis field on the heartbeat payload.",
      requiredAction: "Upgrade the engine to a build that reports heartbeat latency.",
      expectedRecovery: "Latency appears on the authority panel and the telemetry gate closes.",
    });
  }

  return out;
}

function configurationIncidents(
  activation: ConfigurationActivation,
  configuration: LiveEvidenceSnapshot["configuration"],
): OperatorIncident[] {
  switch (activation.state) {
    case "NOT_PUBLISHED":
      return [
        {
          id: "configuration.not_published",
          severity: "WARNING",
          area: "CONFIGURATION",
          problem: "No configuration version has been published.",
          reason: "The control plane holds no stored configuration version for the authority to pull.",
          missingEvidence: "A published, hashed configuration version.",
          requiredAction: "Publish the execution profile from Execution Profiles.",
          expectedRecovery: "The version appears as PENDING until the authority pulls and applies it.",
        },
      ];
    case "PENDING":
      return [
        {
          id: "configuration.pending",
          severity: "WARNING",
          area: "CONFIGURATION",
          problem: "The published configuration is not active on the authority.",
          reason: activation.detail,
          missingEvidence:
            "A live read from the authority reporting the published hash and a snapshot id.",
          requiredAction:
            "Confirm the engine is running and can reach the control plane; it pulls configuration on its sync interval.",
          expectedRecovery: "The configuration state moves PENDING → ACCEPTED → ACTIVE.",
        },
      ];
    case "REJECTED":
      return [
        {
          id: "configuration.rejected",
          severity: "CRITICAL",
          area: "CONFIGURATION",
          problem: "The trading authority rejected the published configuration.",
          reason: activation.detail,
          missingEvidence: "An accepted version with a matching hash.",
          requiredAction:
            "Fix the rejected values in Execution Profiles and publish a new version; versions are immutable and are never edited in place.",
          expectedRecovery: "The new version is accepted and reaches ACTIVE.",
        },
      ];
    case "DRIFTED":
      return [
        {
          id: "configuration.drift",
          severity: "CRITICAL",
          area: "CONFIGURATION",
          problem: "The authority is running a configuration that was not published here.",
          reason: `Runtime hash ${configuration?.runtimeConfigHash ?? "unknown"} does not match published hash ${configuration?.publishedConfigHash ?? "unknown"}.`,
          missingEvidence: "A live read where the runtime hash equals the published hash.",
          requiredAction:
            "Republish the intended version from Execution Profiles. Never edit runtime configuration on the VPS by hand.",
          expectedRecovery: "Drift clears and the configuration returns to ACTIVE.",
        },
      ];
    default:
      return [];
  }
}

function securityIncidents(security: LiveEvidenceSnapshot["security"]): OperatorIncident[] {
  const out: OperatorIncident[] = [];
  if (!security) return out;

  if (!security.signatureVerificationEnabled) {
    out.push({
      id: "security.signing_key",
      severity: "CRITICAL",
      area: "SECURITY",
      problem: "Authority handshakes are not signature-verified.",
      reason:
        "No shared signing key is configured, so the gateway fail-closes and refuses every authority message with KEY_UNCONFIGURED.",
      missingEvidence: "A configured ARC_AUTHORITY_SIGNING_KEY on the control plane and the engine.",
      requiredAction:
        "Set the same 32+ character key as ARC_AUTHORITY_SIGNING_KEY on the control plane and on the VPS engine.",
      expectedRecovery:
        "System → Authority Signing shows CONFIGURED and registrations are accepted instead of refused.",
    });
  }

  if (!security.ownershipFinalized) {
    out.push({
      id: "security.ownership",
      severity: "CRITICAL",
      area: "SECURITY",
      problem: "Operator ownership is not finalized.",
      reason: "Registration is still open, so an unintended account could still claim the control plane.",
      missingEvidence: "ownership_finalized() returning true and an ownership.finalized audit entry.",
      requiredAction: "Sign in as the intended operator and finalize ownership on the Ownership page.",
      expectedRecovery: "Registration closes permanently and the security gate stops failing.",
    });
  }

  return out;
}

function telemetryIncidents(telemetry: LiveEvidenceSnapshot["telemetry"]): OperatorIncident[] {
  if (!telemetry) {
    return [
      {
        id: "telemetry.absent",
        severity: "WARNING",
        area: "TELEMETRY",
        problem: "No runtime telemetry has been read.",
        reason: "The control plane has no live or mirrored telemetry record for the engine.",
        missingEvidence: "A telemetry read from the authority.",
        requiredAction: "Start the engine and confirm its telemetry endpoint is reachable.",
        expectedRecovery: "Live telemetry populates the dashboard and the telemetry gate closes.",
      },
    ];
  }

  if (telemetry.missingFields.length > 0) {
    return [
      {
        id: "telemetry.incomplete",
        severity: "WARNING",
        area: "TELEMETRY",
        problem: "Telemetry is incomplete.",
        reason: `The authority did not report: ${telemetry.missingFields.join(", ")}.`,
        missingEvidence: "All mandated telemetry fields on one current heartbeat.",
        requiredAction: "Upgrade the engine to a build that reports every mandated telemetry field.",
        expectedRecovery: "The telemetry gate reports complete and current.",
      },
    ];
  }

  if (telemetry.source !== "LIVE") {
    return [
      {
        id: "telemetry.mirrored",
        severity: "INFO",
        area: "TELEMETRY",
        problem: "Telemetry is mirrored, not live.",
        reason: `The last read came from ${telemetry.source}, so the values are the newest stored copy rather than a live authority read.`,
        missingEvidence: "A successful live read from the authority endpoint.",
        requiredAction: "Check that the engine's telemetry endpoint is reachable from the control plane.",
        expectedRecovery: "The telemetry source reads LIVE.",
      },
    ];
  }

  return [];
}

function startupIncident(steps: readonly StartupStepView[]): OperatorIncident[] {
  const failed = steps.find((step) => step.status === "FAILED");
  if (failed) {
    return [
      {
        id: "startup.failed",
        severity: "CRITICAL",
        area: "STARTUP",
        problem: `The engine startup chain failed at "${failed.label}".`,
        reason: "The authority reported this stage as not ok while a later stage reported ok.",
        missingEvidence: `An engine report where ${failed.label} is ok.`,
        requiredAction:
          "Read the engine log for this stage on the VPS (`pm2 logs`), fix the underlying cause and restart the engine.",
        expectedRecovery: "The startup chain reports PASS for every stage.",
      },
    ];
  }

  const waiting = steps.filter((step) => step.status === "WAITING");
  if (waiting.length === steps.length) {
    return [
      {
        id: "startup.absent",
        severity: "WARNING",
        area: "STARTUP",
        problem: "No startup chain has been reported.",
        reason: "The authority has not published startup progress, so no stage can be shown as complete.",
        missingEvidence: "Engine telemetry describing the startup chain.",
        requiredAction: "Start the engine on the VPS and confirm it reports telemetry.",
        expectedRecovery: "Startup stages turn PASS in order as the engine boots.",
      },
    ];
  }

  return [];
}

const SEVERITY_ORDER: Record<IncidentSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

/**
 * Full operations diagnostics for the `/operations` console. Derived purely
 * from reported evidence: an empty incident list means every observation the
 * control plane can make is healthy, not that trading is safe.
 */
export function deriveOperationsDiagnostics(
  snapshot: LiveEvidenceSnapshot,
): OperationsDiagnostics {
  const authority = deriveAuthorityDisplay(
    snapshot.authority
      ? {
          status: snapshot.authority.status,
          lastSeenIso: snapshot.authority.lastSeenIso,
          heartbeatIntervalMillis: snapshot.authority.heartbeatIntervalMillis,
          runtimeIdentity: snapshot.authority.runtimeIdentity,
          signatureVerified: snapshot.security?.signatureVerificationEnabled === true,
        }
      : null,
    snapshot.nowMillis,
  );

  const configuration = deriveConfigurationActivation({
    latestVersion: snapshot.configuration?.publishedVersion
      ? {
          version: snapshot.configuration.publishedVersion,
          status: "ACTIVE",
          configHash: snapshot.configuration.publishedConfigHash ?? "",
          rejectionReason: null,
        }
      : null,
    runtime: snapshot.configuration
      ? {
          live: snapshot.configuration.live,
          runtimeStatus: snapshot.configuration.runtimeStatus ?? "UNKNOWN",
          configHash: snapshot.configuration.runtimeConfigHash,
          snapshotId: snapshot.configuration.runtimeSnapshotId,
          version: snapshot.configuration.runtimeVersion,
        }
      : null,
    drifted: snapshot.configuration?.drift === true,
  });

  const startup = deriveStartupSteps(snapshot.startup);

  const incidents = [
    ...authorityIncidents(snapshot, authority),
    ...configurationIncidents(configuration, snapshot.configuration),
    ...startupIncident(startup),
    ...securityIncidents(snapshot.security),
    ...telemetryIncidents(snapshot.telemetry),
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    authority,
    configuration,
    startup,
    startupComplete: startup.every((step) => step.status === "PASS"),
    incidents: Object.freeze(incidents),
  };
}
