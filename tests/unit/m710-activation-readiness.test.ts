/**
 * ARC — M7.10 activation readiness & security tests.
 *
 * Covers the control-plane guarantees the milestone mandates:
 *  - unsigned, wrongly-signed, stale and replayed authority messages are rejected;
 *  - authority display status is derived from verified evidence only;
 *  - configuration is never shown ACTIVE without an authority confirmation;
 *  - activation diagnostics name the missing evidence and the required action;
 *  - the startup chain never infers a step the authority did not report.
 */
import { describe, expect, it } from "vitest";

import {
  signAuthorityMessage,
  verifyAuthorityMessage,
} from "@/core/platform/authority-signature";
import {
  deriveAuthorityDisplay,
  formatHeartbeatAge,
} from "@/core/platform/authority-presentation";
import { deriveConfigurationActivation } from "@/core/platform/configuration-activation";
import {
  STARTUP_CHAIN_STEPS,
  buildActivationChecklist,
  deriveStartupChain,
  type LiveEvidenceSnapshot,
} from "@/core/qualification";

const KEY = "0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function payload() {
  return { authorityId: "arc-vps-1", environment: "testnet" };
}

describe("M7.10 — authority message security", () => {
  it("rejects an unsigned message even when the key is configured", async () => {
    const result = await verifyAuthorityMessage({
      payload: payload(),
      signature: null,
      timestamp: new Date(NOW).toISOString(),
      key: KEY,
      nowMillis: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("MISSING_SIGNATURE");
  });

  it("fails closed when no signing key is configured", async () => {
    const signature = await signAuthorityMessage(KEY, payload());
    const result = await verifyAuthorityMessage({
      payload: payload(),
      signature,
      timestamp: new Date(NOW).toISOString(),
      key: null,
      nowMillis: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("KEY_UNCONFIGURED");
  });

  it("rejects a signature produced with the wrong key", async () => {
    const signature = await signAuthorityMessage("a-different-shared-key-value", payload());
    const result = await verifyAuthorityMessage({
      payload: payload(),
      signature,
      timestamp: new Date(NOW).toISOString(),
      key: KEY,
      nowMillis: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("SIGNATURE_INVALID");
  });

  it("rejects a stale timestamp outside the skew window", async () => {
    const staleIso = new Date(NOW - 10 * 60_000).toISOString();
    const signature = await signAuthorityMessage(KEY, payload());
    const result = await verifyAuthorityMessage({
      payload: payload(),
      signature,
      timestamp: staleIso,
      key: KEY,
      nowMillis: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).not.toBeNull();
  });

  it("rejects a replayed signature that was already accepted", async () => {
    const signature = await signAuthorityMessage(KEY, payload());
    const base = {
      payload: payload(),
      signature,
      timestamp: new Date(NOW).toISOString(),
      key: KEY,
      nowMillis: NOW,
    };
    const first = await verifyAuthorityMessage(base);
    expect(first.ok).toBe(true);

    const replay = await verifyAuthorityMessage({ ...base, seenBefore: () => true });
    expect(replay.ok).toBe(false);
    expect(replay.reasonCode).toBe("SIGNATURE_REPLAYED");
  });
});

describe("M7.10 — authority display status", () => {
  const fresh = {
    status: "active",
    lastSeenIso: new Date(NOW - 5_000).toISOString(),
    heartbeatIntervalMillis: 15_000,
    runtimeIdentity: "pm2:arc-engine:0",
    signatureVerified: true,
  };

  it("reports UNREGISTERED when no authority row exists", () => {
    expect(deriveAuthorityDisplay(null, NOW).status).toBe("UNREGISTERED");
  });

  it("reports ACTIVE only with signature enforcement, a fresh heartbeat and an identity", () => {
    const display = deriveAuthorityDisplay(fresh, NOW);
    expect(display.status).toBe("ACTIVE");
    expect(display.blockers).toHaveLength(0);
  });

  it("never reports ACTIVE while signature verification is off", () => {
    const display = deriveAuthorityDisplay({ ...fresh, signatureVerified: false }, NOW);
    expect(display.status).toBe("STALE");
    expect(display.blockers.join(" ")).toContain("signature");
  });

  it("reports STALE once the heartbeat ages past the deadline", () => {
    const display = deriveAuthorityDisplay(
      { ...fresh, lastSeenIso: new Date(NOW - 120_000).toISOString() },
      NOW,
    );
    expect(display.status).toBe("STALE");
  });

  it("reports REVOKED regardless of heartbeat freshness", () => {
    expect(deriveAuthorityDisplay({ ...fresh, status: "revoked" }, NOW).status).toBe("REVOKED");
  });

  it("formats heartbeat age for the operator", () => {
    expect(formatHeartbeatAge(null)).toBe("never");
    expect(formatHeartbeatAge(12_000)).toBe("12s ago");
    expect(formatHeartbeatAge(240_000)).toBe("4m ago");
  });
});

describe("M7.10 — configuration activation visibility", () => {
  const version = {
    version: 7,
    status: "ACTIVE",
    configHash: "hash-7",
    rejectionReason: null,
  };

  it("is NOT_PUBLISHED with no stored version", () => {
    expect(
      deriveConfigurationActivation({ latestVersion: null, runtime: null, drifted: false }).state,
    ).toBe("NOT_PUBLISHED");
  });

  it("is PENDING while the authority has not answered a live read", () => {
    const result = deriveConfigurationActivation({
      latestVersion: version,
      runtime: null,
      drifted: false,
    });
    expect(result.state).toBe("PENDING");
    expect(result.confirmedByAuthority).toBe(false);
  });

  it("never shows ACTIVE from a mirrored read", () => {
    const result = deriveConfigurationActivation({
      latestVersion: version,
      runtime: {
        live: false,
        runtimeStatus: "LIVE",
        configHash: "hash-7",
        snapshotId: "snap-7",
        version: 7,
      },
      drifted: false,
    });
    expect(result.state).toBe("PENDING");
  });

  it("is ACCEPTED when the authority holds the hash but is not LIVE yet", () => {
    expect(
      deriveConfigurationActivation({
        latestVersion: version,
        runtime: {
          live: true,
          runtimeStatus: "ACCEPTED",
          configHash: "hash-7",
          snapshotId: "snap-7",
          version: 7,
        },
        drifted: false,
      }).state,
    ).toBe("ACCEPTED");
  });

  it("is ACTIVE only on a live LIVE read with a matching hash", () => {
    const result = deriveConfigurationActivation({
      latestVersion: version,
      runtime: {
        live: true,
        runtimeStatus: "LIVE",
        configHash: "hash-7",
        snapshotId: "snap-7",
        version: 7,
      },
      drifted: false,
    });
    expect(result.state).toBe("ACTIVE");
    expect(result.confirmedByAuthority).toBe(true);
  });

  it("is REJECTED when the authority refused the version", () => {
    expect(
      deriveConfigurationActivation({
        latestVersion: { ...version, status: "REJECTED", rejectionReason: "tick size invalid" },
        runtime: null,
        drifted: false,
      }).detail,
    ).toContain("tick size invalid");
  });

  it("is DRIFTED when the running hash diverges", () => {
    expect(
      deriveConfigurationActivation({
        latestVersion: version,
        runtime: {
          live: true,
          runtimeStatus: "LIVE",
          configHash: "hash-6",
          snapshotId: "snap-6",
          version: 6,
        },
        drifted: true,
      }).state,
    ).toBe("DRIFTED");
  });
});

describe("M7.10 — startup evidence", () => {
  it("has nine ordered steps starting with the engine coming online", () => {
    expect(STARTUP_CHAIN_STEPS).toHaveLength(9);
    expect(STARTUP_CHAIN_STEPS[0]).toBe("engine-online");
    expect(STARTUP_CHAIN_STEPS[8]).toBe("windows-armed");
  });

  it("never infers a step the authority did not report", () => {
    const startup = deriveStartupChain({
      engineOnline: true,
      configurationVersion: null,
      feedConnected: null,
      marketCount: 0,
      ptb: null,
      runningTwap: null,
      effectiveTwap: null,
      marketStateVersion: null,
      armedWindows: 0,
    });
    expect(startup?.allowed).toBe(false);
    expect(startup?.failedGates).toContain("configuration-loaded");
    expect(startup?.failedGates).not.toContain("engine-online");
  });

  it("returns no evidence at all when the authority is silent", () => {
    expect(deriveStartupChain(null)).toBeNull();
  });
});

describe("M7.10 — activation diagnostics", () => {
  const emptySnapshot: LiveEvidenceSnapshot = {
    nowMillis: NOW,
    authority: null,
    startup: null,
    configuration: null,
    telemetry: null,
    security: {
      signatureVerificationEnabled: false,
      ownershipFinalized: false,
      secretMaterialRejected: true,
    },
  };

  it("gives every blocked step a reason, a required action and a transition", () => {
    const steps = buildActivationChecklist(emptySnapshot);
    for (const step of steps) {
      expect(step.reason.length).toBeGreaterThan(0);
      expect(step.required.length).toBeGreaterThan(0);
      expect(step.transition.length).toBeGreaterThan(0);
    }
  });

  it("blocks registration on the signing key and ownership prerequisites", () => {
    const steps = buildActivationChecklist(emptySnapshot);
    const register = steps.find((step) => step.id === "register");
    expect(register?.status).toBe("BLOCKED");
    expect(register?.reason).toContain("prerequisites");
  });

  it("names the signing key as the first ready operator action", () => {
    const steps = buildActivationChecklist(emptySnapshot);
    expect(steps[0]?.id).toBe("signing-key");
    expect(steps[0]?.status).toBe("READY");
    expect(steps[0]?.required).toContain("ARC_AUTHORITY_SIGNING_KEY");
  });

  it("keeps ownership finalization an operator-owned step", () => {
    const ownership = buildActivationChecklist(emptySnapshot).find(
      (step) => step.id === "ownership",
    );
    expect(ownership?.owner).toBe("OPERATOR");
    expect(ownership?.transition).toContain("Registration closes");
  });
});
