/**
 * ARC — M7.4 Supabase provider abstraction.
 *
 * Verifies that control-plane backend selection is environment-driven only:
 * no compiled URLs, no provider assumptions, and no secret exposure.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

import {
  backendMatchesRequirement,
  maskBackendUrl,
  projectRefFromUrl,
  resolveSupabaseConfig,
} from "@/lib/supabase/config";

const VALID = {
  SUPABASE_URL: "https://wwapjpucrmrocnmkvjkm.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_example",
};

describe("supabase provider configuration", () => {
  it("fails closed when configuration is missing", () => {
    const config = resolveSupabaseConfig({});
    expect(config.configured).toBe(false);
    expect(config.url).toBeNull();
    expect(config.errors).toContain("SUPABASE_URL is not configured.");
    expect(config.errors).toContain("SUPABASE_ANON_KEY is not configured.");
  });

  it("rejects an invalid backend URL", () => {
    const config = resolveSupabaseConfig({ ...VALID, SUPABASE_URL: "not-a-url" });
    expect(config.configured).toBe(false);
    expect(config.errors).toContain("SUPABASE_URL is not a valid URL.");
  });

  it("rejects a non-https backend URL", () => {
    const config = resolveSupabaseConfig({ ...VALID, SUPABASE_URL: "http://example.supabase.co" });
    expect(config.configured).toBe(false);
    expect(config.errors).toContain("SUPABASE_URL must use https.");
  });

  it("initializes successfully from server environment names", () => {
    const config = resolveSupabaseConfig(VALID);
    expect(config.configured).toBe(true);
    expect(config.provider).toBe("supabase");
    expect(config.url).toBe("https://wwapjpucrmrocnmkvjkm.supabase.co");
    expect(config.projectRef).toBe("wwapjpucrmrocnmkvjkm");
  });

  it("initializes from browser environment names", () => {
    const config = resolveSupabaseConfig({
      VITE_SUPABASE_URL: "https://alpha.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_alpha",
    });
    expect(config.configured).toBe(true);
    expect(config.projectRef).toBe("alpha");
  });

  it("switches backend through environment only", () => {
    const a = resolveSupabaseConfig({ ...VALID, SUPABASE_URL: "https://alpha.supabase.co" });
    const b = resolveSupabaseConfig({ ...VALID, SUPABASE_URL: "https://beta.supabase.co" });
    expect(a.projectRef).toBe("alpha");
    expect(b.projectRef).toBe("beta");
  });

  it("masks the project reference for display", () => {
    expect(maskBackendUrl(VALID.SUPABASE_URL)).toBe("https://wwap****************.supabase.co");
    expect(maskBackendUrl(null)).toBe("not configured");
    expect(projectRefFromUrl(null)).toBeNull();
  });

  it("enforces the optional deployment guard", () => {
    const url = VALID.SUPABASE_URL;
    expect(backendMatchesRequirement({}, url)).toBe(true);
    expect(backendMatchesRequirement({ ARC_REQUIRED_SUPABASE_URL: url }, url)).toBe(true);
    expect(
      backendMatchesRequirement({ ARC_REQUIRED_SUPABASE_URL: "https://other.supabase.co" }, url),
    ).toBe(false);
  });
});

describe("provider abstraction boundaries", () => {
  const files = globSync("src/**/*.{ts,tsx}", { cwd: process.cwd() }).filter(
    (file) => !file.includes("integrations/supabase") && !file.includes("lib/supabase/"),
  );

  it("routes all browser Supabase access through the provider layer", () => {
    const offenders = files.filter((file) =>
      /from ["']@\/integrations\/supabase\/client["']/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("never compiles a backend URL, project ref or key into application logic", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /https:\/\/[a-z0-9]{20}\.supabase\.co/.test(source) || /sb_secret_/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
