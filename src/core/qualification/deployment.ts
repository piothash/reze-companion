/**
 * ARC — M8.1 deployment checklist.
 *
 * Pure and read-only. Restates the evidence the other layers already produced
 * as the four questions an operator asks before a deployment: is the
 * environment wired, is the VPS up, is trading configured, did qualification
 * pass. Nothing is tickable — every item closes on observed evidence only.
 */
import type { LiveEvidenceSnapshot } from "./live-gates";
import type { DomainStatus, MainnetDomainResult, MainnetVerdict } from "./mainnet";
import { deriveAuthorityDisplay } from "../platform/authority-presentation";
import { deriveOperationsDiagnostics } from "../platform/operator-incident";

export type ChecklistStatus = "PASS" | "PENDING" | "FAIL";

export const DEPLOYMENT_SECTIONS = [
  "ENVIRONMENT",
  "VPS",
  "TRADING READINESS",
  "QUALIFICATION",
] as const;

export type DeploymentSection = (typeof DEPLOYMENT_SECTIONS)[number];

export interface DeploymentCheck {
  readonly id: string;
  readonly section: DeploymentSection;
  readonly label: string;
  readonly status: ChecklistStatus;
  readonly detail: string;
}

export interface DeploymentChecklistInput {
  readonly snapshot: LiveEvidenceSnapshot | null;
  /** True when the control plane answered a backend read at all. */
  readonly backendReachable: boolean;
  readonly mainnet: readonly MainnetDomainResult[];
  readonly verdict: MainnetVerdict;
}

function fromDomain(results: readonly MainnetDomainResult[], domain: string): ChecklistStatus {
  const found = results.find((result) => result.domain === domain);
  if (!found) return "PENDING";
  const status: DomainStatus = found.status;
  return status;
}

function domainDetail(results: readonly MainnetDomainResult[], domain: string): string {
  const found = results.find((result) => result.domain === domain);
  if (!found) return "Not evaluated yet.";
  if (found.status === "PASS") return found.evidence[0] ?? found.requirement;
  return found.blockers[0] ?? "Awaiting evidence.";
}

export function buildDeploymentChecklist(
  input: DeploymentChecklistInput,
): readonly DeploymentCheck[] {
  const { snapshot, mainnet } = input;
  const diagnostics = snapshot ? deriveOperationsDiagnostics(snapshot) : null;
  const authority = snapshot
    ? deriveAuthorityDisplay(
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
      )
    : null;

  const checks: DeploymentCheck[] = [
    {
      id: "env.backend",
      section: "ENVIRONMENT",
      label: "Backend connected",
      status: input.backendReachable ? "PASS" : "FAIL",
      detail: input.backendReachable
        ? "The control plane answered a backend read for this session."
        : "The control plane could not read the backend. Check the backend connection on System.",
    },
    {
      id: "env.auth",
      section: "ENVIRONMENT",
      label: "Authentication configured",
      status: snapshot?.security?.ownershipFinalized ? "PASS" : "PENDING",
      detail: snapshot?.security?.ownershipFinalized
        ? "Operator ownership is finalized and registration is closed."
        : "Ownership is not finalized, so registration is still open. Finalize it on Ownership.",
    },
    {
      id: "env.authority_key",
      section: "ENVIRONMENT",
      label: "Authority configured",
      status: snapshot?.security?.signatureVerificationEnabled ? "PASS" : "FAIL",
      detail: snapshot?.security?.signatureVerificationEnabled
        ? "A shared signing key is present, so authority handshakes are signature-verified."
        : "No shared signing key is configured; the gateway refuses every authority message.",
    },
    {
      id: "vps.registered",
      section: "VPS",
      label: "Registered",
      status: authority && authority.status !== "UNREGISTERED" ? "PASS" : "PENDING",
      detail:
        authority && authority.status !== "UNREGISTERED"
          ? `An authority is registered and reads ${authority.status}.`
          : "No authority has registered with the control plane yet.",
    },
    {
      id: "vps.heartbeat",
      section: "VPS",
      label: "Heartbeat active",
      status: authority?.status === "ACTIVE" ? "PASS" : "PENDING",
      detail:
        authority?.status === "ACTIVE"
          ? "A verified heartbeat arrived inside the stale threshold."
          : (authority?.blockers[0] ?? "No verified heartbeat received."),
    },
    {
      id: "vps.runtime",
      section: "VPS",
      label: "Runtime healthy",
      status: snapshot?.authority?.runtimeIdentity ? "PASS" : "PENDING",
      detail: snapshot?.authority?.runtimeIdentity
        ? `Runtime identity ${snapshot.authority.runtimeIdentity} reported.`
        : "The authority has not reported a runtime identity.",
    },
    {
      id: "trading.configuration",
      section: "TRADING READINESS",
      label: "Configuration active",
      status:
        diagnostics?.configuration.state === "ACTIVE"
          ? "PASS"
          : diagnostics?.configuration.state === "REJECTED" ||
              diagnostics?.configuration.state === "DRIFTED"
            ? "FAIL"
            : "PENDING",
      detail: diagnostics?.configuration.detail ?? "No configuration evidence yet.",
    },
    {
      id: "trading.startup",
      section: "TRADING READINESS",
      label: "Startup complete",
      status: diagnostics?.startupComplete
        ? "PASS"
        : diagnostics?.startup.some((step) => step.status === "FAILED")
          ? "FAIL"
          : "PENDING",
      detail: diagnostics
        ? `${diagnostics.startup.filter((step) => step.status === "PASS").length}/${diagnostics.startup.length} startup stages reported by the authority.`
        : "No startup evidence yet.",
    },
    {
      id: "trading.telemetry",
      section: "TRADING READINESS",
      label: "Telemetry available",
      status:
        snapshot?.telemetry && snapshot.telemetry.missingFields.length === 0 ? "PASS" : "PENDING",
      detail: snapshot?.telemetry
        ? snapshot.telemetry.missingFields.length === 0
          ? `Telemetry source ${snapshot.telemetry.source}; every mandated field reported.`
          : `Missing: ${snapshot.telemetry.missingFields.join(", ")}.`
        : "No telemetry has been read.",
    },
    {
      id: "qualification.replay",
      section: "QUALIFICATION",
      label: "Replay PASS",
      status: fromDomain(mainnet, "REPLAY"),
      detail: domainDetail(mainnet, "REPLAY"),
    },
    {
      id: "qualification.recovery",
      section: "QUALIFICATION",
      label: "Recovery PASS",
      status: fromDomain(mainnet, "RECOVERY"),
      detail: domainDetail(mainnet, "RECOVERY"),
    },
    {
      id: "qualification.security",
      section: "QUALIFICATION",
      label: "Security PASS",
      status: fromDomain(mainnet, "SECURITY"),
      detail: domainDetail(mainnet, "SECURITY"),
    },
    {
      id: "qualification.mainnet",
      section: "QUALIFICATION",
      label: "Mainnet gate",
      status: input.verdict === "QUALIFIED FOR MAINNET" ? "PASS" : "PENDING",
      detail:
        input.verdict === "QUALIFIED FOR MAINNET"
          ? "Every production domain reports PASS on observed evidence."
          : `${mainnet.filter((result) => result.status === "PASS").length}/${mainnet.length} domains PASS — the gate stays closed.`,
    },
  ];

  return Object.freeze(checks);
}

/** True only when every check reads PASS. There is no override. */
export function deploymentReady(checks: readonly DeploymentCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status === "PASS");
}
