/**
 * ARC — M7.8 live authority qualification gates.
 *
 * Pure evaluation over a normalized evidence snapshot. The deterministic
 * harness (M7.7) proves the engines; these gates prove the *live* VPS trading
 * authority: registration, startup chain, configuration activation, telemetry
 * freshness and control-plane security posture.
 *
 * Absence of evidence is PENDING — never PASS, never FAIL. The companion
 * observes only; it never trades (charter §Hybrid, ADR-0001).
 */
import { AUTHORITY_STALE_AFTER_MILLIS } from "../platform/authority-registration";

export type LiveGateStatus = "PASS" | "FAIL" | "PENDING";

export const LIVE_GATE_IDS = [
  "authority.active",
  "startup.chain",
  "configuration.activation",
  "telemetry.complete",
  "security.posture",
] as const;

export type LiveGateId = (typeof LIVE_GATE_IDS)[number];

export interface LiveGate {
  readonly id: LiveGateId;
  readonly category: string;
  readonly title: string;
  readonly requirement: string;
}

export const LIVE_GATES: readonly LiveGate[] = Object.freeze([
  {
    id: "authority.active",
    category: "AUTHORITY",
    title: "VPS authority is ACTIVE",
    requirement:
      "Registered authority reports ACTIVE with a runtime identity, a fresh heartbeat and a measured latency.",
  },
  {
    id: "startup.chain",
    category: "STARTUP",
    title: "Startup chain completes",
    requirement:
      "Configuration → feed → discovery → PTB → TWAP → signal → market state → windows armed, with no failed gate.",
  },
  {
    id: "configuration.activation",
    category: "CONFIGURATION",
    title: "Configuration activation round-trip",
    requirement:
      "The published version is LIVE on the authority with a matching config hash and snapshot id, and no drift.",
  },
  {
    id: "telemetry.complete",
    category: "TELEMETRY",
    title: "Telemetry is complete and current",
    requirement:
      "Heartbeat, engine version, runtime identity, active market, active windows, event sequence, configuration version and latency are all reported and fresh.",
  },
  {
    id: "security.posture",
    category: "SECURITY",
    title: "Control-plane security posture",
    requirement:
      "Handshakes are signature-verified, operator ownership is finalized and no secret material is stored in the registry.",
  },
] as const);

// ---------------------------------------------------------------------------
// Evidence snapshot
// ---------------------------------------------------------------------------

export interface AuthorityEvidence {
  readonly authorityId: string;
  readonly environment: string;
  readonly status: string;
  readonly runtimeStatus: string;
  readonly runtimeIdentity: string | null;
  readonly engineVersion: string | null;
  readonly lastSeenIso: string | null;
  readonly heartbeatIntervalMillis: number;
  readonly latencyMillis: number | null;
  readonly activeMarket: string | null;
  readonly activeWindows: number | null;
  readonly eventSequence: number | null;
  readonly configurationVersion: number | null;
}

export interface StartupEvidence {
  readonly allowed: boolean;
  readonly failedGates: readonly string[];
  readonly warnings: readonly string[];
  /** Ordered VPS startup chain, in the order M7.8 mandates. */
  readonly steps?: readonly { readonly step: string; readonly ok: boolean }[];
}

/** The engine startup chain the authority must have completed, in order. */
export const STARTUP_CHAIN_STEPS = [
  "configuration-loaded",
  "feed-connected",
  "market-discovery-ready",
  "ptb-available",
  "twap-running",
  "signal-conditioning-ready",
  "authoritative-market-state",
  "windows-armed",
] as const;

export interface StartupChainInput {
  readonly configurationVersion: number | null;
  readonly feedConnected: boolean | null;
  readonly marketCount: number;
  readonly ptb: number | null;
  readonly runningTwap: number | null;
  readonly effectiveTwap: number | null;
  readonly marketStateVersion: number | null;
  readonly armedWindows: number;
}

/**
 * Derives the startup chain from what the authority reports. The companion
 * never infers a step it was not told about — an unreported step is not ok.
 */
