/**
 * ARC — canonical event catalog (M4 Platform Services).
 *
 * Naming registry only. It classifies every canonical ARC event as either a
 * BUSINESS record (ledger-eligible) or an OPERATIONAL observation. It contains
 * no strategy, no trading logic and never emits anything.
 */

export const EVENT_CLASSIFICATIONS = ["BUSINESS", "OPERATIONAL"] as const;
export type EventClassification = (typeof EVENT_CLASSIFICATIONS)[number];

export interface CatalogEntry {
  /** Canonical dotted event type carried on the envelope. */
  readonly type: string;
  /** Documentation name used in the architecture documents. */
  readonly name: string;
  readonly classification: EventClassification;
  readonly emitter: string;
}

function entry(
  name: string,
  type: string,
  classification: EventClassification,
  emitter: string,
): CatalogEntry {
  return { name, type, classification, emitter };
}

export const EVENT_CATALOG = {
  // Business ---------------------------------------------------------------
  ExecutionIntentCreated: entry(
    "ExecutionIntentCreated",
    "decision.intent.created",
    "BUSINESS",
    "decision",
  ),
  RiskApproved: entry("RiskApproved", "trade.risk.approved", "BUSINESS", "trade"),
  RiskDenied: entry("RiskDenied", "trade.risk.denied", "BUSINESS", "trade"),
  OrderSubmitted: entry("OrderSubmitted", "trade.order.submitted", "BUSINESS", "trade"),
  OrderUpdated: entry("OrderUpdated", "trade.order.updated", "BUSINESS", "trade"),
  OrderFilled: entry("OrderFilled", "trade.order.filled", "BUSINESS", "trade"),
  OrderCancelled: entry("OrderCancelled", "trade.order.cancelled", "BUSINESS", "trade"),
  ExecutionCompleted: entry(
    "ExecutionCompleted",
    "trade.execution.completed",
    "BUSINESS",
    "trade",
  ),
  ExecutionFailed: entry("ExecutionFailed", "trade.execution.failed", "BUSINESS", "trade"),
  TradeSettled: entry("TradeSettled", "platform.trade.settled", "BUSINESS", "platform"),
  LedgerRecorded: entry("LedgerRecorded", "platform.ledger.recorded", "BUSINESS", "platform"),

  // Operational ------------------------------------------------------------
  ObservationReceived: entry(
    "ObservationReceived",
    "market.observation.received",
    "OPERATIONAL",
    "market-state",
  ),
  TWAPUpdated: entry("TWAPUpdated", "market.twap.updated", "OPERATIONAL", "market-state"),
  PTBUpdated: entry("PTBUpdated", "market.ptb.updated", "OPERATIONAL", "market-state"),
  SignalConditioned: entry(
    "SignalConditioned",
    "market.signal.conditioned",
    "OPERATIONAL",
    "market-state",
  ),
  AuthoritativeMarketStateUpdated: entry(
    "AuthoritativeMarketStateUpdated",
    "market.state.updated",
    "OPERATIONAL",
    "market-state",
  ),
  WindowOpened: entry("WindowOpened", "decision.window.opened", "OPERATIONAL", "decision"),
  WindowClosed: entry("WindowClosed", "platform.window.closed", "OPERATIONAL", "platform"),
  WindowCompleted: entry(
    "WindowCompleted",
    "decision.window.completed",
    "OPERATIONAL",
    "decision",
  ),
  SchedulerTick: entry("SchedulerTick", "platform.scheduler.tick", "OPERATIONAL", "platform"),
  HealthChanged: entry("HealthChanged", "platform.health.changed", "OPERATIONAL", "platform"),
  FeedConnected: entry("FeedConnected", "platform.feed.connected", "OPERATIONAL", "platform"),
  FeedDisconnected: entry(
    "FeedDisconnected",
    "platform.feed.disconnected",
    "OPERATIONAL",
    "platform",
  ),
  ReplayStarted: entry("ReplayStarted", "platform.replay.started", "OPERATIONAL", "platform"),
  ReplayCompleted: entry("ReplayCompleted", "platform.replay.completed", "OPERATIONAL", "platform"),
} as const satisfies Record<string, CatalogEntry>;

export type CatalogName = keyof typeof EVENT_CATALOG;

export const CATALOG_ENTRIES: readonly CatalogEntry[] = Object.values(EVENT_CATALOG);

const TYPE_INDEX: ReadonlyMap<string, CatalogEntry> = new Map(
  CATALOG_ENTRIES.map((item) => [item.type, item]),
);

export function catalogEntryForType(type: string): CatalogEntry | null {
  return TYPE_INDEX.get(type) ?? null;
}

/**
 * Classifies any event type, including ones not yet catalogued. Unknown types
 * are OPERATIONAL unless they belong to the business prefixes below; nothing
 * reaches the ledger by accident.
 */
export function classifyEventType(type: string): EventClassification {
  const known = TYPE_INDEX.get(type);
  if (known) return known.classification;
  const businessPrefixes = [
    "trade.risk.",
    "trade.order.",
    "trade.execution.",
    "decision.intent.",
    "platform.trade.",
    "platform.ledger.",
  ];
  return businessPrefixes.some((prefix) => type.startsWith(prefix)) ? "BUSINESS" : "OPERATIONAL";
}

export function isBusinessEventType(type: string): boolean {
  return classifyEventType(type) === "BUSINESS";
}

export function catalogNamesByClassification(
  classification: EventClassification,
): readonly string[] {
  return CATALOG_ENTRIES.filter((item) => item.classification === classification).map(
    (item) => item.name,
  );
}
