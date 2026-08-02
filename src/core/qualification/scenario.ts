/**
 * ARC — M7.7 Testnet Qualification harness.
 *
 * Validation only. This module adds NO strategy logic and modifies no frozen
 * contract: it wires the already-frozen domains together — Market State →
 * Decision → Trade — drives them from a FixedClock and records everything the
 * qualification gates need to be judged.
 *
 * Determinism is the point: identical inputs must produce a byte-identical
 * event stream, which is what makes replay and recovery provable.
 */
import { InMemoryEventSink, type EventEnvelope } from "../contracts/event-envelope";
import { EventEnvelopeFactory } from "../contracts/event-envelope";
import {
  DEFAULT_PROFILE_SEED,
  offsetToMillis,
  parseExecutionProfileOrThrow,
  type ExecutionProfile,
} from "../decision/configuration";
import { ExecutionWindowManager } from "../decision/window-manager";
import { type ExecutionIntent } from "../decision/types";
import { loadMarketConfig, type MarketDomainConfig } from "../market/configuration";
import { parseMarketMetadata } from "../market/discovery";
import { MarketStateDomain } from "../market/domain";
import { type MarketDescriptor } from "../market/types";
import { parseTradeConfigOrThrow, type TradeDomainConfig } from "../trade/configuration";
import { TradeCoordinator, type TradeConditions } from "../trade/trade-coordinator";
import { type ExecutionReport } from "../trade/types";
import { RecordingVenueGateway, type BookSnapshot } from "../trade/venue-gateway";
import { FixedClock } from "../shared/time";

export interface QualificationBook {
  bestBid: number;
  bestAsk: number;
  bidSize: number;
  askSize: number;
}

export interface QualificationSpec {
  /** Wall clock at which the qualification run starts, ISO-8601 UTC. */
  startIso: string;
  /** Official resolution timestamp of the market instance. */
  resolvesAtIso: string;
  /** Price-to-beat carried by official market metadata. */
  ptb: number;
  /** Deterministic feed series, one observation per tick, cycled if shorter. */
  prices: readonly number[];
  /** Tick cadence of the qualification loop. */
  tickMillis?: number;
  profile?: ExecutionProfile;
  tradeConfig?: TradeDomainConfig;
  marketConfig?: MarketDomainConfig;
  book?: QualificationBook;
  /** Engage the operator kill switch for a denial qualification run. */
  killSwitch?: boolean;
}

export interface QualificationIntentRecord {
  windowInstanceId: string;
  executionIntentId: string;
  side: ExecutionIntent["side"];
  positionSize: number;
  marketStateVersion: number;
  submitted: "ACCEPTED" | "RISK_DENIED" | "EXPOSURE_UNAVAILABLE" | "DUPLICATE";
  riskDecision: "ALLOW" | "DENY" | null;
  deniedBy: string | null;
}

export interface QualificationRun {
  events: readonly EventEnvelope[];
  eventTypes: readonly string[];
  marketStateVersions: readonly number[];
  /** Window instance ids in activation order (largest offset first). */
  windowOrder: readonly string[];
  windowOffsets: readonly number[];
  intents: readonly QualificationIntentRecord[];
  settlements: readonly ExecutionReport[];
  /** Total notional committed by settled executions. */
  settledNotional: number;
  exposure: { live: number; reserved: number };
  /** Re-submitting a recorded intent after a restart must never place twice. */
  duplicateSuppressed: boolean;
  quotaExhausted: boolean;
  ticks: number;
}

export const QUALIFICATION_MARKET_ENV: Readonly<Record<string, string>> = Object.freeze({
  MARKET_DISCOVERY_BASE_URL: "https://gamma.testnet.arc",
  MARKET_SLUG_TEMPLATE: "btc-updown-5m-{slot}",
  MARKET_CLOSING_LEAD_MS: "30000",
  TWAP_FEED_ID: "btc-usd-testnet",
  TWAP_FEED_PROVIDER: "in-memory",
  TWAP_NETWORK: "testnet",
  TWAP_PRECISION: "2",
  TWAP_MAX_STALENESS: "10000",
  TWAP_WINDOW_SECONDS: "300",
  TWAP_MIN_OBSERVATIONS: "2",
  PTB_METADATA_FIELD: "ptb",
  PTB_MIN_VALUE: "1",
  PTB_MAX_VALUE: "10000000",
});