export function deriveStartupChain(input: StartupChainInput | null): StartupEvidence | null {
  if (!input) return null;
  const ok: Record<(typeof STARTUP_CHAIN_STEPS)[number], boolean> = {
    "configuration-loaded": input.configurationVersion !== null,
    "feed-connected": input.feedConnected === true,
    "market-discovery-ready": input.marketCount > 0,
    "ptb-available": input.ptb !== null,
    "twap-running": input.runningTwap !== null,
    "signal-conditioning-ready": input.effectiveTwap !== null,
    "authoritative-market-state": input.marketStateVersion !== null,
    "windows-armed": input.armedWindows > 0,
  };
  const steps = STARTUP_CHAIN_STEPS.map((step) => ({ step, ok: ok[step] }));
  const failedGates = steps.filter((entry) => !entry.ok).map((entry) => entry.step);
  return { allowed: failedGates.length === 0, failedGates, warnings: [], steps };
}

export interface ConfigurationEvidence {
  readonly live: boolean;
  readonly runtimeStatus: string | null;
  readonly runtimeConfigHash: string | null;
  readonly runtimeSnapshotId: string | null;
  readonly runtimeVersion: number | null;
  readonly publishedConfigHash: string | null;
  readonly publishedVersion: number | null;
  readonly drift: boolean;
}

export interface TelemetryEvidence {
  readonly source: "LIVE" | "MIRRORED" | "NONE";
  readonly emittedAtIso: string | null;
  readonly syncIntervalMillis: number;
  readonly missingFields: readonly string[];
}

export interface SecurityEvidence {
  readonly signatureVerificationEnabled: boolean;
  readonly ownershipFinalized: boolean;
  readonly secretMaterialRejected: boolean;
}

export interface LiveEvidenceSnapshot {
  readonly nowMillis: number;
  readonly authority: AuthorityEvidence | null;
  readonly startup: StartupEvidence | null;
  readonly configuration: ConfigurationEvidence | null;
  readonly telemetry: TelemetryEvidence | null;
  readonly security: SecurityEvidence | null;
}

export interface LiveGateResult extends LiveGate {
  readonly status: LiveGateStatus;
  readonly detail: string;
}

const PENDING_DETAIL = "Awaiting live evidence from the VPS trading authority.";

/** Telemetry fields M7.8 requires the authority to publish on every heartbeat. */
export const REQUIRED_TELEMETRY_FIELDS = [
  "heartbeat",
  "engineVersion",
  "runtimeIdentity",
  "activeMarket",
  "activeWindows",
  "eventSequence",
  "configurationVersion",
  "latency",
] as const;

/** Fields the authority failed to report, in the canonical M7.8 order. */
export function missingTelemetryFields(authority: AuthorityEvidence | null): readonly string[] {
  if (!authority) return [...REQUIRED_TELEMETRY_FIELDS];
  const present: Record<(typeof REQUIRED_TELEMETRY_FIELDS)[number], boolean> = {
    heartbeat: authority.lastSeenIso !== null,
    engineVersion: Boolean(authority.engineVersion),
    runtimeIdentity: Boolean(authority.runtimeIdentity),
    activeMarket: authority.activeMarket !== null,
    activeWindows: authority.activeWindows !== null,
    eventSequence: authority.eventSequence !== null,
    configurationVersion: authority.configurationVersion !== null,
    latency: authority.latencyMillis !== null,
  };
  return REQUIRED_TELEMETRY_FIELDS.filter((field) => !present[field]);
}

/** Heartbeat age in milliseconds, or null when the authority never reported. */
export function heartbeatAgeMillis(
  lastSeenIso: string | null,
  nowMillis: number,
): number | null {
  if (!lastSeenIso) return null;
  const seen = Date.parse(lastSeenIso);
  return Number.isNaN(seen) ? null : nowMillis - seen;
}

/** A heartbeat is fresh within two intervals, capped by the staleness budget. */
export function heartbeatFresh(
  lastSeenIso: string | null,
  intervalMillis: number,
  nowMillis: number,
): boolean {
  const age = heartbeatAgeMillis(lastSeenIso, nowMillis);
  if (age === null) return false;
  const budget = Math.min(Math.max(intervalMillis * 2, 10_000), AUTHORITY_STALE_AFTER_MILLIS);
  return age >= 0 && age <= budget;
}

function verdict(
  condition: boolean,
  pass: string,
  fail: string,
): [LiveGateStatus, string] {
  return condition ? ["PASS", pass] : ["FAIL", fail];
}

