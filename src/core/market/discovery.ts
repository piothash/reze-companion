/**
 * ARC — Market Discovery (M1).
 *
 * Discovers active venue markets and reads official metadata: outcome tokens,
 * resolution timestamp, identifiers, PTB source metadata and validity. Every
 * endpoint is configuration-driven; the HTTP client is injected so discovery is
 * deterministic and testable offline.
 */
import { Ids } from "../shared/ids";
import { toIsoUtc, type Clock } from "../shared/time";
import { type MarketDomainConfig } from "./configuration";
import {
  marketDescriptorSchema,
  type MarketDescriptor,
  type OutcomeToken,
  type PtbSourceMetadata,
} from "./types";

export type HttpFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface RawVenueMarket {
  conditionId?: string;
  slug?: string;
  question?: string;
  outcomes?: string | string[];
  clobTokenIds?: string | string[];
  active?: boolean | null;
  closed?: boolean | null;
  endDate?: string;
  startDate?: string;
  [key: string]: unknown;
}

export class MarketDiscoveryError extends Error {
  constructor(
    message: string,
    readonly slug: string,
  ) {
    super(message);
    this.name = "MarketDiscoveryError";
  }
}

/** Window-open epoch seconds for the slot whose resolution boundary is given. */
export function slotOpenEpochSeconds(resolvesAtMillis: number, slotDurationMillis: number): number {
  return Math.round((resolvesAtMillis - slotDurationMillis) / 1000);
}

/** Renders the configured slug template for a slot. */
export function renderSlug(template: string, slotEpochSeconds: number, network: string): string {
  return template.replaceAll("{slot}", String(slotEpochSeconds)).replaceAll("{network}", network);
}

