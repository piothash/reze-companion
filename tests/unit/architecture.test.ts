/**
 * ARC — M6 architecture conformance tests.
 *
 * These tests are executable governance: they fail the build if the frozen
 * layering, the charter boundaries or the strategy purge are ever violated.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, dirname } from "node:path";
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

const isSource = (path: string) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".gen.ts");
const CORE_FILES = walk("src/core", isSource);
const SRC_FILES = walk("src", isSource);
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Frozen dependency direction (ADR-0001). Lower index may never import higher. */
const LAYERS = [
  "shared",
  "contracts",
  "configuration",
  "infrastructure",
  "market",
  "decision",
  "trade",
  "platform",
] as const;

function layerOf(path: string): string | null {
  const match = /^src\/core\/([a-z-]+)\//.exec(path);
  return match?.[1] ?? null;
}

function importsOf(path: string): string[] {
  const source = read(path);
  const targets: string[] = [];
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1]!;
    if (specifier.startsWith("@/")) targets.push(`src/${specifier.slice(2)}`);
    else if (specifier.startsWith(".")) targets.push(normalize(join(dirname(path), specifier)));
  }
  return targets;
}

describe("architecture — dependency direction", () => {
  it("no core layer imports a layer above it", () => {
    const violations: string[] = [];
    for (const file of CORE_FILES) {
      const from = layerOf(file);
      if (!from) continue;
      for (const target of importsOf(file)) {
        const to = /^src\/core\/([a-z-]+)\//.exec(`${target}/`)?.[1];
        if (!to || to === from) continue;
        const fromIndex = LAYERS.indexOf(from as (typeof LAYERS)[number]);
        const toIndex = LAYERS.indexOf(to as (typeof LAYERS)[number]);
        if (fromIndex === -1 || toIndex === -1) continue;
        if (toIndex > fromIndex) violations.push(`${file} -> ${to}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("core never imports UI, routes or integrations", () => {
    const violations: string[] = [];
    for (const file of CORE_FILES) {
      for (const target of importsOf(file)) {
        if (/^src\/(routes|components|hooks|integrations)\b/.test(target)) {
          violations.push(`${file} -> ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("only *.server.ts modules touch the service-role client", () => {
    const offenders = SRC_FILES.filter(
      (file) =>
        !file.endsWith(".server.ts") &&
        !file.includes("integrations/supabase") &&
        /client\.server/.test(read(file)) &&
        !/await import\(/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("architecture — charter conformance", () => {
  it("contains no legacy majority/crowd strategy identifiers", () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      for (const line of read(file).split("\n")) {
        // Prose in doc comments explicitly forbids the concepts; only code counts.
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
        if (/\b(majorityDirection|majorityConfidence|crowdSentiment|voteCount|binanceDirection)\b/.test(line)) {
          offenders.push(`${file}: ${trimmed}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not place orders or call a venue from the companion", () => {
    const offenders = SRC_FILES.filter((file) =>
      /(clob|polymarket)\.(post|placeOrder)|new\s+ClobClient|ethers\./i.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("never imports the read-only reference mirror", () => {
    const offenders = SRC_FILES.filter((file) =>
      /(from|import)\s*\(?\s*["'][^"']*docs\/reference\/p4/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("has no TODO/FIXME markers in production code", () => {
    const offenders = SRC_FILES.filter((file) => /\b(TODO|FIXME|XXX):/.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
