/**
 * ARC — TWAP feed provider abstraction (M7.0).
 *
 * Pure module. It maps the deployment environment onto a feed provider profile
 * so the V1 (testnet) → V2 (mainnet / Chainlink Data Streams) transition is a
 * `.env` change and a PM2 restart — never a code change (ADR-0005).
 *
 * Nothing here samples a feed, decides anything or touches the network: it
 * resolves configuration and explains what an environment is missing.
 */

export const FEED_GENERATIONS = ["V1", "V2"] as const;
export type FeedGeneration = (typeof FEED_GENERATIONS)[number];

/** Transport implementations the Feed Engine can construct. */
export const FEED_TRANSPORTS = ["http-json", "in-memory"] as const;
export type FeedTransport = (typeof FEED_TRANSPORTS)[number];

/**
 * Semantic provider ids an operator writes in `TWAP_FEED_PROVIDER`.
 * `http-json` / `in-memory` remain accepted as raw transport aliases so
 * pre-M7 environments keep loading unchanged.
 */
export const FEED_PROVIDER_IDS = [
  "in-memory",
  "http-json",
  "testnet",
  "mainnet",
  "chainlink-datastreams",
] as const;
export type FeedProviderId = (typeof FEED_PROVIDER_IDS)[number];

export interface FeedProviderProfile {
  readonly id: FeedProviderId;
  readonly transport: FeedTransport;
  readonly generation: FeedGeneration;
  /** Network implied by the provider when `NETWORK` is not set explicitly. */
  readonly defaultNetwork: string | null;
  readonly requiresFeedId: boolean;
  readonly requiresEndpoint: boolean;
  readonly defaultValuePath: string;
  readonly defaultTimestampPath: string;
  readonly description: string;
}

export const FEED_PROVIDER_PROFILES: Record<FeedProviderId, FeedProviderProfile> = {
  "in-memory": {
    id: "in-memory",
    transport: "in-memory",
    generation: "V1",
    defaultNetwork: "testnet",
    requiresFeedId: false,
    requiresEndpoint: false,
    defaultValuePath: "price",
    defaultTimestampPath: "timestamp",
    description:
      "Deterministic in-process observations. Tests and replay only — never a deployment.",
  },
  "http-json": {
    id: "http-json",
    transport: "http-json",
    generation: "V1",
    defaultNetwork: null,
    requiresFeedId: true,
    requiresEndpoint: true,
    defaultValuePath: "price",
    defaultTimestampPath: "timestamp",
    description: "Generic JSON feed. Explicit endpoint template required.",
  },
  testnet: {
    id: "testnet",
    transport: "http-json",
    generation: "V1",
    defaultNetwork: "testnet",
    requiresFeedId: true,
    requiresEndpoint: true,
    defaultValuePath: "price",
    defaultTimestampPath: "timestamp",
    description: "V1 qualification feed: the official testnet TWAP feed over JSON.",
  },
  mainnet: {
    id: "mainnet",
    transport: "http-json",
    generation: "V2",
    defaultNetwork: "mainnet",
    requiresFeedId: true,
    requiresEndpoint: true,
    defaultValuePath: "price",
    defaultTimestampPath: "timestamp",
    description: "V2 production feed over JSON on mainnet.",
  },
  "chainlink-datastreams": {
    id: "chainlink-datastreams",
    transport: "http-json",
    generation: "V2",
    defaultNetwork: "mainnet",
    requiresFeedId: true,
    requiresEndpoint: true,
    defaultValuePath: "report.price",
    defaultTimestampPath: "report.observationsTimestamp",
    description: "V2 production feed: Chainlink Data Streams reports over JSON.",
  },
};