export function qualificationMarketConfig(): MarketDomainConfig {
  return loadMarketConfig(QUALIFICATION_MARKET_ENV);
}

export function qualificationProfile(overrides: Record<string, unknown> = {}): ExecutionProfile {
  return parseExecutionProfileOrThrow({
    executionProfileId: "qualification",
    executionMode: "MULTI_TRADE",
    maxTrades: 2,
    positionSize: 10,
    windowActiveMillis: 30_000,
    ...DEFAULT_PROFILE_SEED,
    ...overrides,
  });
}

export function qualificationTradeConfig(
  overrides: { risk?: Record<string, unknown>; execution?: Record<string, unknown> } = {},
): TradeDomainConfig {
  return parseTradeConfigOrThrow({
    risk: {
      maxExposure: 1_000,
      maxIntentExposure: 100,
      maxSpread: 0.2,
      minLiquidity: 1,
      ...overrides.risk,
    },
    execution: { minMeaningfulQuantity: 1, timeoutMillis: 10_000, ...overrides.execution },
  });
}

function qualificationDescriptor(
  config: MarketDomainConfig,
  clock: FixedClock,
  spec: QualificationSpec,
): MarketDescriptor {
  const resolvesAtMillis = Date.parse(spec.resolvesAtIso);
  return parseMarketMetadata({
    raw: {
      conditionId: "0xqualification",
      slug: "btc-updown-5m-1",
      outcomes: JSON.stringify(["Up", "Down"]),
      clobTokenIds: JSON.stringify(["tok-up", "tok-down"]),
      active: true,
      closed: false,
      startDate: new Date(resolvesAtMillis - 300_000).toISOString(),
      endDate: spec.resolvesAtIso,
      ptb: String(spec.ptb),
    },
    slug: "btc-updown-5m-1",
    resolvesAtMillis,
    config,
    clock,
  });
}

/**
 * Runs one full qualification lifecycle:
 * discovery → feed → TWAP → signal → market state → windows → decision →
 * intent → risk → exposure → order → fill → settlement → ledger.
 */
