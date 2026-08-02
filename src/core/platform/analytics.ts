/**
 * ARC — analytics foundation (M4 Platform Services).
 *
 * Everything is computed FROM canonical events. No UI, no strategy, no
 * feedback into trading: analytics observes what already happened and is never
 * consulted by any engine.
 */
import { compareEnvelopes, type EventEnvelope } from "../contracts/event-envelope";
import { versionOf } from "../contracts/versions";
import { DECISION_EVENT_TYPES } from "../decision/events";
import { TRADE_EVENT_TYPES } from "../trade/events";
import { EVENT_CATALOG } from "./event-catalog";
import { reconstructLedger, type LedgerOptions } from "./ledger";

export interface AnalyticsMetrics {
  /** Completed executions that fully filled, over all terminal executions. */
  fillRate: number | null;
  partialFillRate: number | null;
  retryRate: number | null;
  averageFillLatencyMillis: number | null;
  /** Executed average price minus the intent's reference effective TWAP. */
  averageSlippage: number | null;
  /** Signalled decisions that reached a fill, over all signalled decisions. */
  bufferEfficiency: number | null;
  tradeQuotaUtilization: number | null;
  windowUtilization: number | null;
  peakReservedExposure: number;
  peakLiveExposure: number;
  realizedPnl: number;
  totalNotional: number;
  totalFees: number;
}

export interface WindowStatistics {
  windowInstanceId: string;
  evaluations: number;
  signals: number;
  intents: number;
  fills: number;
  completionReason: string | null;
}

export interface ProfileStatistics {
  executionProfileVersion: string;
  intents: number;
  fills: number;
  averageSlippage: number | null;
}

export interface AnalyticsSummary {
  analyticsVersion: string;
  periodStartIso: string | null;
  periodEndIso: string | null;
  eventCount: number;
  metrics: AnalyticsMetrics;
  perWindow: WindowStatistics[];
  perProfile: ProfileStatistics[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round(numerator / denominator);
}

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : round(values.reduce((a, b) => a + b, 0) / values.length);
}

interface IntentFacts {
  createdAtMillis: number;
  referenceEffectiveTwap: number;
  executionProfileVersion: string;
  windowInstanceId: string;
}

