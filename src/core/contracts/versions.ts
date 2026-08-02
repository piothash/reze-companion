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
  decisionEngine: v("decisionEngine", "1.0.0", ["1.0.0"], "TWAP-native decision engine contract"),
  executionIntent: v("executionIntent", "1.0.0", ["1.0.0"], "Immutable execution intent contract"),
  executionContext: v("executionContext", "1.0.0", ["1.0.0"], "Execution context runtime contract"),
  riskEngine: v("riskEngine", "1.0.0", ["1.0.0"], "Risk engine ALLOW/DENY verdict contract"),
  exposureModel: v(
    "exposureModel",
    "1.0.0",
    ["1.0.0"],
    "Exposure reservation and live-exposure model",
  ),
  orderContract: v("orderContract", "1.0.0", ["1.0.0"], "Order FSM and order snapshot contract"),
  standingOrderEngine: v(
    "standingOrderEngine",
    "1.0.0",
    ["1.0.0"],
    "Strategy-agnostic standing limit order engine contract",
  ),
  executionAdapter: v(
    "executionAdapter",
    "1.0.0",
    ["1.0.0"],
    "ARC execution adapter contract between intents and the standing order engine",
  ),
  eventStore: v("eventStore", "1.0.0", ["1.0.0"], "Append-only canonical event store contract"),
  ledger: v("ledger", "1.0.0", ["1.0.0"], "Business-only ledger record contract"),
  analytics: v("analytics", "1.0.0", ["1.0.0"], "Analytics summary contract computed from events"),
  notification: v("notification", "1.0.0", ["1.0.0"], "Internal notification framework contract"),
  auditTrail: v("auditTrail", "1.0.0", ["1.0.0"], "Platform audit trail record contract"),
  synchronization: v(
    "synchronization",
    "1.0.0",
    ["1.0.0"],
    "Companion↔Cloud synchronization policy contract",
  ),
  platformApi: v("platformApi", "1.0.0", ["1.0.0"], "Read-only platform API contract"),
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