function parseList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readNumeric(source: Record<string, unknown>, field: string): number | undefined {
  const raw = source[field];
  if (raw === undefined || raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ParseDiscoveryInput {
  raw: RawVenueMarket;
  slug: string;
  resolvesAtMillis: number;
  config: MarketDomainConfig;
  clock: Clock;
}

/**
 * Maps official venue metadata onto the canonical descriptor. Outcome tokens
 * are mapped BY LABEL, never positionally. Metadata that fails validation
 * yields an INVALID descriptor with reasons rather than a throw, so lifecycle
 * can record the invalid market.
 */
export function parseMarketMetadata(input: ParseDiscoveryInput): MarketDescriptor {
  const { raw, slug, resolvesAtMillis, config, clock } = input;
  const invalidReasons: string[] = [];

  const labels = parseList(raw.outcomes);
  const tokenIds = parseList(raw.clobTokenIds);
  const outcomes: OutcomeToken[] = [];

  for (const expected of config.discovery.expectedOutcomes) {
    const index = labels.findIndex((label) => label.toLowerCase() === expected.toLowerCase());
    if (index < 0 || tokenIds[index] === undefined) {
      invalidReasons.push(`missing outcome token for "${expected}"`);
      continue;
    }
    outcomes.push({ label: labels[index], key: labels[index].toLowerCase(), tokenId: tokenIds[index] });
  }

  const venueMarketId = typeof raw.conditionId === "string" ? raw.conditionId : "";
  if (!venueMarketId) invalidReasons.push("missing venue market identifier");

  const resolvesAtIso =
    typeof raw.endDate === "string" && !Number.isNaN(Date.parse(raw.endDate))
      ? toIsoUtc(Date.parse(raw.endDate))
      : toIsoUtc(resolvesAtMillis);
  const opensAtIso = toIsoUtc(
    typeof raw.startDate === "string" && !Number.isNaN(Date.parse(raw.startDate))
      ? Date.parse(raw.startDate)
      : Date.parse(resolvesAtIso) - config.discovery.slotDurationMillis,
  );

  const ptbRaw = readNumeric(raw as Record<string, unknown>, config.ptb.metadataField);
  const ptbSource: PtbSourceMetadata | undefined =
    ptbRaw === undefined
      ? undefined
      : {
          source: config.ptb.source,
          field: config.ptb.metadataField,
          raw: String(raw[config.ptb.metadataField]),
        };

  const descriptor: MarketDescriptor = {
    marketInstanceId: Ids.marketInstance(
      config.feed.network,
      venueMarketId || slug,
      String(Date.parse(resolvesAtIso)),
    ),
    venueMarketId: venueMarketId || slug,
    slug: typeof raw.slug === "string" && raw.slug.length > 0 ? raw.slug : slug,
    question: typeof raw.question === "string" ? raw.question : "",
    network: config.feed.network,
    outcomes,
    opensAtIso,
    resolvesAtIso,
    venueActive: raw.active === true,
    venueClosed: raw.closed === true,
    ...(ptbSource ? { ptbSource } : {}),
    ...(ptbRaw !== undefined ? { ptbValue: ptbRaw } : {}),
    valid: invalidReasons.length === 0,
    invalidReasons,
    discoveredAtIso: clock.isoNow(),
  };

  return marketDescriptorSchema.parse(descriptor);
}

export interface MarketDiscoveryOptions {
  config: MarketDomainConfig;
  clock: Clock;
  httpFetch: HttpFetch;
}

/**
 * Configuration-driven discovery service. Caches by resolution boundary and
 * never throws into the caller's loop for transport errors — it surfaces null.
 */
export class MarketDiscoveryService {
  private readonly cache = new Map<number, MarketDescriptor>();
  private readonly inflight = new Map<number, Promise<MarketDescriptor | null>>();

  constructor(private readonly options: MarketDiscoveryOptions) {}

  peek(resolvesAtMillis: number): MarketDescriptor | null {
    return this.cache.get(resolvesAtMillis) ?? null;
  }

  slugFor(resolvesAtMillis: number): string {
    const { discovery, feed } = this.options.config;
    return renderSlug(
      discovery.slugTemplate,
      slotOpenEpochSeconds(resolvesAtMillis, discovery.slotDurationMillis),
      feed.network,
    );
  }

  endpointFor(slug: string): string {
    const { discovery } = this.options.config;
    const base = discovery.baseUrl.replace(/\/+$/, "");
    const path = discovery.marketsPath.startsWith("/")
      ? discovery.marketsPath
      : `/${discovery.marketsPath}`;
    return `${base}${path}?${discovery.slugParam}=${encodeURIComponent(slug)}`;
  }

  /** Discovers (or returns cached) metadata for the market resolving at a boundary. */
  async discover(resolvesAtMillis: number, force = false): Promise<MarketDescriptor | null> {
    if (!force) {
      const cached = this.cache.get(resolvesAtMillis);
      if (cached) return cached;
      const pending = this.inflight.get(resolvesAtMillis);
      if (pending) return pending;
    }

    const task = this.fetchDescriptor(resolvesAtMillis).finally(() => {
      this.inflight.delete(resolvesAtMillis);
    });
    this.inflight.set(resolvesAtMillis, task);
    return task;
  }

  private async fetchDescriptor(resolvesAtMillis: number): Promise<MarketDescriptor | null> {
    const slug = this.slugFor(resolvesAtMillis);
    try {
      const response = await this.options.httpFetch(this.endpointFor(slug), {
        signal: AbortSignal.timeout(this.options.config.discovery.requestTimeoutMillis),
      });
      if (!response.ok) {
        throw new MarketDiscoveryError(`venue metadata query failed: ${response.status}`, slug);
      }
      const body: unknown = await response.json();
      const raw = Array.isArray(body) ? (body[0] as RawVenueMarket | undefined) : (body as RawVenueMarket);
      if (!raw) return null;

      const descriptor = parseMarketMetadata({
        raw,
        slug,
        resolvesAtMillis,
        config: this.options.config,
        clock: this.options.clock,
      });
      this.cache.set(resolvesAtMillis, descriptor);
      this.prune();
      return descriptor;
    } catch (error) {
      if (error instanceof MarketDiscoveryError) throw error;
      throw new MarketDiscoveryError(
        error instanceof Error ? error.message : "market discovery failed",
        slug,
      );
    }
  }

  private prune(limit = 16): void {
    if (this.cache.size <= limit) return;
    const keys = [...this.cache.keys()].sort((a, b) => a - b);
    for (const key of keys.slice(0, keys.length - limit)) this.cache.delete(key);
  }
}
