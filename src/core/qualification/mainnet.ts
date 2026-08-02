/**
 * ARC — M8.0 mainnet readiness gate.
 *
 * Pure aggregation. Collapses every earlier qualification layer into the eight
 * production domains and returns a single verdict:
 *
 *   QUALIFIED FOR MAINNET   — every domain PASS, from observed evidence
 *   NOT QUALIFIED           — anything else
 *
 * There is deliberately no override parameter, no force flag and no operator
 * attestation input. A domain can only turn PASS because the deterministic
 * harness (M7.7), the live authority evidence (M7.8) or the activation
 * checklist (M7.9) produced the evidence for it. Absence of evidence is
 * PENDING — never PASS.
 *
 * This module decides nothing about trading. The VPS remains the sole trading
 * authority (charter §Hybrid, ADR-0001).
 */
import type { ActivationStep } from "./activation";
import { activationComplete } from "./activation";
import type { GateResult } from "./gates";
import type { LiveGateResult } from "./live-gates";

export type DomainStatus = "PASS" | "FAIL" | "PENDING";

export const MAINNET_DOMAINS = [
  "ARCHITECTURE",
  "REPLAY",
  "RECOVERY",
  "SECURITY",
  "VPS",
  "CONFIGURATION",
  "TELEMETRY",
  "OPERATIONS",
] as const;

export type MainnetDomain = (typeof MAINNET_DOMAINS)[number];

export interface MainnetDomainSpec {
  readonly domain: MainnetDomain;
  readonly title: string;
  readonly requirement: string;
}

export const MAINNET_DOMAIN_SPECS: readonly MainnetDomainSpec[] = Object.freeze([
  {
    domain: "ARCHITECTURE",
    title: "Frozen architecture holds",
    requirement:
      "Unidirectional flow market → decision → trade → platform, engine and strategy isolation, and a canonical lifecycle observed exactly once per execution.",
  },
  {
    domain: "REPLAY",
    title: "Deterministic replay",
    requirement:
      "The recorded input stream reproduces an identical event stream, digest and ledger with zero mismatches.",
  },
  {
    domain: "RECOVERY",
    title: "Restart recovery is idempotent",
    requirement:
      "A restart restores execution context and suppresses duplicate intents, orders, settlements and ledger records.",
  },
  {
    domain: "SECURITY",
    title: "Security posture enforced",
    requirement:
      "Signed authority handshakes with replay protection, finalized operator ownership, registration closed and no secret material persisted.",
  },
  {
    domain: "VPS",
    title: "Trading authority live",
    requirement:
      "A registered authority reports ACTIVE with a runtime identity, a fresh heartbeat and a completed startup chain.",
  },
  {
    domain: "CONFIGURATION",
    title: "Configuration round-trip",
    requirement:
      "The published version is LIVE on the authority with a matching hash and snapshot, and no drift.",
  },
  {
    domain: "TELEMETRY",
    title: "Telemetry complete",
    requirement:
      "Every mandated telemetry field is reported on a current live heartbeat and every canonical event is queryable.",
  },
  {
    domain: "OPERATIONS",
    title: "Production operations validated",
    requirement:
      "Activation checklist closed, process uptime reported, restart does not duplicate the event sequence.",
  },
] as const);

/**
 * Operational evidence read from the authority registry. Every field is a
 * reported measurement — none of it is an operator assertion.
 */
export interface OperationsEvidence {
  /** Engine process uptime as reported by the authority (PM2 managed). */
  readonly processUptimeSeconds: number | null;
  /** How many times the authority has registered; > 1 means it restarted. */
  readonly registrationCount: number;
  /** Highest canonical event sequence the authority has reported. */
  readonly eventSequence: number | null;
  /**
   * True when a restart replayed an already-recorded sequence, i.e. the event
   * stream went backwards or repeated. Derived, never asserted.
   */
  readonly sequenceRegressed: boolean;
}

export interface MainnetReadinessInput {
  /** Deterministic harness gate results (M7.7). */
  readonly harness: readonly GateResult[];
  /** Live authority gate results (M7.8). */
  readonly live: readonly LiveGateResult[];
  /** Activation checklist (M7.9/M7.10). */
  readonly activation: readonly ActivationStep[];
  /** Operational measurements from the registry; null when never reported. */
  readonly operations: OperationsEvidence | null;
}

export interface MainnetDomainResult extends MainnetDomainSpec {
  readonly status: DomainStatus;
  /** Human-readable evidence lines that produced the status. */
  readonly evidence: readonly string[];
  /** What still stands between this domain and PASS. */
  readonly blockers: readonly string[];
}

export type MainnetVerdict = "QUALIFIED FOR MAINNET" | "NOT QUALIFIED";

const PENDING = "Awaiting evidence.";

interface Bucket {
  readonly evidence: string[];
  readonly blockers: string[];
  readonly pending: string[];
}

function emptyBucket(): Bucket {
  return { evidence: [], blockers: [], pending: [] };
}

