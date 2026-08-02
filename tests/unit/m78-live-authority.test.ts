/**
 * ARC — M7.8 live authority qualification gates.
 *
 * Validation only: these tests prove the evidence evaluator, not trading logic.
 */
import { describe, expect, it } from "vitest";

import {
  LIVE_GATES,
  REQUIRED_TELEMETRY_FIELDS,
  evaluateLiveAuthorityGates,
  heartbeatFresh,
  liveQualificationVerdict,
  missingTelemetryFields,
  type LiveEvidenceSnapshot,
} from "@/core/qualification/live-gates";

const NOW = Date.parse("2026-08-02T10:00:00.000Z");
const iso = (offsetMillis: number) => new Date(NOW - offsetMillis).toISOString();

const authority = {
  authorityId: "arc-vps-1",
  environment: "testnet",
  status: "active",
  runtimeStatus: "running",
  runtimeIdentity: "pm2:arc-engine:0",
  engineVersion: "1.4.0",
  lastSeenIso: iso(5_000),
  heartbeatIntervalMillis: 15_000,
  latencyMillis: 42,
  activeMarket: "btc-updown-5m-2026080210",
  activeWindows: 5,
  eventSequence: 10_482,
  configurationVersion: 7,
};

const qualified: LiveEvidenceSnapshot = {
  nowMillis: NOW,
  authority,
  startup: { allowed: true, failedGates: [], warnings: [] },
  configuration: {
    live: true,
    runtimeStatus: "LIVE",
    runtimeConfigHash: "hash-abc123456789",
    runtimeSnapshotId: "snap-42",
    runtimeVersion: 7,
    publishedConfigHash: "hash-abc123456789",
    publishedVersion: 7,
    drift: false,
  },
  telemetry: {
    source: "LIVE",
    emittedAtIso: iso(2_000),
    syncIntervalMillis: 5_000,
    missingFields: [],
  },
  security: {
    signatureVerificationEnabled: true,
    ownershipFinalized: true,
    secretMaterialRejected: true,
  },
};

const empty: LiveEvidenceSnapshot = {
  nowMillis: NOW,
  authority: null,
  startup: null,
  configuration: null,
  telemetry: null,
  security: null,
};

const statuses = (snapshot: LiveEvidenceSnapshot) =>
  Object.fromEntries(evaluateLiveAuthorityGates(snapshot).map((g) => [g.id, g.status]));

