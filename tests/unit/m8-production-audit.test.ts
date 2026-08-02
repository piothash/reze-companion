/**
 * ARC — M8.0 final production audit.
 *
 * Executable governance for the mainnet readiness gate. These tests prove the
 * gate cannot be talked into a PASS: every domain needs observed evidence,
 * absence of evidence is PENDING, and there is no override path.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MAINNET_DOMAINS,
  MAINNET_DOMAIN_SPECS,
  evaluateMainnetReadiness,
  mainnetBlockers,
  mainnetVerdict,
  type MainnetReadinessInput,
  type OperationsEvidence,
} from "@/core/qualification/mainnet";
import { QUALIFICATION_GATES } from "@/core/qualification/gates";
import { LIVE_GATES } from "@/core/qualification/live-gates";
import { ACTIVATION_STEP_IDS, type ActivationStep } from "@/core/qualification/activation";

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Fixtures — a fully green world, then one thing removed at a time.
// ---------------------------------------------------------------------------

const harnessAll = (status: "PASS" | "FAIL" | "PENDING") =>
  QUALIFICATION_GATES.map((gate) => ({ ...gate, status, detail: `${gate.id} ${status}` }));

const liveAll = (status: "PASS" | "FAIL" | "PENDING") =>
  LIVE_GATES.map((gate) => ({ ...gate, status, detail: `${gate.id} ${status}` }));

const activationAll = (status: ActivationStep["status"]): ActivationStep[] =>
  ACTIVATION_STEP_IDS.map((id) => ({
    id,
    owner: "VPS",
    title: id,
    action: "act",
    evidence: "evidence",
    status,
    detail: "detail",
    reason: "reason",
    required: "required",
    transition: "transition",
  }));

const operations: OperationsEvidence = {
  processUptimeSeconds: 86_400,
  registrationCount: 2,
  eventSequence: 4821,
  sequenceRegressed: false,
};

const green: MainnetReadinessInput = {
  harness: harnessAll("PASS"),
  live: liveAll("PASS"),
  activation: activationAll("DONE"),
  operations,
};

// ---------------------------------------------------------------------------

describe("M8.0 — mainnet readiness gate", () => {
  it("covers the eight mandated production domains exactly once", () => {
    expect(MAINNET_DOMAIN_SPECS.map((spec) => spec.domain)).toEqual([...MAINNET_DOMAINS]);
    expect(new Set(MAINNET_DOMAINS).size).toBe(8);
  });

  it("qualifies for mainnet only when every domain passes on evidence", () => {
    const results = evaluateMainnetReadiness(green);
    expect(results.every((result) => result.status === "PASS")).toBe(true);
    expect(mainnetVerdict(results)).toBe("QUALIFIED FOR MAINNET");
    expect(mainnetBlockers(results)).toHaveLength(0);
  });

  it("reports NOT QUALIFIED when no evidence exists at all", () => {
    const results = evaluateMainnetReadiness({
      harness: [],
      live: [],
      activation: [],
      operations: null,
    });
    expect(results.every((result) => result.status === "PENDING")).toBe(true);
    expect(mainnetVerdict(results)).toBe("NOT QUALIFIED");
  });

  it("treats absence of evidence as PENDING, never as PASS or FAIL", () => {
    const results = evaluateMainnetReadiness({
      ...green,
      live: liveAll("PENDING"),
    });
    const security = results.find((result) => result.domain === "SECURITY")!;
    expect(security.status).toBe("PENDING");
    expect(security.blockers.length).toBeGreaterThan(0);
    expect(mainnetVerdict(results)).toBe("NOT QUALIFIED");
  });

  it("fails the replay domain when replay is not deterministic", () => {
    const harness = harnessAll("PASS").map((gate) =>
      gate.id === "replay.deterministic"
        ? { ...gate, status: "FAIL" as const, detail: "digest mismatch" }
        : gate,
    );
    const results = evaluateMainnetReadiness({ ...green, harness });
    expect(results.find((result) => result.domain === "REPLAY")!.status).toBe("FAIL");
    expect(mainnetVerdict(results)).toBe("NOT QUALIFIED");
  });

  it("fails the recovery domain when a duplicate intent survives a restart", () => {
    const harness = harnessAll("PASS").map((gate) =>
      gate.id === "recovery.no_duplicate"
        ? { ...gate, status: "FAIL" as const, detail: "intent executed twice" }
        : gate,
    );
    const results = evaluateMainnetReadiness({ ...green, harness });
    const recovery = results.find((result) => result.domain === "RECOVERY")!;
    expect(recovery.status).toBe("FAIL");
    expect(recovery.blockers.join(" ")).toContain("twice");
  });

  it("fails the VPS domain when the authority is not ACTIVE", () => {
    const live = liveAll("PASS").map((gate) =>
      gate.id === "authority.active"
        ? { ...gate, status: "FAIL" as const, detail: "heartbeat 900s old" }
        : gate,
    );
    const results = evaluateMainnetReadiness({ ...green, live });
    expect(results.find((result) => result.domain === "VPS")!.status).toBe("FAIL");
  });

  it("fails the configuration domain on runtime drift", () => {
    const live = liveAll("PASS").map((gate) =>
      gate.id === "configuration.activation"
        ? { ...gate, status: "FAIL" as const, detail: "runtime drift detected" }
        : gate,
    );
    const results = evaluateMainnetReadiness({ ...green, live });
    const configuration = results.find((result) => result.domain === "CONFIGURATION")!;
    expect(configuration.status).toBe("FAIL");
    expect(configuration.blockers.join(" ")).toContain("drift");
  });

  it("fails the telemetry domain when mandated fields are missing", () => {
    const live = liveAll("PASS").map((gate) =>
      gate.id === "telemetry.complete"
        ? { ...gate, status: "FAIL" as const, detail: "missing eventSequence, latency" }
        : gate,
    );
    const results = evaluateMainnetReadiness({ ...green, live });
    expect(results.find((result) => result.domain === "TELEMETRY")!.status).toBe("FAIL");
  });

  it("fails operations when a restart regresses the canonical event sequence", () => {
    const results = evaluateMainnetReadiness({
      ...green,
      operations: { ...operations, sequenceRegressed: true },
    });
    const ops = results.find((result) => result.domain === "OPERATIONS")!;
    expect(ops.status).toBe("FAIL");
    expect(ops.blockers.join(" ")).toContain("duplicate events");
  });

  it("holds operations PENDING while activation steps are open", () => {
    const results = evaluateMainnetReadiness({
      ...green,
      activation: activationAll("READY"),
    });
    const ops = results.find((result) => result.domain === "OPERATIONS")!;
    expect(ops.status).toBe("PENDING");
    expect(mainnetVerdict(results)).toBe("NOT QUALIFIED");
  });

  it("holds operations PENDING when the engine never reported uptime", () => {
    const results = evaluateMainnetReadiness({ ...green, operations: null });
    expect(results.find((result) => result.domain === "OPERATIONS")!.status).toBe("PENDING");
  });

  it("keeps the architecture domain tied to the observed canonical lifecycle", () => {
    const harness = harnessAll("PASS").map((gate) =>
      gate.id === "lifecycle.settlement"
        ? { ...gate, status: "FAIL" as const, detail: "exposure still reserved" }
        : gate,
    );
    const results = evaluateMainnetReadiness({ ...green, harness });
    expect(results.find((result) => result.domain === "ARCHITECTURE")!.status).toBe("FAIL");
  });

  it("lists every open item with its owning domain", () => {
    const results = evaluateMainnetReadiness({
      harness: harnessAll("PENDING"),
      live: liveAll("PENDING"),
      activation: [],
      operations: null,
    });
    const blockers = mainnetBlockers(results);
    expect(blockers.length).toBeGreaterThan(0);
    expect(new Set(blockers.map((entry) => entry.domain)).size).toBe(8);
  });

  it("never exposes an override, force or manual-approval path", () => {
    const source = readFileSync(join(ROOT, "src/core/qualification/mainnet.ts"), "utf8")
      // Strip comments: prose may *describe* the absence of an override.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // No override/force/approval switch may exist in the API surface.
    expect(source).not.toMatch(
      /\b(override|force|forced|manualApproval|approved?|attestation)\s*[?:]/i,
    );
    expect(source).not.toMatch(/\boverride\w*\s*[=(]/i);
    // mainnetVerdict takes exactly one argument: the evaluated domains.
    expect(mainnetVerdict.length).toBe(1);
  });

  it("returns frozen results so a caller cannot mutate a verdict", () => {
    const results = evaluateMainnetReadiness(green);
    expect(Object.isFrozen(results)).toBe(true);
    expect(() => {
      (results as unknown as { push: (value: unknown) => void }).push({});
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Production audit conformance — evidence for the M8 report.
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(rel) && !rel.endsWith(".gen.ts")) out.push(rel);
  }
  return out;
}

const SRC_FILES = walk("src");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("M8.0 — production audit conformance", () => {
  it("ships the required M8 documentation", () => {
    for (const doc of [
      "docs/qualification/M8_PRODUCTION_READINESS_REPORT.md",
      "docs/deployment/M8_PM2_VALIDATION.md",
      "docs/operations/M8_MONITORING.md",
    ]) {
      expect(readFileSync(join(ROOT, doc), "utf8").length).toBeGreaterThan(500);
    }
  });

  it("keeps the mainnet gate pure — no I/O, no Supabase, no clock in the module", () => {
    const source = read("src/core/qualification/mainnet.ts");
    expect(source).not.toMatch(/supabase|fetch\(|Date\.now|process\.env/);
  });

  it("never reads a service role key or signing key outside server-only modules", () => {
    const offenders = SRC_FILES.filter((path) => {
      if (/\.server\.tsx?$/.test(path) || path.startsWith("src/integrations/")) return false;
      // Only an actual environment read counts; naming the variable in
      // operator guidance text is not an exposure.
      return /process\.env\[?["'`]?(SUPABASE_SERVICE_ROLE_KEY|ARC_AUTHORITY_SIGNING_KEY)/.test(
        read(path),
      );
    });
    // qualification.functions.ts reads the signing key inside its handler only.
    expect(offenders.filter((path) => !path.endsWith(".functions.ts"))).toEqual([]);
  });

  it("contains no legacy strategy vocabulary anywhere in src", () => {
    const legacy = /\b(majorityStrategy|confidenceScore|signalStrength|alphaModel)\b/;
    expect(SRC_FILES.filter((path) => legacy.test(read(path)))).toEqual([]);
  });

  it("never implements trading execution in the companion", () => {
    const forbidden = /\b(placeOrder|submitToExchange|signTransaction|privateKey)\b/;
    const offenders = SRC_FILES.filter(
      (path) => !path.startsWith("src/core/") && forbidden.test(read(path)),
    );
    expect(offenders).toEqual([]);
  });
});
