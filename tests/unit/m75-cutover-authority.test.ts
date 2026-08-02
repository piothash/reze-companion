/**
 * ARC — M7.5: production cutover + authority registration framework.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  backendMatchesRequirement,
  resolveSupabaseConfig,
} from "@/lib/supabase/config";
import {
  CUTOVER_GUARDED_ACTIONS,
  REQUIRED_CONTROL_PLANE_TABLES,
  cutoverBlockedMessage,
  evaluateMigrationReadiness,
} from "@/lib/supabase/cutover";
import {
  AUTHORITY_ENDPOINTS,
  AUTHORITY_STALE_AFTER_MILLIS,
  authorityHeartbeatSchema,
  deriveAuthorityStatus,
  parseAuthorityRegistration,
  rejectsAuthoritySecrets,
} from "@/core/platform/authority-registration";

const PRODUCTION_URL = "https://example-prod-ref.supabase.co";
const OTHER_URL = "https://example-dev-ref.supabase.co";

function baseEnv(url: string, required?: string): Record<string, string | undefined> {
  return {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: "sb_publishable_test_key_value",
    ...(required ? { ARC_REQUIRED_SUPABASE_URL: required } : {}),
  };
}

function srcFiles(dir = "src", acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) srcFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("M7.5 — Supabase target validation", () => {
  it("passes when the active backend equals the required cutover target", () => {
    const env = baseEnv(PRODUCTION_URL, PRODUCTION_URL);
    const config = resolveSupabaseConfig(env);
    expect(config.configured).toBe(true);
    expect(backendMatchesRequirement(env, config.url)).toBe(true);
  });

  it("fails closed when the active backend is a different project", () => {
    const env = baseEnv(OTHER_URL, PRODUCTION_URL);
    expect(backendMatchesRequirement(env, resolveSupabaseConfig(env).url)).toBe(false);
  });

  it("tolerates a trailing slash on the required target", () => {
    const env = baseEnv(PRODUCTION_URL, `${PRODUCTION_URL}/`);
    expect(backendMatchesRequirement(env, resolveSupabaseConfig(env).url)).toBe(true);
  });

  it("is unenforced when no deployment guard is configured", () => {
    const env = baseEnv(OTHER_URL);
    expect(backendMatchesRequirement(env, resolveSupabaseConfig(env).url)).toBe(true);
  });

  it("names every guarded operator action in the blocked message", () => {
    for (const action of CUTOVER_GUARDED_ACTIONS) {
      expect(cutoverBlockedMessage(action)).toContain(action);
      expect(cutoverBlockedMessage(action)).toContain("ARC_REQUIRED_SUPABASE_URL");
    }
  });

  it("guards sign-in, ownership, configuration publishing and authority registration", () => {
    expect([...CUTOVER_GUARDED_ACTIONS]).toEqual([
      "sign-in",
      "ownership-change",
      "configuration-publish",
      "authority-registration",
    ]);
  });

  it("never compiles the production project reference into the source tree", () => {
    const offenders = srcFiles().filter((file) =>
      /wwapjpucrmrocnmkvjkm|yiysccpovqwtuylagoqa/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("M7.5 — migration readiness checklist", () => {
  const present = [
    "operator_ownership",
    "configuration_versions",
    "audit_log",
    "user_roles",
    "authority_registry",
    "runtime_configuration_state",
  ];

  it("reports ready when every required contract has a backing table", () => {
    const report = evaluateMigrationReadiness(present);
    expect(report.ready).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it("reports migration required instead of recreating tables", () => {
    const report = evaluateMigrationReadiness(
      present.filter((table) => table !== "authority_registry"),
    );
    expect(report.ready).toBe(false);
    expect(report.missing).toContain("authority_registry");
    expect(report.detail).toContain("Migration required");
  });

  it("marks aliased contracts as satisfied by their real implementation", () => {
    const report = evaluateMigrationReadiness(present);
    const mirror = report.rows.find((row) => row.logicalName === "runtime_mirrors");
    expect(mirror?.physicalName).toBe("runtime_configuration_state");
    expect(mirror?.readiness).toBe("SATISFIED");
  });

  it("covers every table named in the cutover specification", () => {
    const names = REQUIRED_CONTROL_PLANE_TABLES.map((spec) => spec.logicalName);
    for (const required of [
      "operator_ownership",
      "configuration_versions",
      "audit_log",
      "operator_sessions",
      "authority_registry",
      "configuration_dispatch",
      "runtime_mirrors",
    ]) {
      expect(names).toContain(required);
    }
  });
});

describe("M7.5 — authority registration contract", () => {
  const registration = {
    authorityId: "arc-vps-authority-01",
    name: "ARC VPS Authority",
    environment: "testnet",
    engineVersion: "0.1.0",
    platformVersion: "0.1.0",
    capabilities: ["decision", "risk", "execution"],
    timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    signature: "c2lnbmF0dXJlLXZhbHVlLTAwMDE=",
  };

  it("exposes the four contract endpoints with the correct initiators", () => {
    expect(AUTHORITY_ENDPOINTS.register).toMatchObject({
      method: "POST",
      path: "/authority/register",
      initiatedBy: "vps",
    });
    expect(AUTHORITY_ENDPOINTS.heartbeat.path).toBe("/authority/heartbeat");
    expect(AUTHORITY_ENDPOINTS.status.initiatedBy).toBe("companion");
    expect(AUTHORITY_ENDPOINTS.telemetry.initiatedBy).toBe("companion");
  });

  it("accepts a well-formed registration", () => {
    const parsed = parseAuthorityRegistration(registration);
    expect(parsed.authorityId).toBe("arc-vps-authority-01");
    expect(parsed.capabilities).toContain("execution");
  });

  it("requires a signature and timestamp on every registration", () => {
    expect(() => parseAuthorityRegistration({ ...registration, signature: "" })).toThrow();
    expect(() => parseAuthorityRegistration({ ...registration, timestamp: "not-a-date" })).toThrow();
  });

  it("requires a signature on every heartbeat", () => {
    expect(() =>
      authorityHeartbeatSchema.parse({
        authorityId: registration.authorityId,
        environment: "testnet",
        engineVersion: "0.1.0",
        platformVersion: "0.1.0",
        timestamp: registration.timestamp,
      }),
    ).toThrow();
  });

  it("rejects secret material offered as public identity", () => {
    expect(
      rejectsAuthoritySecrets({
        authorityId: "a-valid-id",
        name: "engine",
        publicKey: "-----BEGIN RSA PRIVATE KEY-----",
      }),
    ).toBeTruthy();
    expect(
      rejectsAuthoritySecrets({
        authorityId: "a-valid-id",
        name: "engine",
        publicKey: `0x${"a".repeat(64)}`,
      }),
    ).toBeTruthy();
    expect(() =>
      parseAuthorityRegistration({ ...registration, name: "wallet private key" }),
    ).toThrow(/public identity only/);
  });

  it("derives liveness from the last heartbeat only", () => {
    const now = Date.parse("2026-01-01T00:10:00.000Z");
    const fresh = new Date(now - 1_000).toISOString();
    const old = new Date(now - AUTHORITY_STALE_AFTER_MILLIS - 1_000).toISOString();
    expect(deriveAuthorityStatus("registered", fresh, now)).toBe("active");
    expect(deriveAuthorityStatus("registered", old, now)).toBe("stale");
    expect(deriveAuthorityStatus("registered", null, now)).toBe("registered");
    expect(deriveAuthorityStatus("revoked", fresh, now)).toBe("revoked");
  });
});

describe("M7.5 — control plane boundaries", () => {
  it("guards every mutating ownership, configuration and authority server function", () => {
    for (const file of [
      "src/lib/ownership.functions.ts",
      "src/lib/configuration.functions.ts",
      "src/lib/authority.functions.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      const mutations = source.match(/createServerFn\(\{ method: "POST" \}\)/g) ?? [];
      const guards = source.match(/assertCutoverSafe\(/g) ?? [];
      expect(guards.length).toBe(mutations.length);
    }
  });

  it("keeps authority persistence server-only and free of credential columns", () => {
    const source = readFileSync("src/lib/authority-registry.server.ts", "utf8");
    expect(source).not.toMatch(/private_key|wallet|exchange_key|api_secret/i);
    expect(source).toContain("parseAuthorityRegistration");
  });

  it("never lets the dashboard write runtime trading state", () => {
    const offenders = srcFiles("src/lib").filter((file) =>
      /from\("(engine_runtime_identity|ledger_records|platform_events)"\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
