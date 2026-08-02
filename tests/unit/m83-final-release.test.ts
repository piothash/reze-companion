import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

const TEMPLATES = [".env.example", ".env.production.example", ".env.vps.example"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("M8.3 — fresh-clone completeness", () => {
  it("exposes every script a new operator is told to run", () => {
    for (const script of [
      "dev",
      "build",
      "preview",
      "lint",
      "format",
      "typecheck",
      "test",
      "test:coverage",
      "check:env",
      "verify",
    ]) {
      expect({ script, present: typeof pkg.scripts[script] === "string" }).toEqual({
        script,
        present: true,
      });
    }
  });

  it("ships deployment assets required for a VPS bring-up", () => {
    for (const file of [
      "ecosystem.config.cjs",
      "scripts/check-env.mjs",
      "CHANGELOG.md",
      "README.md",
      ".env.example",
      ".env.production.example",
      ".env.vps.example",
      "docs/deployment/PRODUCTION_SETUP.md",
      "docs/operations/BACKUP_AND_RECOVERY.md",
      "docs/operations/M8_MONITORING.md",
      "docs/OPERATIONS_RUNBOOK.md",
      "docs/architecture/ADR_INDEX.md",
      "docs/IMPLEMENTATION_TRACKER.md",
      "supabase/config.toml",
    ]) {
      expect({ file, present: existsSync(file) }).toEqual({ file, present: true });
    }
  });

  it("keeps the trading authority a single non-clustered PM2 process", () => {
    const body = readFileSync("ecosystem.config.cjs", "utf8");
    expect(body).toContain("arc-engine");
    expect(body).toContain("arc-companion");
    expect(body).toContain('exec_mode: "fork"');
    expect(body).not.toContain('exec_mode: "cluster"');
  });

  it("ships every operator route referenced by the operations platform", () => {
    for (const route of [
      "dashboard",
      "markets",
      "execution-profiles",
      "windows",
      "trade-monitor",
      "signal-tank",
      "replay",
      "analytics",
      "health",
      "notifications",
      "configuration",
      "operations",
      "deployment",
      "qualification",
      "ownership",
      "engine-registration",
      "audit",
      "system",
    ]) {
      const file = `src/routes/_authenticated/${route}.tsx`;
      expect({ file, present: existsSync(file) }).toEqual({ file, present: true });
    }
  });

  it("provisions the whole schema through migrations, with no manual SQL step", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n")
      .toLowerCase();

    for (const table of [
      "profiles",
      "user_roles",
      "engine_endpoints",
      "engine_snapshots",
      "event_log",
      "notifications",
      "feature_flags",
      "configuration_profiles",
      "configuration_versions",
      "runtime_configuration_state",
      "authority_registry",
      "audit_log",
    ]) {
      expect({ table, created: sql.includes(`create table public.${table}`) }).toEqual({
        table,
        created: true,
      });
    }

    expect(sql).toContain("enable row level security");
    expect(sql).toContain("create policy");
    expect(sql).toContain("grant ");
  });

  it("documents every environment variable the code actually reads", () => {
    const used = new Set<string>();
    for (const file of [...walk("src"), ...walk("tests")]) {
      const body = readFileSync(file, "utf8");
      for (const match of body.matchAll(/process\.env\[?["']?([A-Z0-9_]+)["']?\]?/g)) {
        used.add(match[1]!);
      }
    }

    const templates = TEMPLATES.map((file) => readFileSync(file, "utf8")).join("\n");
    const missing = [...used].filter((key) => !templates.includes(`${key}=`)).sort();
    expect(missing).toEqual([]);
  });

  it("never commits a real secret value in a template or PM2 file", () => {
    const files = [...TEMPLATES, "ecosystem.config.cjs"];
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      for (const line of body.split("\n")) {
        const [, value] = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line)?.slice(1) ?? [];
        if (value === undefined) continue;
        const bare = value.split("#")[0]!.trim();
        // 32+ hex chars would be a real signing key / token.
        expect({ file, line, leaked: /^[a-f0-9]{32,}$/i.test(bare) }).toEqual({
          file,
          line,
          leaked: false,
        });
      }
      expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT-shaped key
    }
  });
});
