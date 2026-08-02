/**
 * ARC — deterministic recovery projection (M6 Production Hardening).
 *
 * Recovery is a *read-only* rebuild of the resumable runtime state from the
 * append-only canonical event stream. It answers exactly one question after a
 * restart: "what already happened, and what must therefore never be repeated?"
 *
 * It contains no strategy, no scheduling, no IO and no trading decision. The
 * VPS remains the sole trading authority (ADR-0001); this projection exists so
 * that a restarted process can suppress duplicate intents, orders, settlements
 * and ledger records, and so that quota, exposure reservations, execution
 * context and active windows are restored exactly as the stream describes.
 */
import { compareEnvelopes, type EventEnvelope } from "../contracts/event-envelope";
import { digest128 } from "../shared/ids";
import { DECISION_EVENT_TYPES } from "../decision/events";
import { TRADE_EVENT_TYPES } from "../trade/events";
import { ORDER_TERMINAL_STATES, type OrderState } from "../trade/types";
import { EVENT_CATALOG } from "./event-catalog";
import { reconstructLedger } from "./ledger";

export type RecoveredWindowState = "OPENED" | "ACTIVATED" | "EVALUATED" | "COMPLETED";

export interface RecoveredWindow {
  windowInstanceId: string;
  state: RecoveredWindowState;
  executionContextId: string | null;
  executionIntentId: string | null;
  completionReason: string | null;
}

export type RecoveredIntentPhase =
  | "CREATED"
  | "RISK_APPROVED"
  | "RISK_DENIED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED";

export interface RecoveredIntent {
  executionIntentId: string;
  windowInstanceId: string | null;
  phase: RecoveredIntentPhase;
  settled: boolean;
}

export interface RecoveredOrder {
  orderId: string;
  executionIntentId: string;
  state: OrderState;
  filledQuantity: number;
  terminal: boolean;
}

export interface RecoveredReservation {
  reservationId: string;
  executionIntentId: string;
  marketInstanceId: string;
  reserved: number;
  amount: number;
  state: string;
}

