/**
 * ARC — operator projections (M5 Operations Platform).
 *
 * Pure, read-only reductions of canonical events into the shapes the operator
 * UI renders. No strategy, no trading decision, no execution: this module only
 * describes what already happened. It is TWAP-native by construction — the
 * legacy Majority strategy (majority direction/confidence/threshold, crowd
 * sentiment, Binance direction, vote counts) does not exist in ARC.
 */
import { compareEnvelopes, type EventEnvelope } from "../contracts/event-envelope";
import { DECISION_EVENT_TYPES } from "../decision/events";
import { MARKET_EVENT_TYPES } from "../market/events";
import { TRADE_EVENT_TYPES } from "../trade/events";
import { classifyEventType } from "./event-catalog";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface OperationsMarketView {
  marketInstanceId: string;
  marketStateVersion: number | null;
  lifecycle: string | null;
  timestampIso: string | null;
  resolutionIso: string | null;
  question: string | null;
  venue: string | null;
  twap: number | null;
  effectiveTwap: number | null;
  ptb: number | null;
  ptbValid: boolean | null;
  feedFresh: boolean | null;
  feedAgeMillis: number | null;
  executionProfileId: string | null;
  executionProfileVersion: string | null;
}

export interface OperationsWindowView {
  windowInstanceId: string;
  windowDefinitionId: string | null;
  marketInstanceId: string | null;
  correlationId: string;
  sequence: number | null;
  priority: number | null;
  offset: number | null;
  unit: string | null;
  state: string;
  completionReason: string | null;
  twapBuffer: number | null;
  positionSize: number | null;
  retryCount: number | null;
  configurationSnapshotId: string | null;
  marketStateVersion: number | null;
  executionIntentId: string | null;
  tradeQuotaAtCreation: number | null;
  tradeQuotaAtCompletion: number | null;
  activatesAtIso: string | null;
  expiresAtIso: string | null;
  createdAtIso: string | null;
  completedAtIso: string | null;
  evaluationCount: number | null;
}

export interface OperationsSignalView {
  windowInstanceId: string | null;
  outcome: string;
  effectiveTwap: number | null;
  ptb: number | null;
  appliedBuffer: number | null;
  delta: number | null;
  marketStateVersion: number | null;
  rejectionReason: string | null;
  appliedSteps: string[];
  decidedAtIso: string;
}

export interface OperationsTimelineEntry {
  eventId: string;
  type: string;
  reasonCode: string;
  occurredAtIso: string;
  source: string;
  detail: string | null;
}

export interface OperationsExecutionView {
  executionIntentId: string;
  correlationId: string;
  windowInstanceId: string | null;
  side: string | null;
  positionSize: number | null;
  referenceEffectiveTwap: number | null;
  referencePtb: number | null;
  appliedBuffer: number | null;
  riskVerdict: "ALLOW" | "DENY" | null;
  riskReason: string | null;
  orderId: string | null;
  orderState: string | null;
  filledQuantity: number;
  averagePrice: number | null;
  retries: number;
  repricings: number;
  partiallyFilled: boolean;
  settled: boolean;
  failureReason: string | null;
  createdAtIso: string | null;
  timeline: OperationsTimelineEntry[];
}

export interface OperationsQuotaEntry {
  atIso: string;
  executionIntentId: string | null;
  initial: number | null;
  remaining: number | null;
  consumed: number | null;
}

export interface OperationsProjection {
  generatedFromEvents: number;
  firstEventIso: string | null;
  lastEventIso: string | null;
  markets: OperationsMarketView[];
  activeMarket: OperationsMarketView | null;
  windows: OperationsWindowView[];
  activeWindows: OperationsWindowView[];
  signals: OperationsSignalView[];
  executions: OperationsExecutionView[];
  openOrders: number;
  quota: { initial: number | null; remaining: number | null; consumed: number | null } | null;
  quotaHistory: OperationsQuotaEntry[];
  exposure: { reserved: number | null; live: number | null; limit: number | null } | null;
  counts: { total: number; business: number; operational: number };
  recentEvents: OperationsTimelineEntry[];
}

