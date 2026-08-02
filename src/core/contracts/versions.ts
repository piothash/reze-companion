/**
 * ARC — version registry (P0/M0).
 *
 * Single authoritative table of every version ARC negotiates on. Versions are
 * semantic and append-only; changing an incompatible version requires an ADR.
 */

export interface VersionSpec {
  readonly id: string;
  readonly version: string;
  readonly compatible: readonly string[];
  readonly description: string;
}

function v(
  id: string,
  version: string,
  compatible: readonly string[],
  description: string,
): VersionSpec {
  return { id, version, compatible, description };
}

export const VERSION_REGISTRY = {
  platform: v("platform", "0.1.0", ["0.1.0"], "ARC companion control-plane platform"),
  engine: v("engine", "0.1.0", ["0.1.0"], "Companion-side engine surface set (M0 foundation only)"),
  eventSchema: v("eventSchema", "1.0.0", ["1.0.0"], "Canonical event envelope schema"),
  configuration: v("configuration", "1.0.0", ["1.0.0"], "Configuration document schema"),
  executionProfile: v(
    "executionProfile",
    "1.0.0",
    ["1.0.0"],
    "Execution profile definition format",
  ),
  riskProfile: v("riskProfile", "1.0.0", ["1.0.0"], "Risk profile definition format"),
  windowDefinition: v("windowDefinition", "1.0.0", ["1.0.0"], "Execution window definition format"),
  replayFormat: v("replayFormat", "1.0.0", ["1.0.0"], "Deterministic replay record format"),
  featureFlag: v("featureFlag", "1.0.0", ["1.0.0"], "Feature flag document format"),
  marketConfiguration: v(
    "marketConfiguration",
    "1.0.0",
    ["1.0.0"],
    "Market State Domain configuration format",
  ),
  marketState: v("marketState", "1.0.0", ["1.0.0"], "Authoritative market state snapshot contract"),
} as const satisfies Record<string, VersionSpec>;

export type VersionKey = keyof typeof VERSION_REGISTRY;

export function versionOf(key: VersionKey): string {
  return VERSION_REGISTRY[key].version;
}

export function isCompatible(key: VersionKey, candidate: string): boolean {
  const spec = VERSION_REGISTRY[key];
  return spec.version === candidate || spec.compatible.includes(candidate);
}

export function assertCompatible(key: VersionKey, candidate: string): void {
  if (!isCompatible(key, candidate)) {
    throw new Error(
      `Incompatible ${key} version: got ${candidate}, expected one of ${[
        VERSION_REGISTRY[key].version,
        ...VERSION_REGISTRY[key].compatible,
      ].join(", ")}`,
    );
  }
}

export function versionManifest(): Record<VersionKey, string> {
  const out = {} as Record<VersionKey, string>;
  for (const key of Object.keys(VERSION_REGISTRY) as VersionKey[]) {
    out[key] = VERSION_REGISTRY[key].version;
  }
  return out;
}