export function evaluateLiveAuthorityGates(
  snapshot: LiveEvidenceSnapshot,
): readonly LiveGateResult[] {
  const { authority, startup, configuration, telemetry, security, nowMillis } = snapshot;

  const results = LIVE_GATES.map((gate): LiveGateResult => {
    let status: LiveGateStatus = "PENDING";
    let detail = PENDING_DETAIL;

    switch (gate.id) {
      case "authority.active": {
        if (!authority) break;
        const fresh = heartbeatFresh(
          authority.lastSeenIso,
          authority.heartbeatIntervalMillis,
          nowMillis,
        );
        const age = heartbeatAgeMillis(authority.lastSeenIso, nowMillis);
        const reasons: string[] = [];
        if (authority.status !== "active") reasons.push(`status ${authority.status.toUpperCase()}`);
        if (!authority.runtimeIdentity) reasons.push("runtime identity missing");
        if (!fresh) reasons.push(age === null ? "no heartbeat" : `heartbeat ${Math.round(age / 1000)}s old`);
        if (authority.latencyMillis === null) reasons.push("latency not reported");
        [status, detail] = verdict(
          reasons.length === 0,
          `${authority.authorityId} ACTIVE on ${authority.environment.toUpperCase()} · identity ${authority.runtimeIdentity} · ${authority.latencyMillis}ms · heartbeat ${age === null ? "—" : Math.round(age / 1000)}s ago.`,
          `Authority not qualified: ${reasons.join("; ")}.`,
        );
        break;
      }
      case "startup.chain": {
        if (!startup) break;
        [status, detail] = verdict(
          startup.allowed && startup.failedGates.length === 0,
          `Startup chain complete${startup.warnings.length > 0 ? ` with ${startup.warnings.length} warning(s)` : ""}.`,
          `Failed startup gate(s): ${startup.failedGates.join(", ") || "unknown"}.`,
        );
        break;
      }
      case "configuration.activation": {
        if (!configuration) break;
        const hashMatch =
          configuration.runtimeConfigHash !== null &&
          configuration.runtimeConfigHash === configuration.publishedConfigHash;
        const reasons: string[] = [];
        if (!configuration.live) reasons.push("authority did not answer the configuration read");
        if (configuration.runtimeStatus !== "LIVE")
          reasons.push(`runtime status ${configuration.runtimeStatus ?? "UNKNOWN"}`);
        if (!configuration.runtimeSnapshotId) reasons.push("snapshot id missing");
        if (!hashMatch) reasons.push("config hash does not match the published version");
        if (configuration.drift) reasons.push("runtime drift detected");
        [status, detail] = verdict(
          reasons.length === 0,
          `v${configuration.runtimeVersion ?? "—"} LIVE · hash ${(configuration.runtimeConfigHash ?? "").slice(0, 12)} · snapshot ${configuration.runtimeSnapshotId}.`,
          `Configuration not activated: ${reasons.join("; ")}.`,
        );
        break;
      }
      case "telemetry.complete": {
        if (!telemetry || telemetry.source === "NONE") break;
        const budget = Math.max(telemetry.syncIntervalMillis * 2, 10_000);
        const emitted = telemetry.emittedAtIso ? Date.parse(telemetry.emittedAtIso) : NaN;
        const current =
          telemetry.source === "LIVE" && !Number.isNaN(emitted) && nowMillis - emitted <= budget;
        const reasons: string[] = [];
        if (telemetry.source !== "LIVE") reasons.push("telemetry is mirrored, not live");
        if (!current) reasons.push("heartbeat is stale");
        if (telemetry.missingFields.length > 0)
          reasons.push(`missing ${telemetry.missingFields.join(", ")}`);
        [status, detail] = verdict(
          reasons.length === 0,
          "All required telemetry fields reported on a current heartbeat.",
          `Telemetry gate blocked: ${reasons.join("; ")}.`,
        );
        break;
      }
      default: {
        if (!security) break;
        const reasons: string[] = [];
        if (!security.signatureVerificationEnabled)
          reasons.push("authority handshake signature verification is disabled");
        if (!security.ownershipFinalized) reasons.push("operator ownership is not finalized");
        if (!security.secretMaterialRejected)
          reasons.push("registry does not reject secret material");
        [status, detail] = verdict(
          reasons.length === 0,
          "Signed handshakes, finalized ownership, no secret material persisted.",
          `Security posture incomplete: ${reasons.join("; ")}.`,
        );
        break;
      }
    }

    return { ...gate, status, detail };
  });

  return Object.freeze(results);
}

/** FAIL beats PENDING beats PASS — the report never overstates readiness. */
export function liveQualificationVerdict(
  results: readonly LiveGateResult[],
): LiveGateStatus {
  if (results.some((result) => result.status === "FAIL")) return "FAIL";
  if (results.some((result) => result.status === "PENDING")) return "PENDING";
  return "PASS";
}