export interface RecoveryState {
  /** Highest sequence observed; a restart resumes strictly above this value. */
  lastSequence: number;
  lastEventId: string | null;
  eventCount: number;
  quota: { initial: number | null; remaining: number | null; consumed: number };
  executionContextIds: readonly string[];
  windows: readonly RecoveredWindow[];
  activeWindowIds: readonly string[];
  intents: readonly RecoveredIntent[];
  openIntentIds: readonly string[];
  orders: readonly RecoveredOrder[];
  openOrderIds: readonly string[];
  reservations: readonly RecoveredReservation[];
  reservedTotal: number;
  settledIntentIds: readonly string[];
  ledgerRecordIds: readonly string[];
  /** Stable fingerprint — identical streams recover to an identical state. */
  digest: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

const WINDOW_ORDER: readonly RecoveredWindowState[] = [
  "OPENED",
  "ACTIVATED",
  "EVALUATED",
  "COMPLETED",
];

/**
 * Rebuild resumable state from an event stream. Pure and deterministic: no
 * clock reads, no randomness, no IO.
 */
export function recoverFromEvents(events: readonly EventEnvelope[]): RecoveryState {
  const ordered = [...events].sort(compareEnvelopes);

  const windows = new Map<string, RecoveredWindow>();
  const intents = new Map<string, RecoveredIntent>();
  const orders = new Map<string, RecoveredOrder>();
  const reservations = new Map<string, RecoveredReservation>();
  const executionContextIds = new Set<string>();
  const settledIntentIds = new Set<string>();

  let quotaInitial: number | null = null;
  let quotaRemaining: number | null = null;
  let quotaConsumed = 0;
  let lastSequence = 0;
  let lastEventId: string | null = null;

  const intentOf = (id: string, windowInstanceId: string | null): RecoveredIntent => {
    const existing = intents.get(id);
    if (existing) return existing;
    const created: RecoveredIntent = {
      executionIntentId: id,
      windowInstanceId,
      phase: "CREATED",
      settled: false,
    };
    intents.set(id, created);
    return created;
  };

  for (const event of ordered) {
    lastSequence = Math.max(lastSequence, event.metadata.sequence ?? 0);
    lastEventId = event.eventId;

    switch (event.type) {
      case DECISION_EVENT_TYPES.windowOpened:
      case DECISION_EVENT_TYPES.windowActivated:
      case DECISION_EVENT_TYPES.windowEvaluated:
      case DECISION_EVENT_TYPES.windowCompleted: {
        const payload = event.payload as {
          windowInstanceId?: string;
          executionContextId?: string;
          completionReason?: string;
          window?: { windowInstanceId?: string };
        };
        const windowInstanceId =
          event.metadata.windowInstanceId ??
          payload.windowInstanceId ??
          payload.window?.windowInstanceId;
        if (!windowInstanceId) break;
        const current: RecoveredWindow = windows.get(windowInstanceId) ?? {
          windowInstanceId,
          state: "OPENED",
          executionContextId: null,
          executionIntentId: null,
          completionReason: null,
        };
        const next: RecoveredWindowState =
          event.type === DECISION_EVENT_TYPES.windowOpened
            ? "OPENED"
            : event.type === DECISION_EVENT_TYPES.windowActivated
              ? "ACTIVATED"
              : event.type === DECISION_EVENT_TYPES.windowEvaluated
                ? "EVALUATED"
                : "COMPLETED";
        if (WINDOW_ORDER.indexOf(next) >= WINDOW_ORDER.indexOf(current.state)) {
          current.state = next;
        }
        if (payload.executionContextId) {
          current.executionContextId = payload.executionContextId;
          executionContextIds.add(payload.executionContextId);
        }
        if (event.type === DECISION_EVENT_TYPES.windowCompleted) {
          current.completionReason = payload.completionReason ?? null;
        }
        windows.set(windowInstanceId, current);
        break;
      }

      case DECISION_EVENT_TYPES.executionIntentCreated: {
        const payload = event.payload as {
          executionIntentId?: string;
          windowInstanceId?: string;
        };
        const id = payload.executionIntentId ?? event.metadata.executionIntentId;
        if (!id) break;
        const windowInstanceId =
          payload.windowInstanceId ?? event.metadata.windowInstanceId ?? null;
        intentOf(id, windowInstanceId);
        if (windowInstanceId) {
          const window = windows.get(windowInstanceId);
          if (window) window.executionIntentId = id;
        }
        break;
      }

      case DECISION_EVENT_TYPES.tradeQuotaConsumed:
      case TRADE_EVENT_TYPES.tradeQuotaConsumed: {
        const payload = event.payload as {
          quota?: { initial?: number; remaining?: number; consumed?: number };
        };
        if (!payload.quota) break;
        if (quotaInitial === null && typeof payload.quota.initial === "number") {
          quotaInitial = payload.quota.initial;
        }
        if (typeof payload.quota.remaining === "number") quotaRemaining = payload.quota.remaining;
        if (typeof payload.quota.consumed === "number") quotaConsumed = payload.quota.consumed;
        break;
      }

      case TRADE_EVENT_TYPES.riskApproved:
      case TRADE_EVENT_TYPES.riskDenied: {
        const id =
          event.metadata.executionIntentId ??
          (event.payload as { executionIntentId?: string }).executionIntentId;
        if (!id) break;
        const intent = intentOf(id, event.metadata.windowInstanceId ?? null);
        intent.phase = event.type === TRADE_EVENT_TYPES.riskApproved ? "RISK_APPROVED" : "RISK_DENIED";
        break;
      }

      case TRADE_EVENT_TYPES.exposureReserved: {
        const payload = event.payload as { reservation?: RecoveredReservation };
        const reservation = payload.reservation;
        if (!reservation?.reservationId) break;
        reservations.set(reservation.reservationId, { ...reservation });
        break;
      }

      case TRADE_EVENT_TYPES.exposureReleased: {
        const payload = event.payload as { reservation?: RecoveredReservation };
        const reservation = payload.reservation;
        if (!reservation?.reservationId) break;
        reservations.set(reservation.reservationId, { ...reservation, reserved: 0 });
        break;
      }

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
        if (!snapshot.orderId) break;
        const intentId =
          snapshot.executionIntentId ?? event.metadata.executionIntentId ?? "unknown";
        const state: OrderState = snapshot.state ?? "CREATED";
        orders.set(snapshot.orderId, {
          orderId: snapshot.orderId,
          executionIntentId: intentId,
          state,
          filledQuantity: snapshot.filledQuantity ?? 0,
          terminal: (ORDER_TERMINAL_STATES as readonly string[]).includes(state),
        });
        if (intentId !== "unknown") {
          const intent = intentOf(intentId, event.metadata.windowInstanceId ?? null);
          if (intent.phase === "CREATED" || intent.phase === "RISK_APPROVED") {
            intent.phase = "EXECUTING";
          }
        }
        break;
      }

      case TRADE_EVENT_TYPES.executionCompleted:
      case TRADE_EVENT_TYPES.executionFailed: {
        const id =
          event.metadata.executionIntentId ??
          (event.payload as { executionIntentId?: string }).executionIntentId;
        if (!id) break;
        const intent = intentOf(id, event.metadata.windowInstanceId ?? null);
        intent.phase = event.type === TRADE_EVENT_TYPES.executionCompleted ? "COMPLETED" : "FAILED";
        break;
      }

      case EVENT_CATALOG.TradeSettled.type: {
        const id =
          event.metadata.executionIntentId ??
          (event.payload as { executionIntentId?: string }).executionIntentId;
        if (!id) break;
        settledIntentIds.add(id);
        intentOf(id, event.metadata.windowInstanceId ?? null).settled = true;
        break;
      }

      default:
        break;
    }
  }