export function computeAnalytics(
  events: readonly EventEnvelope[],
  options: LedgerOptions = {},
): AnalyticsSummary {
  const ordered = [...events].sort(compareEnvelopes);

  const intents = new Map<string, IntentFacts>();
  const firstFillMillis = new Map<string, number>();
  const windowStats = new Map<string, WindowStatistics>();
  const profileStats = new Map<string, { intents: number; fills: number; slippage: number[] }>();

  let terminalExecutions = 0;
  let filledExecutions = 0;
  let partialExecutions = 0;
  let retriedExecutions = 0;
  let signalledDecisions = 0;
  let quotaInitial: number | null = null;
  let quotaConsumed = 0;
  let windowsOpened = 0;
  let peakReserved = 0;
  let peakLive = 0;
  const slippages: number[] = [];
  const latencies: number[] = [];

  const windowOf = (id: string): WindowStatistics => {
    const existing = windowStats.get(id);
    if (existing) return existing;
    const created: WindowStatistics = {
      windowInstanceId: id,
      evaluations: 0,
      signals: 0,
      intents: 0,
      fills: 0,
      completionReason: null,
    };
    windowStats.set(id, created);
    return created;
  };

  for (const event of ordered) {
    switch (event.type) {
      case DECISION_EVENT_TYPES.windowOpened: {
        windowsOpened += 1;
        const id =
          event.metadata.windowInstanceId ??
          (event.payload as { windowInstanceId?: string }).windowInstanceId;
        if (id) windowOf(id);
        break;
      }
      case DECISION_EVENT_TYPES.windowEvaluated: {
        const decision = event.payload as { outcome: string; windowInstanceId: string };
        const stats = windowOf(decision.windowInstanceId);
        stats.evaluations += 1;
        if (decision.outcome !== "NO_SIGNAL") {
          stats.signals += 1;
          signalledDecisions += 1;
        }
        break;
      }
      case DECISION_EVENT_TYPES.windowCompleted: {
        const payload = event.payload as {
          window?: { windowInstanceId?: string };
          completionReason?: string;
        };
        const id = payload.window?.windowInstanceId ?? event.metadata.windowInstanceId;
        if (id) windowOf(id).completionReason = payload.completionReason ?? null;
        break;
      }
      case DECISION_EVENT_TYPES.executionIntentCreated: {
        const intent = event.payload as {
          executionIntentId: string;
          windowInstanceId: string;
          createdAtIso: string;
          referenceEffectiveTwap: number;
          executionProfileVersion: string;
        };
        intents.set(intent.executionIntentId, {
          createdAtMillis: Date.parse(intent.createdAtIso),
          referenceEffectiveTwap: intent.referenceEffectiveTwap,
          executionProfileVersion: intent.executionProfileVersion,
          windowInstanceId: intent.windowInstanceId,
        });
        windowOf(intent.windowInstanceId).intents += 1;
        const profile = profileStats.get(intent.executionProfileVersion) ?? {
          intents: 0,
          fills: 0,
          slippage: [],
        };
        profile.intents += 1;
        profileStats.set(intent.executionProfileVersion, profile);
        break;
      }
      case DECISION_EVENT_TYPES.tradeQuotaConsumed: {
        const payload = event.payload as { quota: { initial: number; consumed: number } };
        if (quotaInitial === null) quotaInitial = payload.quota.initial;
        quotaConsumed = payload.quota.consumed;
        break;
      }
      case TRADE_EVENT_TYPES.exposureReserved:
      case TRADE_EVENT_TYPES.exposureReleased: {
        const payload = event.payload as { exposure?: { reserved: number; live: number } };
        if (payload.exposure) {
          peakReserved = Math.max(peakReserved, payload.exposure.reserved);
          peakLive = Math.max(peakLive, payload.exposure.live);
        }
        break;
      }
      case EVENT_CATALOG.OrderFilled.type: {
        const payload = event.payload as {
          order: { executionIntentId: string };
          fill: { filledAtIso: string };
        };
        const intentId = payload.order.executionIntentId;
        if (!firstFillMillis.has(intentId)) {
          firstFillMillis.set(intentId, Date.parse(payload.fill.filledAtIso));
        }
        break;
      }
      case TRADE_EVENT_TYPES.executionCompleted: {
        terminalExecutions += 1;
        const report = event.payload as {
          executionIntentId: string;
          filled: boolean;
          partiallyFilled: boolean;
          averagePrice: number;
          orders: unknown[];
        };
        if (report.filled) filledExecutions += 1;
        if (report.partiallyFilled) partialExecutions += 1;
        if (report.orders.length > 1) retriedExecutions += 1;

        const facts = intents.get(report.executionIntentId);
        if (facts) {
          windowOf(facts.windowInstanceId).fills += 1;
          const profile = profileStats.get(facts.executionProfileVersion);
          if (profile) {
            profile.fills += 1;
            if (report.averagePrice > 0) {
              profile.slippage.push(report.averagePrice - facts.referenceEffectiveTwap);
            }
          }
          if (report.averagePrice > 0) {
            slippages.push(report.averagePrice - facts.referenceEffectiveTwap);
          }
          const filledAt = firstFillMillis.get(report.executionIntentId);
          if (typeof filledAt === "number" && Number.isFinite(facts.createdAtMillis)) {
            latencies.push(Math.max(0, filledAt - facts.createdAtMillis));
          }
        }
        break;
      }
      case TRADE_EVENT_TYPES.executionFailed: {
        terminalExecutions += 1;
        const payload = event.payload as { report?: { orders?: unknown[] } };
        if ((payload.report?.orders?.length ?? 0) > 1) retriedExecutions += 1;
        break;
      }
      default:
        break;
    }
  }

  const ledger = reconstructLedger(ordered, options);
  const first = ordered[0] ?? null;
  const last = ordered[ordered.length - 1] ?? null;

  return {
    analyticsVersion: versionOf("analytics"),
    periodStartIso: first?.occurredAt ?? null,
    periodEndIso: last?.occurredAt ?? null,
    eventCount: ordered.length,
    metrics: {
      fillRate: ratio(filledExecutions, terminalExecutions),
      partialFillRate: ratio(partialExecutions, terminalExecutions),
      retryRate: ratio(retriedExecutions, terminalExecutions),
      averageFillLatencyMillis: mean(latencies),
      averageSlippage: mean(slippages),
      bufferEfficiency: ratio(filledExecutions, signalledDecisions),
      tradeQuotaUtilization: quotaInitial ? ratio(quotaConsumed, quotaInitial) : null,
      windowUtilization: ratio(
        [...windowStats.values()].filter((stats) => stats.intents > 0).length,
        windowsOpened,
      ),
      peakReservedExposure: round(peakReserved),
      peakLiveExposure: round(peakLive),
      realizedPnl: ledger.summary.realizedPnl,
      totalNotional: ledger.summary.totalNotional,
      totalFees: ledger.summary.totalFees,
    },
    perWindow: [...windowStats.values()].sort((a, b) =>
      a.windowInstanceId.localeCompare(b.windowInstanceId),
    ),
    perProfile: [...profileStats.entries()]
      .map(([executionProfileVersion, stats]) => ({
        executionProfileVersion,
        intents: stats.intents,
        fills: stats.fills,
        averageSlippage: mean(stats.slippage),
      }))
      .sort((a, b) => a.executionProfileVersion.localeCompare(b.executionProfileVersion)),
  };
}

export interface AnalyticsRepository {
  save(summary: AnalyticsSummary, scope: string, scopeKey: string): Promise<void>;
  latest(scope?: string): Promise<AnalyticsSummary | null>;
}

export class InMemoryAnalyticsRepository implements AnalyticsRepository {
  private readonly saved: { scope: string; scopeKey: string; summary: AnalyticsSummary }[] = [];

  async save(summary: AnalyticsSummary, scope: string, scopeKey: string): Promise<void> {
    this.saved.push({ scope, scopeKey, summary });
  }

  async latest(scope?: string): Promise<AnalyticsSummary | null> {
    const matches = scope ? this.saved.filter((row) => row.scope === scope) : this.saved;
    return matches[matches.length - 1]?.summary ?? null;
  }
}
