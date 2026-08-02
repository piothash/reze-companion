/**
 * ARC — Ledger (M4 Platform Services).
 *
 * The ledger holds BUSINESS records only: trades, fees, PnL, settlements and
 * execution summaries. Operational observations (feeds, TWAP, scheduler,
 * health, replay) never enter it. Every record is derived from canonical
 * business events, so the ledger is fully reconstructible and never a source
 * of trading truth on its own.
 */
import { z } from "zod";

import { type EventEnvelope, compareEnvelopes } from "../contracts/event-envelope";
import { deterministicId } from "../shared/ids";
import { versionOf } from "../contracts/versions";
import { EVENT_CATALOG, classifyEventType } from "./event-catalog";
import { type SettlementRecord } from "./events";

export const LEDGER_RECORD_KINDS = [
  "TRADE",
  "FEE",
  "PNL",
  "SETTLEMENT",
  "EXECUTION_SUMMARY",
] as const;
export type LedgerRecordKind = (typeof LEDGER_RECORD_KINDS)[number];

export const ledgerRecordSchema = z.object({
  recordId: z.string().min(1),
  kind: z.enum(LEDGER_RECORD_KINDS),
  executionIntentId: z.string().min(1).nullable(),
  marketInstanceId: z.string().min(1).nullable(),
  windowInstanceId: z.string().min(1).nullable(),
  outcomeKey: z.string().min(1).nullable(),
  quantity: z.number().finite(),
  price: z.number().finite(),
  notional: z.number().finite(),
  fees: z.number().finite(),
  realizedPnl: z.number().finite(),
  occurredAtIso: z.string().datetime({ offset: false }),
  sourceEventId: z.string().min(1),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export type LedgerRecord = z.infer<typeof ledgerRecordSchema>;

export interface LedgerSummary {
  ledgerVersion: string;
  recordCount: number;
  tradeCount: number;
  settlementCount: number;
  totalQuantity: number;
  totalNotional: number;
  totalFees: number;
  realizedPnl: number;
  firstRecordAtIso: string | null;
  lastRecordAtIso: string | null;
}

export interface LedgerReconstruction {
  records: LedgerRecord[];
  summary: LedgerSummary;
  /** Business events observed but not ledger-relevant (risk verdicts etc). */
  ignoredBusinessEventCount: number;
  /** Business events whose payload failed contract validation and were skipped. */
  malformedEventCount: number;
}

export interface LedgerOptions {
  /** Proportional venue fee applied to executed notional. Defaults to zero. */
  feeRate?: number;
}

export class LedgerViolationError extends Error {
  readonly reasonCode = "LDG_OPERATIONAL_REJECTED";
  constructor(message: string) {
    super(message);
    this.name = "LedgerViolationError";
  }
}

function round(value: number, precision = 8): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function baseRecord(
  kind: LedgerRecordKind,
  envelope: EventEnvelope,
  overrides: Partial<LedgerRecord>,
): LedgerRecord {
  const record: LedgerRecord = {
    recordId: deterministicId("LedgerEntryId", kind, envelope.eventId),
    kind,
    executionIntentId: envelope.metadata.executionIntentId ?? null,
    marketInstanceId: envelope.metadata.marketInstanceId ?? null,
    windowInstanceId: envelope.metadata.windowInstanceId ?? null,
    outcomeKey: null,
    quantity: 0,
    price: 0,
    notional: 0,
    fees: 0,
    realizedPnl: 0,
    occurredAtIso: envelope.occurredAt,
    sourceEventId: envelope.eventId,
    metadata: {},
    ...overrides,
  };
  return ledgerRecordSchema.parse(record);
}

/**
 * Rebuilds the ledger from an event stream. Pure and deterministic: the same
 * events in the same order always produce byte-identical records.
 */
export function reconstructLedger(
  events: readonly EventEnvelope[],
  options: LedgerOptions = {},
): LedgerReconstruction {
  const feeRate = options.feeRate ?? 0;
  const ordered = [...events].sort(compareEnvelopes);
  const records: LedgerRecord[] = [];
  let ignoredBusinessEventCount = 0;
  let malformedEventCount = 0;

  for (const envelope of ordered) {
    if (classifyEventType(envelope.type) !== "BUSINESS") continue;

    // A malformed payload must never crash reconstruction: the ledger is read
    // on every dashboard load and during recovery. Skip and count instead.
    const before = records.length;
    try {
      switch (envelope.type) {
        case EVENT_CATALOG.OrderFilled.type: {
          const payload = envelope.payload as {
            fill: { quantity: number; price: number };
            order: { outcomeKey: string };
          };
          const notional = round(payload.fill.quantity * payload.fill.price);
          const fees = round(notional * feeRate);
          records.push(
            baseRecord("TRADE", envelope, {
              outcomeKey: payload.order.outcomeKey,
              quantity: payload.fill.quantity,
              price: payload.fill.price,
              notional,
            }),
          );
          if (fees > 0) {
            records.push(
              baseRecord("FEE", envelope, {
                outcomeKey: payload.order.outcomeKey,
                notional,
                fees,
              }),
            );
          }
          break;
        }
        case EVENT_CATALOG.ExecutionCompleted.type: {
          const report = envelope.payload as {
            outcomeKey: string;
            cumulativeFilledQuantity: number;
            cumulativeNotional: number;
            averagePrice: number;
          };
          records.push(
            baseRecord("EXECUTION_SUMMARY", envelope, {
              outcomeKey: report.outcomeKey,
              quantity: report.cumulativeFilledQuantity,
              price: report.averagePrice,
              notional: round(report.cumulativeNotional),
            }),
          );
          break;
        }
        case EVENT_CATALOG.TradeSettled.type: {
          const settlement = envelope.payload as SettlementRecord;
          records.push(
            baseRecord("SETTLEMENT", envelope, {
              outcomeKey: settlement.outcomeKey,
              quantity: settlement.quantity,
              price: settlement.averagePrice,
              notional: round(settlement.notional),
              fees: round(settlement.fees),
              occurredAtIso: envelope.occurredAt,
              metadata: { settlementId: settlement.settlementId },
            }),
          );
          records.push(
            baseRecord("PNL", envelope, {
              outcomeKey: settlement.outcomeKey,
              realizedPnl: round(settlement.realizedPnl),
              metadata: { settlementId: settlement.settlementId },
            }),
          );
          break;
        }
        default:
          ignoredBusinessEventCount += 1;
      }
    } catch {
      records.length = before;
      malformedEventCount += 1;
    }
  }

  return {
    records,
    summary: summariseLedger(records),
    ignoredBusinessEventCount,
    malformedEventCount,
  };
}

export function summariseLedger(records: readonly LedgerRecord[]): LedgerSummary {
  const trades = records.filter((record) => record.kind === "TRADE");
  const settlements = records.filter((record) => record.kind === "SETTLEMENT");
  const timestamps = records.map((record) => record.occurredAtIso).sort();

  return {
    ledgerVersion: versionOf("ledger"),
    recordCount: records.length,
    tradeCount: trades.length,
    settlementCount: settlements.length,
    totalQuantity: round(trades.reduce((sum, record) => sum + record.quantity, 0)),
    totalNotional: round(trades.reduce((sum, record) => sum + record.notional, 0)),
    totalFees: round(records.reduce((sum, record) => sum + record.fees, 0)),
    realizedPnl: round(records.reduce((sum, record) => sum + record.realizedPnl, 0)),
    firstRecordAtIso: timestamps[0] ?? null,
    lastRecordAtIso: timestamps[timestamps.length - 1] ?? null,
  };
}

/** Guard used by ledger writers: operational events must never be recorded. */
export function assertBusinessEvent(envelope: EventEnvelope): void {
  if (classifyEventType(envelope.type) !== "BUSINESS") {
    throw new LedgerViolationError(`operational event rejected by the ledger: ${envelope.type}`);
  }
}

export interface LedgerRepository {
  append(records: readonly LedgerRecord[]): Promise<void>;
  list(limit?: number): Promise<LedgerRecord[]>;
  summary(): Promise<LedgerSummary>;
}

export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly records = new Map<string, LedgerRecord>();

  async append(records: readonly LedgerRecord[]): Promise<void> {
    for (const record of records) {
      if (this.records.has(record.recordId)) continue;
      this.records.set(record.recordId, Object.freeze({ ...record }));
    }
  }

  async list(limit?: number): Promise<LedgerRecord[]> {
    const all = [...this.records.values()].sort((a, b) =>
      a.occurredAtIso === b.occurredAtIso
        ? a.recordId.localeCompare(b.recordId)
        : a.occurredAtIso < b.occurredAtIso
          ? -1
          : 1,
    );
    return typeof limit === "number" ? all.slice(0, limit) : all;
  }

  async summary(): Promise<LedgerSummary> {
    return summariseLedger(await this.list());
  }
}