  const windowList = [...windows.values()].sort((a, b) =>
    a.windowInstanceId.localeCompare(b.windowInstanceId),
  );
  const intentList = [...intents.values()].sort((a, b) =>
    a.executionIntentId.localeCompare(b.executionIntentId),
  );
  const orderList = [...orders.values()].sort((a, b) => a.orderId.localeCompare(b.orderId));
  const reservationList = [...reservations.values()].sort((a, b) =>
    a.reservationId.localeCompare(b.reservationId),
  );

  const state: Omit<RecoveryState, "digest"> = {
    lastSequence,
    lastEventId,
    eventCount: ordered.length,
    quota: { initial: quotaInitial, remaining: quotaRemaining, consumed: quotaConsumed },
    executionContextIds: [...executionContextIds].sort(),
    windows: windowList,
    activeWindowIds: windowList
      .filter((window) => window.state !== "COMPLETED")
      .map((window) => window.windowInstanceId),
    intents: intentList,
    openIntentIds: intentList
      .filter((intent) => intent.phase !== "COMPLETED" && intent.phase !== "FAILED" && intent.phase !== "RISK_DENIED")
      .map((intent) => intent.executionIntentId),
    orders: orderList,
    openOrderIds: orderList.filter((order) => !order.terminal).map((order) => order.orderId),
    reservations: reservationList,
    reservedTotal: reservationList.reduce((total, entry) => total + (entry.reserved || 0), 0),
    settledIntentIds: [...settledIntentIds].sort(),
    ledgerRecordIds: reconstructLedger(ordered)
      .map((record) => record.recordId)
      .sort(),
  };

  return Object.freeze({ ...state, digest: digest128(stableStringify(state)) });
}

/**
 * Idempotency guard derived from recovered state. A restarted process asks the
 * guard before emitting anything that must exist at most once.
 */
export interface RecoveryGuard {
  isKnownIntent(executionIntentId: string): boolean;
  isKnownOrder(orderId: string): boolean;
  isSettled(executionIntentId: string): boolean;
  isKnownLedgerRecord(recordId: string): boolean;
  isKnownReservation(reservationId: string): boolean;
  nextSequence(): number;
}

export function createRecoveryGuard(state: RecoveryState): RecoveryGuard {
  const intents = new Set(state.intents.map((intent) => intent.executionIntentId));
  const orders = new Set(state.orders.map((order) => order.orderId));
  const settled = new Set(state.settledIntentIds);
  const ledger = new Set(state.ledgerRecordIds);
  const reservations = new Set(state.reservations.map((entry) => entry.reservationId));

  return {
    isKnownIntent: (id) => intents.has(id),
    isKnownOrder: (id) => orders.has(id),
    isSettled: (id) => settled.has(id),
    isKnownLedgerRecord: (id) => ledger.has(id),
    isKnownReservation: (id) => reservations.has(id),
    nextSequence: () => state.lastSequence + 1,
  };
}

export interface RecoveryDivergence {
  reasonCode: "REC_STATE_INCONSISTENT";
  detail: string;
}

/**
 * Compare state recovered from a truncated (restarted) stream against the full
 * stream. Every restart point must converge to the same final state.
 */
export function compareRecovery(
  baseline: RecoveryState,
  recovered: RecoveryState,
): RecoveryDivergence[] {
  if (baseline.digest === recovered.digest) return [];
  const divergences: RecoveryDivergence[] = [];
  const check = (label: string, a: unknown, b: unknown) => {
    if (stableStringify(a) !== stableStringify(b)) {
      divergences.push({
        reasonCode: "REC_STATE_INCONSISTENT",
        detail: `${label} diverged after recovery`,
      });
    }
  };
  check("quota", baseline.quota, recovered.quota);
  check("windows", baseline.windows, recovered.windows);
  check("intents", baseline.intents, recovered.intents);
  check("orders", baseline.orders, recovered.orders);
  check("reservations", baseline.reservations, recovered.reservations);
  check("settlements", baseline.settledIntentIds, recovered.settledIntentIds);
  check("ledger", baseline.ledgerRecordIds, recovered.ledgerRecordIds);
  if (divergences.length === 0) {
    divergences.push({
      reasonCode: "REC_STATE_INCONSISTENT",
      detail: "recovery digest differs without an identifiable field divergence",
    });
  }
  return divergences;
}
