/**
 * ARC — deterministic replay engine (M4 Platform Services).
 *
 * Replay is a read-only reconstruction: it consumes an append-only event
 * stream and rebuilds the observable projections (market state, window
 * lifecycle, execution context, intents, risk outcomes, orders, settlement and
 * trade quota) while validating the invariants the platform promises. It never
 * places an order and never re-runs strategy.
 */
import { compareEnvelopes, type EventEnvelope } from "../contracts/event-envelope";
import { versionOf } from "../contracts/versions";
import { digest128 } from "../shared/ids";
import { EVENT_CATALOG } from "./event-catalog";
import { DECISION_EVENT_TYPES } from "../decision/events";
import { TRADE_EVENT_TYPES } from "../trade/events";
import { ORDER_TERMINAL_STATES, type OrderState } from "../trade/types";

export const REPLAY_VALIDATIONS = [
  "EVENT_ORDERING",
  "MARKET_STATE_VERSION",
  "FSM_TRANSITIONS",
  "CORRELATION_IDS",
  "QUOTA_PROGRESSION",
  "EXECUTION_IDS",
] as const;
export type ReplayValidation = (typeof REPLAY_VALIDATIONS)[number];

export interface ReplayMismatch {
  validation: ReplayValidation;
  reasonCode:
    | "RPL_ORDERING_VIOLATION"
    | "RPL_VERSION_REGRESSION"
    | "RPL_TRANSITION_INVALID"
    | "RPL_CORRELATION_MISSING"
    | "RPL_QUOTA_REGRESSION"
    | "RPL_UNKNOWN_EXECUTION";
  eventId: string;
  detail: string;
}

export interface ReplayOrderProjection {
  orderId: string;
  executionIntentId: string;
  state: OrderState;
  filledQuantity: number;
  transitions: string[];
}

export interface ReplayWindowProjection {
  windowInstanceId: string;
  state: "OPENED" | "ACTIVATED" | "EVALUATED" | "COMPLETED";
  evaluations: number;
  executionIntentId: string | null;
  completionReason: string | null;
}

export interface ReplayProjection {
  marketStateVersions: number[];
  latestMarketStateVersion: number | null;
  executionContextIds: string[];
  windows: ReplayWindowProjection[];
  executionIntentIds: string[];
  riskApproved: number;
  riskDenied: number;
  orders: ReplayOrderProjection[];
  settlements: number;
  quota: { initial: number | null; remaining: number | null; consumed: number };
  correlationIds: string[];
}

export interface ReplayResult {
  runId: string;
  replayFormatVersion: string;
  eventCount: number;
  fromIso: string | null;
  toIso: string | null;
  deterministic: boolean;
  validations: Record<ReplayValidation, boolean>;
  mismatches: ReplayMismatch[];
  projection: ReplayProjection;
  /** Stable digest of the projection; two identical runs must match. */
  digest: string;
}

const ORDER_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  CREATED: ["SUBMITTED", "REJECTED", "CANCELLED"],
  SUBMITTED: ["WORKING", "PARTIALLY_FILLED", "FILLED", "REJECTED", "CANCELLED", "EXPIRED"],
  WORKING: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED", "REJECTED"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED"],
  FILLED: [],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
};

const WINDOW_ORDER = ["OPENED", "ACTIVATED", "EVALUATED", "COMPLETED"] as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function replayDigest(projection: ReplayProjection): string {
  return digest128(stableStringify(projection));
}

export interface ReplayOptions {
  runId?: string;
  /** Replay only events carrying this correlation id. */
  correlationId?: string;
}

/**
 * Deterministic replay. Pure: no clock reads, no randomness, no IO — the same
 * events always produce the same projection and the same digest.
 */