/** Folds a gate result into a bucket: PASS is evidence, FAIL blocks, PENDING waits. */
function fold(
  bucket: Bucket,
  label: string,
  status: DomainStatus | undefined,
  detail: string,
): void {
  if (status === "PASS") bucket.evidence.push(`${label}: ${detail}`);
  else if (status === "FAIL") bucket.blockers.push(`${label}: ${detail}`);
  else bucket.pending.push(`${label}: ${detail || PENDING}`);
}

function statusOf(bucket: Bucket): DomainStatus {
  if (bucket.blockers.length > 0) return "FAIL";
  if (bucket.pending.length > 0 || bucket.evidence.length === 0) return "PENDING";
  return "PASS";
}

function foldGates(
  bucket: Bucket,
  gates: readonly { id: string; title: string; status: DomainStatus; detail: string }[],
  ids: readonly string[],
): void {
  for (const id of ids) {
    const gate = gates.find((candidate) => candidate.id === id);
    if (!gate) {
      bucket.pending.push(`${id}: ${PENDING}`);
      continue;
    }
    fold(bucket, gate.title, gate.status, gate.detail);
  }
}

export function evaluateMainnetReadiness(
  input: MainnetReadinessInput,
): readonly MainnetDomainResult[] {
  const harness = input.harness as readonly {
    id: string;
    title: string;
    status: DomainStatus;
    detail: string;
  }[];
  const live = input.live as readonly {
    id: string;
    title: string;
    status: DomainStatus;
    detail: string;
  }[];

  const results = MAINNET_DOMAIN_SPECS.map((spec): MainnetDomainResult => {
    const bucket = emptyBucket();

    switch (spec.domain) {
      case "ARCHITECTURE":
        foldGates(bucket, harness, [
          "lifecycle.complete",
          "lifecycle.settlement",
          "multiwindow.ordering",
          "multiwindow.quota",
        ]);
        break;
      case "REPLAY":
        foldGates(bucket, harness, ["replay.deterministic"]);
        break;
      case "RECOVERY":
        foldGates(bucket, harness, ["recovery.no_duplicate"]);
        break;
      case "SECURITY":
        foldGates(bucket, live, ["security.posture"]);
        break;
      case "VPS":
        foldGates(bucket, live, ["authority.active", "startup.chain"]);
        foldGates(bucket, harness, ["startup.sequence"]);
        break;
      case "CONFIGURATION":
        foldGates(bucket, harness, ["configuration.dispatch"]);
        foldGates(bucket, live, ["configuration.activation"]);
        break;
      case "TELEMETRY":
        foldGates(bucket, harness, ["observability.telemetry"]);
        foldGates(bucket, live, ["telemetry.complete"]);
        break;
      default: {
        const done = activationComplete(input.activation);
        const open = input.activation.filter((step) => step.status !== "DONE");
        if (input.activation.length === 0) {
          bucket.pending.push("Activation checklist: not resolved yet.");
        } else if (done) {
          bucket.evidence.push(
            `Activation checklist: ${input.activation.length}/${input.activation.length} steps closed by evidence.`,
          );
        } else {
          bucket.pending.push(
            `Activation checklist: ${open.length} step(s) open — ${open.map((step) => step.id).join(", ")}.`,
          );
        }

        const ops = input.operations;
        if (!ops) {
          bucket.pending.push("Process telemetry: the authority has not reported uptime yet.");
          break;
        }
        if (ops.sequenceRegressed) {
          bucket.blockers.push(
            "Restart integrity: the canonical event sequence regressed after a restart — duplicate events are possible.",
          );
        } else if (ops.eventSequence === null) {
          bucket.pending.push("Restart integrity: no event sequence reported.");
        } else {
          bucket.evidence.push(
            `Restart integrity: event sequence ${ops.eventSequence} is monotonic across ${ops.registrationCount} registration(s).`,
          );
        }
        if (ops.processUptimeSeconds === null) {
          bucket.pending.push("Process uptime: not reported by the authority.");
        } else {
          bucket.evidence.push(
            `Process uptime: ${Math.round(ops.processUptimeSeconds)}s reported by the PM2-managed engine.`,
          );
        }
        break;
      }
    }

    return {
      ...spec,
      status: statusOf(bucket),
      evidence: Object.freeze([...bucket.evidence]),
      blockers: Object.freeze([...bucket.blockers, ...bucket.pending]),
    };
  });

  return Object.freeze(results);
}

/**
 * The mainnet verdict. Takes no override, no force flag and no attestation:
 * every domain must be PASS on observed evidence or the answer is NOT
 * QUALIFIED.
 */
export function mainnetVerdict(
  results: readonly MainnetDomainResult[],
): MainnetVerdict {
  const complete =
    results.length === MAINNET_DOMAIN_SPECS.length &&
    results.every((result) => result.status === "PASS");
  return complete ? "QUALIFIED FOR MAINNET" : "NOT QUALIFIED";
}

/** Ordered blockers across every domain — the remaining production work. */
export function mainnetBlockers(
  results: readonly MainnetDomainResult[],
): readonly { domain: MainnetDomain; blocker: string }[] {
  return Object.freeze(
    results.flatMap((result) =>
      result.blockers.map((blocker) => ({ domain: result.domain, blocker })),
    ),
  );
}
