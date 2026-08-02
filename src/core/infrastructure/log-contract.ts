/**
 * ARC — structured production logging contract (M6.5).
 *
 * Free-form logging is banned. Every production record must carry the full
 * correlation envelope: timestamp, severity, correlationId, marketInstanceId,
 * windowInstanceId, executionIntentId, orderId and a catalogued reasonCode.
 * Fields that do not apply are explicitly `null`, never absent.
 */
import { type LogRecord, type Logger, type LogInput } from "./logging";
import { type ReasonCode } from "../contracts/reason-codes";

export const REQUIRED_LOG_FIELDS = [
  "timestamp",
  "level",
  "reasonCode",
  "correlationId",
  "marketInstanceId",
  "windowInstanceId",
  "executionIntentId",
  "orderId",
] as const;

export type RequiredLogField = (typeof REQUIRED_LOG_FIELDS)[number];

export interface OperationalContext {
  correlationId: string;
  marketInstanceId?: string | null;
  windowInstanceId?: string | null;
  executionIntentId?: string | null;
  orderId?: string | null;
}

export interface OperationalLogInput {
  reasonCode: ReasonCode;
  message?: string;
  context: OperationalContext;
  fields?: Record<string, unknown>;
}

/** Expands a context into the mandatory field set, nulling what does not apply. */
export function operationalFields(context: OperationalContext): Record<string, unknown> {
  return {
    correlationId: context.correlationId,
    marketInstanceId: context.marketInstanceId ?? null,
    windowInstanceId: context.windowInstanceId ?? null,
    executionIntentId: context.executionIntentId ?? null,
    orderId: context.orderId ?? null,
  };
}

export interface LogContractViolation {
  readonly field: RequiredLogField;
  readonly message: string;
}

/** Verifies one emitted record against the production logging contract. */
export function validateLogRecord(record: LogRecord): LogContractViolation[] {
  const violations: LogContractViolation[] = [];
  const flat: Record<string, unknown> = {
    timestamp: record.timestamp,
    level: record.level,
    reasonCode: record.reasonCode,
    correlationId: record.correlationId ?? record.fields["correlationId"],
    marketInstanceId: record.fields["marketInstanceId"],
    windowInstanceId: record.fields["windowInstanceId"],
    executionIntentId: record.fields["executionIntentId"],
    orderId: record.fields["orderId"],
  };

  for (const field of REQUIRED_LOG_FIELDS) {
    if (!(field in flat)) {
      violations.push({ field, message: "field absent" });
      continue;
    }
    const value = flat[field];
    const nullable =
      field === "marketInstanceId" ||
      field === "windowInstanceId" ||
      field === "executionIntentId" ||
      field === "orderId";
    if (value === undefined) violations.push({ field, message: "field undefined" });
    else if (value === null && !nullable) violations.push({ field, message: "field null" });
    else if (typeof value === "string" && value.trim() === "") {
      violations.push({ field, message: "field empty" });
    }
  }

  if (record.timestamp && !/Z$/.test(record.timestamp)) {
    violations.push({ field: "timestamp", message: "timestamp must be UTC (Z)" });
  }

  return violations;
}

/**
 * Wraps a {@link Logger} so that no record can be emitted without the full
 * operational envelope. This is the only logging entry point permitted in
 * production paths.
 */
export class OperationalLogger {
  constructor(private readonly logger: Logger) {}

  child(context: OperationalContext): OperationalLogger {
    return new OperationalLogger(
      this.logger.child({
        correlationId: context.correlationId,
        baseFields: operationalFields(context),
      }),
    );
  }

  debug(input: OperationalLogInput): void {
    this.logger.debug(this.toInput(input));
  }
  info(input: OperationalLogInput): void {
    this.logger.info(this.toInput(input));
  }
  warn(input: OperationalLogInput): void {
    this.logger.warn(this.toInput(input));
  }
  error(input: OperationalLogInput): void {
    this.logger.error(this.toInput(input));
  }

  private toInput(input: OperationalLogInput): LogInput {
    return {
      reasonCode: input.reasonCode,
      ...(input.message === undefined ? {} : { message: input.message }),
      correlationId: input.context.correlationId,
      fields: { ...operationalFields(input.context), ...(input.fields ?? {}) },
    };
  }
}

export function createOperationalLogger(logger: Logger): OperationalLogger {
  return new OperationalLogger(logger);
}
