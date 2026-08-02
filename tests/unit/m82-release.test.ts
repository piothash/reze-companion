import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  ARC_ENV_SPECS,
  assertEnvironmentValid,
  formatEnvFailure,
  validateEnvironment,
} from "@/core/configuration/env-validator";

const TEMPLATES = [".env.example", ".env.production.example", ".env.vps.example"] as const;

function template(name: string): string {
  return readFileSync(name, "utf8");
}

describe("M8.2 — production environment templates", () => {
  it("documents every declared environment variable in every companion template", () => {
    const companion = [".env.example", ".env.production.example"];
    for (const file of companion) {
      const body = template(file);
      const missing = ARC_ENV_SPECS.filter((spec) => !body.includes(`${spec.key}=`)).map(
        (spec) => spec.key,
      );
      expect({ file, missing }).toEqual({ file, missing: [] });
    }
  });

  it("covers the mandated sections", () => {
    for (const file of TEMPLATES) {
      const body = template(file);
      for (const section of [
        "Application",
        "Supabase",
        "Authority",
        "Engine",
        "Feed",
        "Scheduler",
        "Replay",
        "Notifications",
        "Logging",
        "Security",
        "Feature flags",
        "Qualification",
      ]) {
        expect({ file, section, present: body.includes(section) }).toEqual({
          file,
          section,
          present: true,
        });
      }
    }
  });

  it("never ships a real value for a secret-bearing variable", () => {
    const secretKeys = [
      "ARC_AUTHORITY_SIGNING_KEY",
      "SUPABASE_ANON_KEY",
      "ARC_VPS_API_TOKEN",
      "SUPABASE_SERVICE_ROLE",
    ];
    for (const file of TEMPLATES) {
      for (const line of template(file).split("\n")) {
        const key = line.split("=")[0]?.trim() ?? "";
        if (!secretKeys.some((secret) => key.startsWith(secret))) continue;
        const value = line.slice(line.indexOf("=") + 1).split("#")[0]?.trim() ?? "";
        expect({ file, key, value }).toEqual({ file, key, value: "" });
      }
    }
  });

  it("keeps the signing key value out of templates and documentation", () => {
    for (const file of TEMPLATES) {
      const line = template(file)
        .split("\n")
        .find((entry) => entry.startsWith("ARC_AUTHORITY_SIGNING_KEY="));
      expect(line?.startsWith("ARC_AUTHORITY_SIGNING_KEY=  ")).toBe(true);
    }
  });
});

describe("M8.2 — environment validation failures are operator friendly", () => {
  it("fails loudly instead of applying a silent default", () => {
    const report = validateEnvironment({});
    expect(report.valid).toBe(false);
    const message = formatEnvFailure(report);
    expect(message).toContain("ARC startup aborted");
    expect(message).toContain("Problem:");
    expect(message).toContain("Action:");
    expect(message).toContain("Recovery:");
    expect(message).toContain("ARC_ENVIRONMENT");
  });

  it("throws with the operator explanation when a required variable is missing", () => {
    expect(() => assertEnvironmentValid({})).toThrowError(/ARC startup aborted/);
  });

  it("never echoes a secret value in the failure output", () => {
    const report = validateEnvironment({ SUPABASE_ANON_KEY: "super-secret-value-1234567890" });
    expect(formatEnvFailure(report)).not.toContain("super-secret-value");
    expect(JSON.stringify(report.values)).not.toContain("super-secret-value");
  });

  it("requires the shared signing key on mainnet only", () => {
    const base = { ARC_NETWORK: "mainnet" };
    const report = validateEnvironment(base);
    expect(report.issues.some((entry) => entry.key === "ARC_AUTHORITY_SIGNING_KEY")).toBe(true);
    const testnet = validateEnvironment({ ARC_NETWORK: "testnet" });
    expect(testnet.issues.some((entry) => entry.key === "ARC_AUTHORITY_SIGNING_KEY")).toBe(false);
  });
});