describe("M7.8 — live authority gates", () => {
  it("covers authority, startup, configuration, telemetry and security", () => {
    expect(LIVE_GATES.map((gate) => gate.category)).toEqual([
      "AUTHORITY",
      "STARTUP",
      "CONFIGURATION",
      "TELEMETRY",
      "SECURITY",
    ]);
  });

  it("passes every gate when the live authority is fully qualified", () => {
    const results = evaluateLiveAuthorityGates(qualified);
    expect(results.every((gate) => gate.status === "PASS")).toBe(true);
    expect(liveQualificationVerdict(results)).toBe("PASS");
  });

  it("reports PENDING — never PASS or FAIL — without any evidence", () => {
    const results = evaluateLiveAuthorityGates(empty);
    expect(results.every((gate) => gate.status === "PENDING")).toBe(true);
    expect(liveQualificationVerdict(results)).toBe("PENDING");
  });

  it("fails the authority gate on a stale heartbeat", () => {
    const snapshot = {
      ...qualified,
      authority: { ...authority, lastSeenIso: iso(120_000) },
    };
    const gate = evaluateLiveAuthorityGates(snapshot).find((g) => g.id === "authority.active")!;
    expect(gate.status).toBe("FAIL");
    expect(gate.detail).toContain("heartbeat");
  });

  it("fails the authority gate when the runtime identity is missing", () => {
    const snapshot = {
      ...qualified,
      authority: { ...authority, runtimeIdentity: null },
    };
    expect(statuses(snapshot)["authority.active"]).toBe("FAIL");
  });

  it("fails the authority gate when latency is not reported", () => {
    const snapshot = { ...qualified, authority: { ...authority, latencyMillis: null } };
    expect(statuses(snapshot)["authority.active"]).toBe("FAIL");
  });

  it("fails the startup gate and names the failed gate", () => {
    const snapshot = {
      ...qualified,
      startup: { allowed: false, failedGates: ["feed-configuration"], warnings: [] },
    };
    const gate = evaluateLiveAuthorityGates(snapshot).find((g) => g.id === "startup.chain")!;
    expect(gate.status).toBe("FAIL");
    expect(gate.detail).toContain("feed-configuration");
  });

  it("passes the startup gate with warnings only", () => {
    const snapshot = {
      ...qualified,
      startup: { allowed: true, failedGates: [], warnings: ["twap: short window"] },
    };
    const gate = evaluateLiveAuthorityGates(snapshot).find((g) => g.id === "startup.chain")!;
    expect(gate.status).toBe("PASS");
    expect(gate.detail).toContain("1 warning");
  });

  it("fails configuration activation when the config hash does not match", () => {
    const snapshot = {
      ...qualified,
      configuration: { ...qualified.configuration!, publishedConfigHash: "hash-other" },
    };
    const gate = evaluateLiveAuthorityGates(snapshot).find(
      (g) => g.id === "configuration.activation",
    )!;
    expect(gate.status).toBe("FAIL");
    expect(gate.detail).toContain("config hash");
  });

  it("fails configuration activation when the snapshot id is missing", () => {
    const snapshot = {
      ...qualified,
      configuration: { ...qualified.configuration!, runtimeSnapshotId: null },
    };
    expect(statuses(snapshot)["configuration.activation"]).toBe("FAIL");
  });

  it("fails configuration activation on drift", () => {
    const snapshot = {
      ...qualified,
      configuration: { ...qualified.configuration!, drift: true },
    };
    expect(statuses(snapshot)["configuration.activation"]).toBe("FAIL");
  });

  it("fails the telemetry gate when telemetry is mirrored rather than live", () => {
    const snapshot = {
      ...qualified,
      telemetry: { ...qualified.telemetry!, source: "MIRRORED" as const },
    };
    expect(statuses(snapshot)["telemetry.complete"]).toBe("FAIL");
  });

  it("fails the telemetry gate when the heartbeat is stale", () => {
    const snapshot = {
      ...qualified,
      telemetry: { ...qualified.telemetry!, emittedAtIso: iso(300_000) },
    };
    expect(statuses(snapshot)["telemetry.complete"]).toBe("FAIL");
  });

  it("keeps telemetry PENDING when no source is available", () => {
    const snapshot = {
      ...qualified,
      telemetry: { ...qualified.telemetry!, source: "NONE" as const },
    };
    expect(statuses(snapshot)["telemetry.complete"]).toBe("PENDING");
  });

  it("requires every mandated telemetry field", () => {
    expect(missingTelemetryFields(null)).toEqual([...REQUIRED_TELEMETRY_FIELDS]);
    expect(missingTelemetryFields(authority)).toEqual([]);
    expect(
      missingTelemetryFields({ ...authority, eventSequence: null, activeWindows: null }),
    ).toEqual(["activeWindows", "eventSequence"]);
  });

  it("fails the security gate when ownership is not finalized", () => {
    const snapshot = {
      ...qualified,
      security: { ...qualified.security!, ownershipFinalized: false },
    };
    const gate = evaluateLiveAuthorityGates(snapshot).find((g) => g.id === "security.posture")!;
    expect(gate.status).toBe("FAIL");
    expect(gate.detail).toContain("ownership");
  });

  it("fails the security gate when handshake signatures are not verified", () => {
    const snapshot = {
      ...qualified,
      security: { ...qualified.security!, signatureVerificationEnabled: false },
    };
    expect(statuses(snapshot)["security.posture"]).toBe("FAIL");
  });

  it("treats a heartbeat within two intervals as fresh and beyond as stale", () => {
    expect(heartbeatFresh(iso(9_000), 5_000, NOW)).toBe(true);
    expect(heartbeatFresh(iso(45_000), 5_000, NOW)).toBe(false);
    expect(heartbeatFresh(null, 5_000, NOW)).toBe(false);
  });

  it("lets FAIL outrank PENDING in the overall verdict", () => {
    const mixed = evaluateLiveAuthorityGates({
      ...empty,
      startup: { allowed: false, failedGates: ["risk-profile"], warnings: [] },
    });
    expect(liveQualificationVerdict(mixed)).toBe("FAIL");
  });
});