export class FeedProviderError extends Error {
  constructor(readonly issues: readonly { key: string; message: string }[]) {
    super(
      `ARC feed provider environment invalid — ${issues
        .map((issue) => `${issue.key}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "FeedProviderError";
  }
}

/** Environment keys that fully describe the feed provider in force. */
export const FEED_PROVIDER_ENV_KEYS = [
  "TWAP_FEED_PROVIDER",
  "TWAP_FEED_ID",
  "NETWORK",
  "TWAP_NETWORK",
  "TWAP_FEED_ENDPOINT",
  "TWAP_FEED_VALUE_PATH",
  "TWAP_FEED_TIMESTAMP_PATH",
] as const;

export interface ResolvedFeedProvider {
  readonly profile: FeedProviderProfile;
  readonly providerId: FeedProviderId;
  readonly transport: FeedTransport;
  readonly generation: FeedGeneration;
  readonly feedId: string;
  readonly network: string;
  readonly endpointTemplate: string | undefined;
  readonly valuePath: string;
  readonly timestampPath: string;
}

type Env = Record<string, string | undefined>;

function read(env: Env, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

export function isFeedProviderId(value: string): value is FeedProviderId {
  return (FEED_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Transport the Feed Engine must construct for a semantic provider id. */
export function feedTransportFor(providerId: string): FeedTransport | null {
  return isFeedProviderId(providerId) ? FEED_PROVIDER_PROFILES[providerId].transport : null;
}

/**
 * Resolves the feed provider from the environment.
 *
 * `NETWORK` is the canonical network switch; `TWAP_NETWORK` remains accepted
 * for pre-M7 deployments. A provider that needs a feed id or an endpoint and
 * has none is an error — the engine must refuse to boot rather than sample a
 * silently defaulted feed.
 */
export function resolveFeedProvider(env: Env): ResolvedFeedProvider {
  const issues: { key: string; message: string }[] = [];

  const rawProvider = read(env, "TWAP_FEED_PROVIDER") ?? "testnet";
  if (!isFeedProviderId(rawProvider)) {
    throw new FeedProviderError([
      {
        key: "TWAP_FEED_PROVIDER",
        message: `unknown provider "${rawProvider}" — expected one of ${FEED_PROVIDER_IDS.join(", ")}`,
      },
    ]);
  }
  const profile = FEED_PROVIDER_PROFILES[rawProvider];

  const feedId = read(env, "TWAP_FEED_ID") ?? "";
  if (profile.requiresFeedId && feedId === "") {
    issues.push({ key: "TWAP_FEED_ID", message: `required by provider "${profile.id}"` });
  }

  const network = read(env, "NETWORK") ?? read(env, "TWAP_NETWORK") ?? profile.defaultNetwork ?? "";
  if (network === "") {
    issues.push({ key: "NETWORK", message: `required by provider "${profile.id}"` });
  }
  if (
    profile.generation === "V1" &&
    profile.id === "testnet" &&
    network !== "testnet" &&
    network !== ""
  ) {
    issues.push({
      key: "NETWORK",
      message: `provider "testnet" cannot run on network "${network}" — use a V2 provider for mainnet`,
    });
  }
  if (profile.generation === "V2" && network === "testnet") {
    issues.push({
      key: "NETWORK",
      message: `provider "${profile.id}" is a mainnet (V2) provider and cannot run on testnet`,
    });
  }

  const endpointTemplate = read(env, "TWAP_FEED_ENDPOINT");
  if (profile.requiresEndpoint && endpointTemplate === undefined) {
    issues.push({ key: "TWAP_FEED_ENDPOINT", message: `required by provider "${profile.id}"` });
  }

  if (issues.length > 0) throw new FeedProviderError(issues);

  return {
    profile,
    providerId: profile.id,
    transport: profile.transport,
    generation: profile.generation,
    feedId,
    network,
    endpointTemplate,
    valuePath: read(env, "TWAP_FEED_VALUE_PATH") ?? profile.defaultValuePath,
    timestampPath: read(env, "TWAP_FEED_TIMESTAMP_PATH") ?? profile.defaultTimestampPath,
  };
}

export interface MigrationDiff {
  readonly key: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface MigrationReport {
  readonly from: { providerId: FeedProviderId; generation: FeedGeneration; network: string };
  readonly to: { providerId: FeedProviderId; generation: FeedGeneration; network: string };
  readonly changes: readonly MigrationDiff[];
  /** Always false: the abstraction guarantees an environment-only migration. */
  readonly codeChangeRequired: boolean;
  readonly restartRequired: boolean;
}

/**
 * Explains a V1 → V2 migration purely as environment changes. Used by the
 * qualification suite to prove that moving to mainnet touches configuration
 * only — no strategy, execution or dashboard code participates.
 */
export function describeFeedMigration(fromEnv: Env, toEnv: Env): MigrationReport {
  const from = resolveFeedProvider(fromEnv);
  const to = resolveFeedProvider(toEnv);

  const changes: MigrationDiff[] = [];
  for (const key of FEED_PROVIDER_ENV_KEYS) {
    const before = read(fromEnv, key) ?? null;
    const after = read(toEnv, key) ?? null;
    if (before !== after) changes.push({ key, from: before, to: after });
  }

  return {
    from: { providerId: from.providerId, generation: from.generation, network: from.network },
    to: { providerId: to.providerId, generation: to.generation, network: to.network },
    changes,
    codeChangeRequired: false,
    restartRequired: changes.length > 0,
  };
}
