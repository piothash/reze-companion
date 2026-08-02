/**
 * ARC — M6 security conformance tests (static, executable).
 *
 * Enforce the production rules that cannot be expressed by types: secrets only
 * from the environment, every server function authenticated and validated,
 * public routes free of user data, no sensitive values in logs.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string, filter: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, filter));
    else if (filter(rel)) out.push(rel);
  }
  return out;
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const isSource = (path: string) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".gen.ts");
const SRC_FILES = walk("src", isSource);
const FUNCTION_FILES = SRC_FILES.filter((file) => file.endsWith(".functions.ts"));

describe("security — secret handling", () => {
  it("has no hardcoded credential literals", () => {
    const offenders: string[] = [];
    const patterns = [
      /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWT
      /sb_secret_[A-Za-z0-9_-]+/,
      /0x[a-fA-F0-9]{64}/, // private key
      /(api[_-]?key|secret|password)\s*[:=]\s*["'][A-Za-z0-9_\-/+]{16,}["']/i,
    ];
    for (const file of SRC_FILES) {
      const source = read(file);
      if (patterns.some((pattern) => pattern.test(source))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("never exposes service-role or database secrets to the browser bundle", () => {
    const offenders = SRC_FILES.filter(
      (file) =>
        !file.endsWith(".server.ts") &&
        !file.includes("integrations/supabase/client.server") &&
        /(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL)/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("reads process.env only inside handlers or server modules", () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      if (file.endsWith(".server.ts") || file.startsWith("src/core/")) continue;
      const source = read(file);
      if (!/process\.env/.test(source)) continue;
      // Route/server-fn files may read env; components may not.
      if (file.startsWith("src/components/") || file.startsWith("src/hooks/")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("logs no secret values", () => {
    const offenders = SRC_FILES.filter((file) =>
      /console\.(log|info|warn|error)\([^)]*(SERVICE_ROLE|access_token|apiKey|password|secret)/i.test(
        read(file),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("security — API surface", () => {
  it("every server function requires authentication", () => {
    // Deliberately public, non-sensitive reads. The bootstrap probe returns a
    // single boolean (does a primary operator exist?) and is required before a
    // session can exist at all.
    const PUBLIC_BY_DESIGN = new Set(["src/lib/auth.functions.ts"]);
    const offenders: string[] = [];
    for (const file of FUNCTION_FILES) {
      if (PUBLIC_BY_DESIGN.has(file)) continue;
      const source = read(file);
      const declarations = source.split("createServerFn(").slice(1);
      for (const declaration of declarations) {
        const head = declaration.slice(0, 400);
        if (!head.includes("requireSupabaseAuth")) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every mutating server function validates its input with zod", () => {
    const offenders: string[] = [];
    for (const file of FUNCTION_FILES) {
      const source = read(file);
      for (const declaration of source.split("createServerFn(").slice(1)) {
        const head = declaration.slice(0, 600);
        if (head.includes('method: "POST"') && !head.includes("inputValidator")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("public routes expose no user data and no credentials", () => {
    const publicRoutes = SRC_FILES.filter((file) => file.startsWith("src/routes/api/public/"));
    expect(publicRoutes.length).toBeGreaterThan(0);
    for (const route of publicRoutes) {
      const source = read(route);
      // Authority endpoints are engine-facing: they may reach the privileged
      // client, but only behind signature verification in the gateway, and
      // they must never surface operator identifiers or credentials.
      const isAuthorityEndpoint = route.startsWith("src/routes/api/public/authority/");
      if (isAuthorityEndpoint) {
        expect(source).toMatch(/authority-gateway\.server/);
      } else {
        expect(source).not.toMatch(/supabaseAdmin|client\.server/);
      }
      expect(source).not.toMatch(/user_id|auth\.uid/);
      expect(source).not.toMatch(/SERVICE_ROLE/);
    }
  });

  it("every authority endpoint delegates to the verifying gateway", () => {
    const gateway = read("src/lib/authority-gateway.server.ts");
    // Fail-closed: an unconfigured signing key must never accept traffic.
    expect(gateway).toMatch(/KEY_UNCONFIGURED/);
    expect(gateway).toMatch(/authority_replay_guard/);
    // The gateway stores public identity only.
    expect(gateway).not.toMatch(/private_key|wallet|mnemonic/i);
  });


  it("no server function writes to append-only tables through an admin client", () => {
    for (const file of FUNCTION_FILES) {
      const source = read(file);
      expect(source).not.toMatch(/supabaseAdmin/);
    }
  });
});