export async function runQualificationScenario(
  spec: QualificationSpec,
): Promise<QualificationRun> {
  const tickMillis = spec.tickMillis ?? 1_000;
  const marketConfig = spec.marketConfig ?? qualificationMarketConfig();
  const profile = spec.profile ?? qualificationProfile();
  const tradeConfig =
    spec.tradeConfig ??
    qualificationTradeConfig(spec.killSwitch ? { risk: { killSwitch: true } } : {});

  const clock = new FixedClock(spec.startIso);
  const sink = new InMemoryEventSink();
  const bookSpec = spec.book ?? { bestBid: 0.48, bestAsk: 0.52, bidSize: 500, askSize: 500 };
  const book: BookSnapshot = {
    outcomeKey: "tok-up",
    bestBid: bookSpec.bestBid,
    bestAsk: bookSpec.bestAsk,
    bidSize: bookSpec.bidSize,
    askSize: bookSpec.askSize,
    observedAtIso: spec.startIso,
  };
  const gateway = new RecordingVenueGateway({ book });

  const domain = new MarketStateDomain({
    config: marketConfig,
    clock,
    sink,
    configVersion: "qualification-1",
    activeExecutionProfileId: profile.executionProfileId,
  });

  const manager = new ExecutionWindowManager({ profile, clock, sink });

  const descriptor = qualificationDescriptor(marketConfig, clock, spec);
  const coordinator = new TradeCoordinator({
    config: tradeConfig,
    gateway,
    clock,
    eventFactory: new EventEnvelopeFactory(clock, "trade"),
    eventSink: sink,
    marketInstanceId: descriptor.marketInstanceId,
    onSettlement: (report) => {
      settlements.push(report);
    },
  });

  const settlements: ExecutionReport[] = [];
  const intents: QualificationIntentRecord[] = [];
  const marketStateVersions: number[] = [];

  await domain.adopt(descriptor);
  const context = await manager.prepare({
    marketInstanceId: descriptor.marketInstanceId,
    resolvesAtIso: spec.resolvesAtIso,
  });

  const conditions = (outcomeKey: string): TradeConditions => ({
    marketValid: true,
    marketTradable: true,
    feedFreshnessState: "FRESH",
    feedAgeMillis: 0,
    outcomePosition: 0,
    availableLiquidity: Math.min(bookSpec.bidSize, bookSpec.askSize),
    spread: Number((bookSpec.bestAsk - bookSpec.bestBid).toFixed(8)),
    maxPrice: bookSpec.bestAsk,
    outcomeKeys: { BUY_UP: outcomeKey, BUY_DOWN: "tok-down" },
  });

  const resolvesAt = Date.parse(spec.resolvesAtIso);
  let ticks = 0;
  let firstIntentId: string | null = null;

  while (clock.now() < resolvesAt) {
    // Phases are separated by one millisecond so the recorded stream is
    // strictly append-ordered across the three event sources.
    clock.advance(Math.max(tickMillis - 2, 1));
    const price = spec.prices[ticks % spec.prices.length]!;
    ticks += 1;

    const state = await domain.ingest({ value: price, observedAt: clock.now() });
    if (!state) continue;
    marketStateVersions.push(state.marketStateVersion);

    clock.advance(1);
    await manager.tick(clock.now());
    const outcomes = await manager.onMarketState(state);

    clock.advance(1);
    for (const outcome of outcomes) {
      if (!outcome.intent) continue;
      const intent = outcome.intent;
      firstIntentId ??= intent.executionIntentId;
      const submitted = await coordinator.submit(
        {
          executionIntentId: intent.executionIntentId,
          marketInstanceId: intent.marketInstanceId,
          correlationId: manager.correlationId,
          side: intent.side,
          positionSize: intent.positionSize,
          retryCount: intent.retryCount,
          riskProfileVersion: profile.riskProfileVersion,
        },
        conditions("tok-up"),
      );

      intents.push({
        windowInstanceId: outcome.windowInstanceId,
        executionIntentId: intent.executionIntentId,
        side: intent.side,
        positionSize: intent.positionSize,
        marketStateVersion: state.marketStateVersion,
        submitted: submitted.accepted ? "ACCEPTED" : submitted.reason,
        riskDecision: submitted.verdict?.decision ?? null,
        deniedBy: submitted.verdict?.deniedBy ?? null,
      });

      if (submitted.accepted) {
        const submission = gateway.submissions[gateway.submissions.length - 1];
        if (submission) {
          await coordinator.applyFill({
            executionIntentId: intent.executionIntentId,
            venueOrderId: `venue-${submission.orderId}`,
            venueFillId: `fill-${submission.orderId}`,
            quantity: submission.quantity,
            price: submission.limitPrice,
          });
        }
      }
    }

    await coordinator.tick();
  }

  await manager.tick(resolvesAt);

  // Recovery qualification: replaying a recorded intent after a restart must
  // never place a second order for the same execution intent.
  let duplicateSuppressed = false;
  if (firstIntentId) {
    const replayed = await coordinator.submit(
      {
        executionIntentId: firstIntentId,
        marketInstanceId: descriptor.marketInstanceId,
        correlationId: manager.correlationId,
        side: "BUY_UP",
        positionSize: profile.positionSize,
        retryCount: 0,
        riskProfileVersion: profile.riskProfileVersion,
      },
      conditions("tok-up"),
    );
    duplicateSuppressed = !replayed.accepted && replayed.reason === "DUPLICATE";
  }

  const ordered = [...profile.windows]
    .filter((window) => window.enabled)
    .sort((a, b) => offsetToMillis(b.offset, b.unit) - offsetToMillis(a.offset, a.unit));

  const exposure = coordinator.ledger.snapshot();

  return Object.freeze({
    events: sink.events,
    eventTypes: sink.events.map((event) => event.type),
    marketStateVersions,
    windowOrder: context.orderedWindows().map((window) => window.id),
    windowOffsets: ordered.map((window) => offsetToMillis(window.offset, window.unit)),
    intents,
    settlements,
    settledNotional: settlements.reduce((total, report) => total + report.cumulativeNotional, 0),
    exposure: { live: exposure.live, reserved: exposure.reserved },
    duplicateSuppressed,
    quotaExhausted: context.quota.exhausted,
    ticks,
  });
}

/** Canonical qualification scenario used by the tests, the docs and the console. */
export const QUALIFICATION_SPEC: QualificationSpec = Object.freeze({
  startIso: "2026-02-01T00:04:38.000Z",
  resolvesAtIso: "2026-02-01T00:05:00.000Z",
  ptb: 64_000,
  prices: Object.freeze([64_900, 65_000, 65_100, 65_050, 65_200]),
});
