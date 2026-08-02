/**
 * ARC — M7.9 security finalization & activation checklist.
 *
 * Operational validation only. Nothing here touches trading logic; the VPS
 * remains the sole trading authority.
 */
import { describe, expect, it } from "vitest";

import {
  ACTIVATION_STEP_IDS,
  activationComplete,
  buildActivationChecklist,
  pendingActivationSteps,
  type ActivationStatus,
} from "@/core/qualification/activation";
import type { LiveEvidenceSnapshot } from "@/core/qualification/live-gates";

const NOW = Date.parse("2026-08-02T11:00:00.000Z");
const iso = (offsetMillis: number) => new Date(NOW - offsetMillis).toISOString();

const nothing: LiveEvidenceSnapshot = {
  nowMillis: NOW,
  authority: null,
  startup: null,
  configuration: null,
  telemetry: null,
  security: { signatureVerificationEnabled: false, ownershipFinalized: false, secretMaterialRejected: true },
};

const activated: LiveEvidenceSnapshot = {
  nowMillis: NOW,
  authority: {
    authorityId: "arc-vps-1",
    environment: "testnet",
    status: "active",
    runtimeStatus: "running",
    runtimeIdentity: "pm2:arc-engine:0",
    engineVersion: "1.4.0",
    lastSeenIso: iso(4_000),
    heartbeatIntervalMillis: 15_000,
    latencyMillis: 38,
    activeMarket: "btc-updown-5m",
    activeWindows: 5,
    eventSequence: 9_001,
    configurationVersion: 7,
  },
  startup: { allowed: true, failedGates: [], warnings: [] },
  configuration: {
    live: true,
    runtimeStatus: "LIVE",
    runtimeConfigHash: "hash-abc",
    runtimeSnapshotId: "snap-7",
    runtimeVersion: 7,
    publishedConfigHash: "hash-abc",
    publishedVersion: 7,
    drift: false,
  },
  telemetry: { source: "LIVE", emittedAtIso: iso(1_000), syncIntervalMillis: 5_000, missingFields: [] },
  security: { signatureVerificationEnabled: true, ownershipFinalized: true, secretMaterialRejected: true },
};

const byId = (snapshot: LiveEvidenceSnapshot) =>
  Object.fromEntries(
    buildActivationChecklist(snapshot).map((step) => [step.id, step.status]),
  ) as Record<string, ActivationStatus>;

describe("M7.9 — activation checklist", () => {
  it("covers every activation step in operator order", () => {
    expect(buildActivationChecklist(nothing).map((step) => step.id)).toEqual([
      ...ACTIVATION_STEP_IDS,
    ]);
  });

  it("puts the two operator-owned prerequisites first and marks them READY", () => {
    const steps = buildActivationChecklist(nothing);
    expect(steps.slice(0, 2).map((step) => step.owner)).toEqual(["OPERATOR", "OPERATOR"]);
    expect(steps.slice(0, 2).map((step) => step.status)).toEqual(["READY", "READY"]);
  });

  it("blocks every VPS step until the key and ownership are in place", () => {
    const status = byId(nothing);
    expect(status["register"]).toBe("BLOCKED");
    expect(status["heartbeat"]).toBe("BLOCKED");
    expect(status["startup"]).toBe("BLOCKED");
    expect(status["configuration"]).toBe("BLOCKED");
    expect(status["telemetry"]).toBe("BLOCKED");
  });

  it("moves registration to WAITING once the prerequisites are closed", () => {
    const status = byId({
      ...nothing,
      security: {
        signatureVerificationEnabled: true,
        ownershipFinalized: true,
        secretMaterialRejected: true,
      },
    });
    expect(status["signing-key"]).toBe("DONE");
    expect(status["ownership"]).toBe("DONE");
    expect(status["register"]).toBe("WAITING");
  });

  it("keeps registration blocked when ownership alone is finalized", () => {
    const status = byId({
      ...nothing,
      security: {
        signatureVerificationEnabled: false,
        ownershipFinalized: true,
        secretMaterialRejected: true,
      },
    });
    expect(status["register"]).toBe("BLOCKED");
  });

  it("closes every step when the authority is fully activated", () => {
    const steps = buildActivationChecklist(activated);
    expect(steps.every((step) => step.status === "DONE")).toBe(true);
    expect(activationComplete(steps)).toBe(true);
    expect(pendingActivationSteps(steps)).toEqual([]);
  });

  it("reopens the heartbeat step when the authority goes silent", () => {
    const status = byId({
      ...activated,
      authority: { ...activated.authority!, lastSeenIso: iso(600_000) },
    });
    expect(status["register"]).toBe("DONE");
    expect(status["heartbeat"]).toBe("WAITING");
    expect(status["telemetry"]).toBe("BLOCKED");
  });

  it("treats a revoked authority as not registered", () => {
    const status = byId({
      ...activated,
      authority: { ...activated.authority!, status: "revoked" },
    });
    expect(status["register"]).toBe("WAITING");
  });

  it("names the unreported startup steps in the detail", () => {
    const steps = buildActivationChecklist({
      ...activated,
      startup: { allowed: false, failedGates: ["twap-running", "windows-armed"], warnings: [] },
    });
    const startup = steps.find((step) => step.id === "startup")!;
    expect(startup.status).toBe("WAITING");
    expect(startup.detail).toContain("twap-running");
  });

  it("reopens configuration on drift and says so", () => {
    const steps = buildActivationChecklist({
      ...activated,
      configuration: { ...activated.configuration!, drift: true },
    });
    const configuration = steps.find((step) => step.id === "configuration")!;
    expect(configuration.status).toBe("READY");
    expect(configuration.detail).toContain("drift");
  });

  it("reopens configuration when the runtime hash does not match the published one", () => {
    const status = byId({
      ...activated,
      configuration: { ...activated.configuration!, publishedConfigHash: "hash-other" },
    });
    expect(status["configuration"]).toBe("READY");
  });

  it("reopens telemetry when the source is mirrored rather than live", () => {
    const steps = buildActivationChecklist({
      ...activated,
      telemetry: { ...activated.telemetry!, source: "MIRRORED" },
    });
    const telemetry = steps.find((step) => step.id === "telemetry")!;
    expect(telemetry.status).toBe("WAITING");
    expect(telemetry.detail).toContain("MIRRORED");
  });

  it("lists the missing telemetry fields rather than closing the step", () => {
    const steps = buildActivationChecklist({
      ...activated,
      authority: { ...activated.authority!, eventSequence: null },
    });
    const telemetry = steps.find((step) => step.id === "telemetry")!;
    expect(telemetry.status).toBe("WAITING");
    expect(telemetry.detail).toContain("eventSequence");
  });

  it("never reports activation complete without evidence", () => {
    expect(activationComplete(buildActivationChecklist(nothing))).toBe(false);
    expect(activationComplete([])).toBe(false);
    expect(pendingActivationSteps(buildActivationChecklist(nothing))).toHaveLength(7);
  });

  it("attaches evidence — not a tick-box — to every step", () => {
    for (const step of buildActivationChecklist(activated)) {
      expect(step.evidence.length).toBeGreaterThan(10);
      expect(step.action.length).toBeGreaterThan(10);
    }
  });
});