export function replayEvents(
  events: readonly EventEnvelope[],
  options: ReplayOptions = {},
): ReplayResult {
  const scoped = options.correlationId
    ? events.filter((event) => event.metadata.correlationId === options.correlationId)
    : events;
  const ordered = [...scoped].sort(compareEnvelopes);

  const mismatches: ReplayMismatch[] = [];
  const validations: Record<ReplayValidation, boolean> = {
    EVENT_ORDERING: true,
    MARKET_STATE_VERSION: true,
    FSM_TRANSITIONS: true,
    CORRELATION_IDS: true,
    QUOTA_PROGRESSION: true,
    EXECUTION_IDS: true,
  };

  const fail = (mismatch: ReplayMismatch) => {
    validations[mismatch.validation] = false;
    mismatches.push(mismatch);
  };

  const marketStateVersions: number[] = [];
  const executionContextIds = new Set<string>();
  const correlationIds = new Set<string>();
  const windows = new Map<string, ReplayWindowProjection>();
  const orders = new Map<string, ReplayOrderProjection>();
  const executionIntentIds = new Set<string>();
  let riskApproved = 0;
  let riskDenied = 0;
  let settlements = 0;
  let quotaInitial: number | null = null;
  let quotaRemaining: number | null = null;
  let quotaConsumed = 0;

  let previous: EventEnvelope | null = null;
  let latestMarketStateVersion: number | null = null;

  for (const event of ordered) {
    // Ordering — the source stream must already be totally ordered.
    const original = scoped.indexOf(event);
    if (previous && compareEnvelopes(previous, event) > 0) {
      fail({
        validation: "EVENT_ORDERING",
        reasonCode: "RPL_ORDERING_VIOLATION",
        eventId: event.eventId,
        detail: `event ${event.type} precedes ${previous.type}`,
      });
    }
    if (original >= 0 && previous && scoped.indexOf(previous) > original) {
      fail({
        validation: "EVENT_ORDERING",
        reasonCode: "RPL_ORDERING_VIOLATION",
        eventId: event.eventId,
        detail: "source stream was not append-ordered",
      });
    }
    previous = event;

    // Correlation ids.
    if (!event.metadata.correlationId) {
      fail({
        validation: "CORRELATION_IDS",
        reasonCode: "RPL_CORRELATION_MISSING",
        eventId: event.eventId,
        detail: `${event.type} carries no correlation id`,
      });
    } else {
      correlationIds.add(event.metadata.correlationId);
    }

    switch (event.type) {
      case EVENT_CATALOG.AuthoritativeMarketStateUpdated.type: {
        const state = event.payload as { marketStateVersion: number };
        if (
          latestMarketStateVersion !== null &&
          state.marketStateVersion <= latestMarketStateVersion
        ) {
          fail({
            validation: "MARKET_STATE_VERSION",
            reasonCode: "RPL_VERSION_REGRESSION",
            eventId: event.eventId,
            detail: `version ${state.marketStateVersion} does not exceed ${latestMarketStateVersion}`,
          });
        }
        latestMarketStateVersion = state.marketStateVersion;
        marketStateVersions.push(state.marketStateVersion);
        break;
      }
      case DECISION_EVENT_TYPES.windowOpened:
      case DECISION_EVENT_TYPES.windowActivated:
      case DECISION_EVENT_TYPES.windowCompleted:
      case DECISION_EVENT_TYPES.windowEvaluated: {
        const windowInstanceId =
          event.metadata.windowInstanceId ??
          (event.payload as { windowInstanceId?: string; window?: { windowInstanceId?: string } })
            .windowInstanceId ??
          (event.payload as { window?: { windowInstanceId?: string } }).window?.windowInstanceId;
        if (!windowInstanceId) break;
        const projected = windows.get(windowInstanceId) ?? {
          windowInstanceId,
          state: "OPENED" as const,
          evaluations: 0,
          executionIntentId: null,
          completionReason: null,
        };
        const nextState =
          event.type === DECISION_EVENT_TYPES.windowOpened
            ? "OPENED"
            : event.type === DECISION_EVENT_TYPES.windowActivated
              ? "ACTIVATED"
              : event.type === DECISION_EVENT_TYPES.windowEvaluated
                ? "EVALUATED"
                : "COMPLETED";
        if (WINDOW_ORDER.indexOf(nextState) < WINDOW_ORDER.indexOf(projected.state)) {
          fail({
            validation: "FSM_TRANSITIONS",
            reasonCode: "RPL_TRANSITION_INVALID",
            eventId: event.eventId,
            detail: `window ${windowInstanceId}: ${projected.state} → ${nextState}`,
          });
        }
        projected.state = nextState;
        if (event.type === DECISION_EVENT_TYPES.windowEvaluated) projected.evaluations += 1;
        if (event.type === DECISION_EVENT_TYPES.windowCompleted) {
          projected.completionReason =
            (event.payload as { completionReason?: string }).completionReason ?? null;
        }
        const contextId = (event.payload as { executionContextId?: string }).executionContextId;
        if (contextId) executionContextIds.add(contextId);
        windows.set(windowInstanceId, projected);
        break;
      }
      case DECISION_EVENT_TYPES.executionIntentCreated: {
        const intent = event.payload as { executionIntentId: string; windowInstanceId: string };
        executionIntentIds.add(intent.executionIntentId);
        const projected = windows.get(intent.windowInstanceId);
        if (projected) projected.executionIntentId = intent.executionIntentId;
        break;
      }
      case DECISION_EVENT_TYPES.tradeQuotaConsumed: {
        const payload = event.payload as {
          quota: { initial: number; remaining: number; consumed: number };
        };
        if (quotaInitial === null) quotaInitial = payload.quota.initial;
        if (quotaRemaining !== null && payload.quota.remaining > quotaRemaining) {
          fail({
            validation: "QUOTA_PROGRESSION",
            reasonCode: "RPL_QUOTA_REGRESSION",
            eventId: event.eventId,
            detail: `remaining rose from ${quotaRemaining} to ${payload.quota.remaining}`,
          });
        }
        quotaRemaining = payload.quota.remaining;
        quotaConsumed = payload.quota.consumed;
        break;
      }
      case TRADE_EVENT_TYPES.riskApproved:
        riskApproved += 1;
        break;
      case TRADE_EVENT_TYPES.riskDenied:
        riskDenied += 1;
        break;
      case TRADE_EVENT_TYPES.orderSubmitted:
      case TRADE_EVENT_TYPES.orderUpdated:
      case TRADE_EVENT_TYPES.orderCancelled:
      case TRADE_EVENT_TYPES.orderFilled: {
        const snapshot = ((event.type === TRADE_EVENT_TYPES.orderFilled
          ? (event.payload as { order?: unknown }).order
          : event.payload) ?? {}) as {
          orderId?: string;
          executionIntentId?: string;
          state?: OrderState;
          filledQuantity?: number;
        };
        // A payload without an order id cannot be projected; record it as a
        // divergence rather than crashing the replay run.
        if (!snapshot.orderId) {
          validations.FSM_TRANSITIONS = false;
          mismatches.push({
            validation: "FSM_TRANSITIONS",
            reasonCode: "RPL_TRANSITION_INVALID",
            eventId: event.eventId,
            detail: `${event.type} payload is missing an order id`,
          });
          break;
        }
        const orderId = snapshot.orderId;
        const intentId = snapshot.executionIntentId ?? "unknown";
        const nextState: OrderState = snapshot.state ?? "CREATED";
        const filledQuantity = snapshot.filledQuantity ?? 0;


        const projected = orders.get(orderId) ?? {
          orderId,
          executionIntentId: intentId,
          state: "CREATED" as OrderState,
          filledQuantity: 0,
          transitions: [] as string[],
        };
        if (nextState !== projected.state) {
          const allowed = ORDER_TRANSITIONS[projected.state];
          if (!allowed.includes(nextState)) {
            fail({
              validation: "FSM_TRANSITIONS",
              reasonCode: "RPL_TRANSITION_INVALID",
              eventId: event.eventId,
              detail: `order ${orderId}: ${projected.state} → ${nextState}`,
            });
          }
          projected.transitions.push(`${projected.state}->${nextState}`);
          projected.state = nextState;
        }
        projected.filledQuantity = filledQuantity;
        orders.set(orderId, projected);
        if (!executionIntentIds.has(intentId)) {
          fail({
            validation: "EXECUTION_IDS",
            reasonCode: "RPL_UNKNOWN_EXECUTION",
            eventId: event.eventId,
            detail: `order references unknown execution intent ${intentId}`,
          });
        }

        break;
      }
      case TRADE_EVENT_TYPES.executionCompleted:
      case TRADE_EVENT_TYPES.executionFailed: {
        const intentId =
          event.metadata.executionIntentId ??
          (event.payload as { executionIntentId?: string }).executionIntentId ??
          null;
        if (intentId && !executionIntentIds.has(intentId)) {
          fail({
            validation: "EXECUTION_IDS",
            reasonCode: "RPL_UNKNOWN_EXECUTION",
            eventId: event.eventId,
            detail: `terminal execution for unknown intent ${intentId}`,
          });
        }
        break;
      }
      case EVENT_CATALOG.TradeSettled.type:
        settlements += 1;
        break;
      default:
        break;
    }
  }

  // Orders left in a non-terminal state are legal (still working) — only the
  // transitions themselves are validated, never the trading outcome.
  const projection: ReplayProjection = {
    marketStateVersions,
    latestMarketStateVersion,
    executionContextIds: [...executionContextIds].sort(),
    windows: [...windows.values()].sort((a, b) =>
      a.windowInstanceId.localeCompare(b.windowInstanceId),
    ),
    executionIntentIds: [...executionIntentIds].sort(),
    riskApproved,
    riskDenied,
    orders: [...orders.values()].sort((a, b) => a.orderId.localeCompare(b.orderId)),
    settlements,
    quota: { initial: quotaInitial, remaining: quotaRemaining, consumed: quotaConsumed },
    correlationIds: [...correlationIds].sort(),
  };

  const first = ordered[0] ?? null;
  const last = ordered[ordered.length - 1] ?? null;
  const runId = options.runId ?? `rpl_${digest128(ordered.map((e) => e.eventId).join("|"))}`;

  return {
    runId,
    replayFormatVersion: versionOf("replayFormat"),
    eventCount: ordered.length,
    fromIso: first?.occurredAt ?? null,
    toIso: last?.occurredAt ?? null,
    deterministic: mismatches.length === 0,
    validations,
    mismatches,
    projection,
    digest: replayDigest(projection),
  };
}

export function isTerminalOrderState(state: OrderState): boolean {
  return ORDER_TERMINAL_STATES.includes(state);
}
