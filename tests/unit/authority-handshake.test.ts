/**
 * ARC — M6.8 authority handshake contract tests.
 *
 * Verifies the control-plane vocabulary: connection state derivation,
 * saved-vs-running verification, health merging and secret-material rejection.
 */
import { describe, expect, it } from "vitest";

import {
  deriveDashboardState,
  handshakeResponseSchema,
  mergeHealth,
  rejectsSecretMaterial,
  verifyRuntimeConfiguration,
  worstHealth,
  REQUIRED_HEALTH_COMPONENTS,
} from "@/core/platform/authority-handshake";

const registration = {
  name: "arc-engine-01",
  environment: "production" as const,
  baseUrl: "https://engine.example.com",
  apiVersion: "v1",
  engineVersion: null,
  platformVersion: null,
  healthEndpoint: "/health/details",
  handshakeEndpoint: "/authority/handshake",
  publicIdentifier: "arc-public-01",
  syncIntervalMillis: 5_000,
  isActive: true,
};

describe("dashboard runtime state", () => {
  it("reports UNREGISTERED before any engine is registered", () => {
    const report = deriveDashboardState({
      registered: false,
      transport: "NOT_REGISTERED",
      latestVersionStatus: null,
      drifted: false,
    });
    expect(report.state).toBe("UNREGISTERED");
    expect(report.connected).toBe(false);
  });

  it("never reports CONNECTED when the handshake failed", () => {
    for (const transport of ["UNREACHABLE", "UNAUTHORIZED", "PROTOCOL_MISMATCH"] as const) {
      const report = deriveDashboardState({
        registered: true,
        transport,
        latestVersionStatus: "ACTIVE",
        drifted: false,
      });
      expect(report.connected).toBe(false);
      expect(report.state).not.toBe("CONNECTED");
    }
  });

  it("surfaces pending configuration ahead of a plain connected state", () => {
    const report = deriveDashboardState({
      registered: true,
      transport: "OK",
      latestVersionStatus: "PENDING",
      drifted: false,
    });
    expect(report.state).toBe("CONFIGURATION_PENDING");
    expect(report.connected).toBe(true);
  });
});

describe("runtime configuration verification", () => {
  it("matches when saved and running agree", () => {
    const report = verifyRuntimeConfiguration(
      { version: 4, configHash: "cfgh_abc" },
      { version: 4, configHash: "cfgh_abc" },
    );
    expect(report.state).toBe("MATCH");
    expect(report.reasons).toHaveLength(0);
  });

  it("detects drift on version and hash independently", () => {
    const report = verifyRuntimeConfiguration(
      { version: 5, configHash: "cfgh_new" },
      { version: 4, configHash: "cfgh_old" },
    );
    expect(report.state).toBe("DRIFT");
    expect(report.reasons.map((reason) => reason.field)).toContain("version");
    expect(report.reasons.map((reason) => reason.field)).toContain("configuration hash");
  });

  it("is UNKNOWN when the engine reported nothing", () => {
    expect(verifyRuntimeConfiguration({ version: 1, configHash: "cfgh_a" }, null).state).toBe(
      "UNKNOWN",
    );
  });
});

describe("health", () => {
  it("fills every required component as unknown when unreported", () => {
    const entries = mergeHealth([]);
    expect(entries).toHaveLength(REQUIRED_HEALTH_COMPONENTS.length);
    expect(entries.every((entry) => entry.status === "unknown")).toBe(true);
  });

  it("takes the worst reported status", () => {
    const entries = mergeHealth([
      { component: "scheduler", status: "healthy", detail: null, latencyMillis: 4 },
      { component: "feed", status: "degraded", detail: null, latencyMillis: null },
    ]);
    expect(worstHealth(entries)).toBe("degraded");
  });
});

describe("registration safety", () => {
  it("accepts public metadata", () => {
    expect(rejectsSecretMaterial(registration)).toBeNull();
  });

  it("rejects pasted credentials in the public identifier", () => {
    expect(
      rejectsSecretMaterial({
        ...registration,
        publicIdentifier: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      }),
    ).not.toBeNull();
  });

  it("rejects credentials embedded in the base URL", () => {
    expect(
      rejectsSecretMaterial({
        ...registration,
        baseUrl: "https://user:secret@engine.example.com",
      }),
    ).not.toBeNull();
  });
});

describe("handshake contract", () => {
  it("rejects an answer that is not the ARC handshake document", () => {
    expect(handshakeResponseSchema.safeParse({ status: "ok" }).success).toBe(false);
  });
});