const TERMINAL_ORDER_STATES = new Set(["FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);
const ACTIVE_WINDOW_STATES = new Set([
  "CONFIGURED",
  "WAITING",
  "ACTIVE",
  "EVALUATING",
  "EXECUTING",
]);

function timelineEntry(event: EventEnvelope, detail: string | null): OperationsTimelineEntry {
  return {
    eventId: event.eventId,
    type: event.type,
    reasonCode: event.metadata.reasonCode,
    occurredAtIso: event.occurredAt,
    source: event.metadata.source,
    detail,
  };
}

/** Reduces an ordered event stream into every operator-facing projection. */
export function projectOperations(events: readonly EventEnvelope[]): OperationsProjection {
  const ordered = [...events].sort(compareEnvelopes);

  const markets = new Map<string, OperationsMarketView>();
  const windows = new Map<string, OperationsWindowView>();
  const executions = new Map<string, OperationsExecutionView>();
  const signals: OperationsSignalView[] = [];
  const quotaHistory: OperationsQuotaEntry[] = [];
  let quota: OperationsProjection["quota"] = null;
  let exposure: OperationsProjection["exposure"] = null;
  let business = 0;
  let operational = 0;

  const execFor = (event: EventEnvelope): OperationsExecutionView | null => {
    const id = event.metadata.executionIntentId;
    if (!id) return null;
    const existing = executions.get(id);
    if (existing) return existing;
    const created: OperationsExecutionView = {
      executionIntentId: id,
      correlationId: event.metadata.correlationId,
      windowInstanceId: event.metadata.windowInstanceId ?? null,
      side: null,
      positionSize: null,
      referenceEffectiveTwap: null,
      referencePtb: null,
      appliedBuffer: null,
      riskVerdict: null,
      riskReason: null,
      orderId: null,
      orderState: null,
      filledQuantity: 0,
      averagePrice: null,
      retries: 0,
      repricings: 0,
      partiallyFilled: false,
      settled: false,
      failureReason: null,
      createdAtIso: event.occurredAt,
      timeline: [],
    };
    executions.set(id, created);
    return created;
  };

  for (const event of ordered) {
    const classification = classifyEventType(event.type);
    if (classification === "BUSINESS") business += 1;
    else operational += 1;

    const payload = asRecord(event.payload);

    switch (event.type) {
      case MARKET_EVENT_TYPES.stateUpdated: {
        const descriptor = asRecord(payload["descriptor"]);
        const freshness = asRecord(payload["freshness"]);
        const twap = asRecord(payload["twap"]);
        const signal = asRecord(payload["signal"]);
        const ptb = asRecord(payload["ptb"]);
        const configuration = asRecord(payload["configuration"]);
        const id = str(payload["marketInstanceId"]) ?? event.metadata.marketInstanceId ?? "unknown";
        markets.set(id, {
          marketInstanceId: id,
          marketStateVersion: num(payload["marketStateVersion"]),
          lifecycle: str(payload["lifecycle"]),
          timestampIso: str(payload["timestampIso"]) ?? event.occurredAt,
          resolutionIso: str(descriptor["resolutionIso"]) ?? str(descriptor["resolutionTimeIso"]),
          question: str(descriptor["question"]) ?? str(descriptor["title"]),
          venue: str(descriptor["venue"]),
          twap: num(twap["value"]),
          effectiveTwap: num(signal["effectiveTwap"]) ?? num(signal["value"]),
          ptb: num(ptb["value"]),
          ptbValid: typeof ptb["valid"] === "boolean" ? (ptb["valid"] as boolean) : null,
          feedFresh:
            typeof freshness["fresh"] === "boolean" ? (freshness["fresh"] as boolean) : null,
          feedAgeMillis: num(freshness["ageMillis"]),
          executionProfileId: str(configuration["executionProfileId"]),
          executionProfileVersion: str(configuration["executionProfileVersion"]),
        });
        break;
      }

      case DECISION_EVENT_TYPES.windowOpened:
      case DECISION_EVENT_TYPES.windowActivated:
      case DECISION_EVENT_TYPES.windowCompleted: {
        const snapshot =
          event.type === DECISION_EVENT_TYPES.windowCompleted
            ? asRecord(payload["window"])
            : payload;
        const id = str(snapshot["windowInstanceId"]) ?? event.metadata.windowInstanceId;
        if (!id) break;
        const configuration = asRecord(snapshot["configuration"]);
        windows.set(id, {
          windowInstanceId: id,
          windowDefinitionId: str(snapshot["windowDefinitionId"]),
          marketInstanceId: str(snapshot["marketInstanceId"]),
          correlationId: event.metadata.correlationId,
          sequence: num(snapshot["sequence"]),
          priority: num(snapshot["priority"]),
          offset: num(snapshot["offset"]),
          unit: str(snapshot["unit"]),
          state: str(snapshot["state"]) ?? "CONFIGURED",
          completionReason:
            str(payload["completionReason"]) ?? str(snapshot["completionReason"]) ?? null,
          twapBuffer: num(configuration["twapBuffer"]),
          positionSize: num(configuration["positionSize"]),
          retryCount: num(configuration["retryCount"]),
          configurationSnapshotId: str(configuration["configurationSnapshotId"]),
          marketStateVersion: num(snapshot["marketStateVersion"]),
          executionIntentId: str(snapshot["executionIntentId"]),
          tradeQuotaAtCreation: num(snapshot["tradeQuotaAtCreation"]),
          tradeQuotaAtCompletion: num(snapshot["tradeQuotaAtCompletion"]),
          activatesAtIso: str(snapshot["activatesAtIso"]),
          expiresAtIso: str(snapshot["expiresAtIso"]),
          createdAtIso: str(snapshot["createdAtIso"]),
          completedAtIso: str(snapshot["completedAtIso"]),
          evaluationCount: num(snapshot["evaluationCount"]),
        });
        break;
      }

      case DECISION_EVENT_TYPES.windowEvaluated: {
        const steps = Array.isArray(payload["appliedSteps"])
          ? (payload["appliedSteps"] as unknown[]).filter(
              (step): step is string => typeof step === "string",
            )
          : [];
        signals.push({
          windowInstanceId:
            str(payload["windowInstanceId"]) ?? event.metadata.windowInstanceId ?? null,
          outcome: str(payload["outcome"]) ?? "NO_SIGNAL",
          effectiveTwap: num(payload["effectiveTwap"]),
          ptb: num(payload["ptb"]),
          appliedBuffer: num(payload["appliedBuffer"]),
          delta: num(payload["delta"]),
          marketStateVersion: num(payload["marketStateVersion"]),
          rejectionReason: str(payload["rejectionReason"]),
          appliedSteps: steps,
          decidedAtIso: event.occurredAt,
        });
        break;
      }

      case DECISION_EVENT_TYPES.executionIntentCreated: {
        const execution = execFor(event);
        if (!execution) break;
        execution.side = str(payload["side"]);
        execution.positionSize = num(payload["positionSize"]);
        execution.referenceEffectiveTwap = num(payload["referenceEffectiveTwap"]);
        execution.referencePtb = num(payload["referencePtb"]);
        execution.appliedBuffer = num(payload["appliedBuffer"]);
        execution.windowInstanceId = str(payload["windowInstanceId"]) ?? execution.windowInstanceId;
        execution.createdAtIso = str(payload["createdAtIso"]) ?? execution.createdAtIso;
        execution.timeline.push(
          timelineEntry(event, `intent ${str(payload["side"]) ?? ""}`.trim()),
        );
        break;
      }

      case DECISION_EVENT_TYPES.tradeQuotaConsumed: {
        const snapshot = asRecord(payload["quota"]);
        quota = {
          initial: num(snapshot["initial"]),
          remaining: num(snapshot["remaining"]),
          consumed: num(snapshot["consumed"]),
        };
        quotaHistory.push({
          atIso: event.occurredAt,
          executionIntentId:
            str(payload["executionIntentId"]) ?? event.metadata.executionIntentId ?? null,
          initial: quota.initial,
          remaining: quota.remaining,
          consumed: quota.consumed,
        });
        break;
      }

      case TRADE_EVENT_TYPES.riskApproved:
      case TRADE_EVENT_TYPES.riskDenied: {
        const execution = execFor(event);
        if (!execution) break;
        const denied = event.type === TRADE_EVENT_TYPES.riskDenied;
        execution.riskVerdict = denied ? "DENY" : "ALLOW";
        execution.riskReason = denied ? event.metadata.reasonCode : null;
        execution.timeline.push(timelineEntry(event, denied ? "risk denied" : "risk approved"));
        break;
      }

      case TRADE_EVENT_TYPES.exposureReserved:
      case TRADE_EVENT_TYPES.exposureReleased: {
        const snapshot = asRecord(payload["exposure"]);
        exposure = {
          reserved: num(snapshot["reserved"]),
          live: num(snapshot["live"]),
          limit: num(snapshot["limit"]) ?? num(snapshot["maxExposure"]),
        };
        const execution = execFor(event);
        execution?.timeline.push(timelineEntry(event, "exposure"));
        break;
      }

      case TRADE_EVENT_TYPES.orderSubmitted:
      case TRADE_EVENT_TYPES.orderUpdated:
      case TRADE_EVENT_TYPES.orderFilled:
      case TRADE_EVENT_TYPES.orderCancelled: {
        const execution = execFor(event);
        if (!execution) break;
        const order = asRecord(payload["order"]);
        const source = Object.keys(order).length > 0 ? order : payload;
        execution.orderId = str(source["orderId"]) ?? execution.orderId;
        execution.orderState = str(source["state"]) ?? execution.orderState;
        const filled =
          num(payload["cumulativeFilledQuantity"]) ?? num(source["filledQuantity"]) ?? null;
        if (filled !== null) execution.filledQuantity = filled;
        execution.averagePrice = num(source["averagePrice"]) ?? execution.averagePrice;
        if (event.type === TRADE_EVENT_TYPES.orderUpdated) execution.repricings += 1;
        if (execution.orderState === "PARTIALLY_FILLED") execution.partiallyFilled = true;
        execution.timeline.push(timelineEntry(event, execution.orderState));
        break;
      }

      case TRADE_EVENT_TYPES.executionCompleted:
      case TRADE_EVENT_TYPES.executionFailed: {
        const execution = execFor(event);
        if (!execution) break;
        const report = asRecord(payload["report"]);
        execution.settled = event.type === TRADE_EVENT_TYPES.executionCompleted;
        execution.retries =
          num(report["attempts"]) ?? num(payload["attempts"]) ?? execution.retries;
        execution.failureReason = str(payload["failureReason"]);
        execution.averagePrice = num(report["averagePrice"]) ?? execution.averagePrice;
        execution.timeline.push(
          timelineEntry(event, execution.settled ? "execution completed" : "execution failed"),
        );
        break;
      }

      default:
        break;
    }
  }

  const windowList = [...windows.values()];
  const marketList = [...markets.values()];
  const executionList = [...executions.values()].reverse();

  return {
    generatedFromEvents: ordered.length,
    firstEventIso: ordered[0]?.occurredAt ?? null,
    lastEventIso: ordered[ordered.length - 1]?.occurredAt ?? null,
    markets: marketList,
    activeMarket:
      marketList.find((market) => market.lifecycle === "ACTIVE") ??
      marketList[marketList.length - 1] ??
      null,
    windows: windowList,
    activeWindows: windowList.filter((window) => ACTIVE_WINDOW_STATES.has(window.state)),
    signals: signals.reverse(),
    executions: executionList,
    openOrders: executionList.filter(
      (execution) =>
        execution.orderState !== null && !TERMINAL_ORDER_STATES.has(execution.orderState),
    ).length,
    quota,
    quotaHistory: quotaHistory.reverse(),
    exposure,
    counts: { total: ordered.length, business, operational },
    recentEvents: ordered
      .slice(-40)
      .reverse()
      .map((event) => timelineEntry(event, null)),
  };
}
