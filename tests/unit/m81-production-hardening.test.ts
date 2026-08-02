/**
 * ARC — M8.1 production hardening tests.
 *
 * Covers the incident model, audit normalization and redaction, the deployment
 * checklist, and the final security sweep. The sweep checks are here rather
 * than in a one-off script so they re-run on every change.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildOperatorAuditRecord,
  deriveOperationsDiagnostics,
  deriveStartupSteps,
  redactAuditDetail,
} from "@/core/platform";
import {
  DEPLOYMENT_SECTIONS,
  buildDeploymentChecklist,
  deploymentReady,
} from "@/core/qualification";
import type { LiveEvidenceSnapshot } from "@/core/qualification/live-gates";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function emptySnapshot(): LiveEvidenceSnapshot {
  return {
    nowMillis: NOW,
    authority: null,
    configuration: null,
    startup: null,
    telemetry: null,
    security: null,
  } as unknown as LiveEvidenceSnapshot;
}

function liveSnapshot(): LiveEvidenceSnapshot {
  return {
    nowMillis: NOW,
    authority: {
      authorityId: "arc-vps-1",
      environment: "testnet",
      status: "ACTIVE",
      runtimeStatus: "RUNNING",
      runtimeIdentity: "pm2:arc-engine:1",
      engineVersion: "1.0.0",
      lastSeenIso: new Date(NOW - 2_000).toISOString(),
      heartbeatIntervalMillis: 10_000,
      latencyMillis: 42,
      activeMarket: "BTC-USD",
      activeWindows: 5,
      eventSequence: 1024,
      configurationVersion: 7,
    },
    configuration: {
      publishedVersion: 7,
      publishedConfigHash: "hash-7",
      runtimeVersion: 7,
      runtimeConfigHash: "hash-7",
      runtimeSnapshotId: "snap-7",
      runtimeStatus: "LIVE",
      live: true,
      drift: false,
    },
    startup: null,
    telemetry: null,
    security: { signatureVerificationEnabled: true },
  } as unknown as LiveEvidenceSnapshot;
}

describe("M8.1 — operator incident model", () => {
  it("raises a critical incident when no authority has ever registered", () => {
    const diagnostics = deriveOperationsDiagnostics(emptySnapshot());
    const incident = diagnostics.incidents.find((entry) => entry.area === "AUTHORITY");

    expect(incident).toBeDefined();
    expect(incident?.severity).toBe("CRITICAL");
  });

  it("states all five operator fields on every incident", () => {
    const diagnostics = deriveOperationsDiagnostics(emptySnapshot());
    expect(diagnostics.incidents.length).toBeGreaterThan(0);

    for (const incident of diagnostics.incidents) {
      expect(incident.problem.length).toBeGreaterThan(0);
      expect(incident.reason.length).toBeGreaterThan(0);
      expect(incident.missingEvidence.length).toBeGreaterThan(0);
      expect(incident.requiredAction.length).toBeGreaterThan(0);
      expect(incident.expectedRecovery.length).toBeGreaterThan(0);
    }
  });

  it("orders incidents by severity", () => {
    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    const incidents = deriveOperationsDiagnostics(emptySnapshot()).incidents;

    for (let index = 1; index < incidents.length; index += 1) {
      expect(rank[incidents[index]!.severity]).toBeGreaterThanOrEqual(
        rank[incidents[index - 1]!.severity],
      );
    }
  });

  it("raises no authority or configuration incident when everything reports healthy", () => {
    const diagnostics = deriveOperationsDiagnostics(liveSnapshot());

    expect(diagnostics.authority.status).toBe("ACTIVE");
    expect(diagnostics.configuration.state).toBe("ACTIVE");
    expect(
      diagnostics.incidents.filter(
        (incident) => incident.area === "AUTHORITY" || incident.area === "CONFIGURATION",
      ),
    ).toHaveLength(0);
  });

  it("flags a stale heartbeat rather than reporting the authority as healthy", () => {
    const snapshot = liveSnapshot();
    const stale = {
      ...snapshot,
      authority: {
        ...snapshot.authority!,
        lastSeenIso: new Date(NOW - 600_000).toISOString(),
      },
    } as LiveEvidenceSnapshot;

    const diagnostics = deriveOperationsDiagnostics(stale);
    expect(diagnostics.authority.status).toBe("STALE");
    expect(diagnostics.incidents.some((incident) => incident.severity === "CRITICAL")).toBe(true);
  });

  it("flags configuration drift as an incident", () => {
    const snapshot = liveSnapshot();
    const drifted = {
      ...snapshot,
      configuration: {
        ...snapshot.configuration!,
        runtimeConfigHash: "hash-6",
        runtimeVersion: 6,
        drift: true,
      },
    } as LiveEvidenceSnapshot;

    const diagnostics = deriveOperationsDiagnostics(drifted);
    expect(diagnostics.configuration.state).toBe("DRIFTED");
    expect(diagnostics.incidents.some((incident) => incident.area === "CONFIGURATION")).toBe(true);
  });

  it("treats an absent startup chain as waiting, never as passing", () => {
    const steps = deriveStartupSteps(null);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.status === "WAITING")).toBe(true);
  });
});

describe("M8.1 — normalized audit records", () => {
  const base = {
    actor: "operator-1",
    action: "configuration.published",
    resource: "configuration_version",
    resourceId: "7",
    result: "SUCCESS" as const,
    correlationId: "corr-1",
    occurredAtIso: "2026-01-01T00:00:00.000Z",
  };

  it("carries every mandatory field", () => {
    const record = buildOperatorAuditRecord(base);

    expect(record.actor).toBe("operator-1");
    expect(record.action).toBe("configuration.published");
    expect(record.resource).toBe("configuration_version");
    expect(record.resourceId).toBe("7");
    expect(record.result).toBe("SUCCESS");
    expect(record.correlationId).toBe("corr-1");
    expect(record.occurredAtIso).toBe("2026-01-01T00:00:00.000Z");
  });

  it("records rejections, not only successes", () => {
    const record = buildOperatorAuditRecord({ ...base, result: "REJECTED" });
    expect(record.result).toBe("REJECTED");
  });

  it("redacts secret-like keys at any depth", () => {
    const redacted = redactAuditDetail({
      configHash: "hash-7",
      signingKey: "super-secret",
      nested: { apiKey: "abc", authorization: "Bearer x", safe: 1 },
    });

    expect(redacted["configHash"]).toBe("hash-7");
    expect(redacted["signingKey"]).toBe("[redacted]");
    const nested = redacted["nested"] as Record<string, unknown>;
    expect(nested["apiKey"]).toBe("[redacted]");
    expect(nested["authorization"]).toBe("[redacted]");
    expect(nested["safe"]).toBe(1);
  });

  it("redacts detail passed through the record builder", () => {
    const record = buildOperatorAuditRecord({
      ...base,
      detail: { privateKey: "0xdeadbeef", version: 7 },
    });

    expect(record.detail["privateKey"]).toBe("[redacted]");
    expect(record.detail["version"]).toBe(7);
    expect(JSON.stringify(record)).not.toContain("0xdeadbeef");
  });
});

describe("M8.1 — deployment checklist", () => {
  const noEvidence = buildDeploymentChecklist({
    snapshot: null,
    backendReachable: true,
    mainnet: [],
    verdict: "BLOCKED",
  });

  it("evaluates every section", () => {
    for (const section of DEPLOYMENT_SECTIONS) {
      expect(noEvidence.some((check) => check.section === section)).toBe(true);
    }
  });

  it("never reports ready without VPS evidence", () => {
    expect(deploymentReady(noEvidence)).toBe(false);
    expect(noEvidence.some((check) => check.status === "PASS" && check.section === "VPS"))
      .toBe(false);
  });

  it("explains every unmet item", () => {
    for (const check of noEvidence) {
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });

  it("closes VPS authority items once the authority reports live", () => {
    const live = buildDeploymentChecklist({
      snapshot: liveSnapshot(),
      backendReachable: true,
      mainnet: [],
      verdict: "BLOCKED",
    });

    const authorityChecks = live.filter((check) => check.section === "VPS");
    expect(authorityChecks.some((check) => check.status === "PASS")).toBe(true);
  });

  it("fails the environment section when the backend cannot be read", () => {
    const offline = buildDeploymentChecklist({
      snapshot: null,
      backendReachable: false,
      mainnet: [],
      verdict: "BLOCKED",
    });

    expect(
      offline.some((check) => check.section === "ENVIRONMENT" && check.status === "FAIL"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Final security sweep
// ---------------------------------------------------------------------------

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // reference/p4 and docs are read-only mirrors and never bundled.
      if (entry === "node_modules") continue;
      sourceFiles(full, acc);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("M8.1 — final security sweep", () => {
  const files = sourceFiles("src");

  it("finds no hardcoded private keys or signing secrets", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes("__tests__")) continue;
      const text = readFileSync(file, "utf8");
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) offenders.push(file);
      // A 64-hex literal is a wallet key or signing secret, never config.
      if (/["']0x[a-fA-F0-9]{64}["']/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the service role key out of client-reachable modules", () => {
    const offenders = files.filter((file) => {
      if (/\.server\.tsx?$/.test(file)) return false;
      if (file.includes("integrations/supabase")) return false;
      return readFileSync(file, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY");
    });
    expect(offenders).toEqual([]);
  });

  it("never exposes a service role or secret key through import.meta.env", () => {
    const offenders = files.filter((file) =>
      /import\.meta\.env[^\n]*(SERVICE_ROLE|SECRET)/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("reads process.env only in server-only or route modules", () => {
    const offenders = files.filter((file) => {
      if (/\.server\.tsx?$/.test(file)) return false;
      if (file.includes("integrations/supabase")) return false;
      if (file.includes(join("src", "routes", "api"))) return false;
      if (/\.functions\.tsx?$/.test(file)) return false;
      if (file.endsWith(join("src", "start.ts"))) return false;
      return /process\.env\[/.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("stores roles in user_roles and never on profiles", () => {
    const offenders = files.filter((file) => /profiles[^\n]*\.\s*role\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
