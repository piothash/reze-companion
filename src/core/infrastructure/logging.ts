/**
 * ARC — structured logging (P0/M0).
 *
 * JSON only. Every record carries an engine name, a correlation id and a
 * catalogued reason code. `console.log` is banned across ARC source; the
 * transport below is the single sink.
 */
import { type LogLevel } from "../configuration/schema";
import { type ReasonCode, REASON_CODES } from "../contracts/reason-codes";
import { type Clock, systemClock } from "../shared/time";

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  engine: string;
  message: string;
  reasonCode: string;
  correlationId?: string;
  causationId?: string;
  fields: Record<string, unknown>;
}

export interface LogTransport {
  write(record: LogRecord): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const DEFAULT_REDACT = ["authorization", "apikey", "api_key", "token", "secret", "password", "key"];

export function redact(
  value: unknown,
  redactKeys: readonly string[] = DEFAULT_REDACT,
  depth = 0,
): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, redactKeys, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactKeys.some((needle) => key.toLowerCase().includes(needle.toLowerCase()))
      ? "[redacted]"
      : redact(item, redactKeys, depth + 1);
  }
  return out;
}

/** Writes one JSON object per record to the runtime's stdout stream. */
export class JsonConsoleTransport implements LogTransport {
  write(record: LogRecord): void {
    const line = JSON.stringify(record);
    // eslint-disable-next-line no-console -- single sanctioned logging sink
    if (record.level === "error") console.error(line);
    // eslint-disable-next-line no-console -- single sanctioned logging sink
    else if (record.level === "warn") console.warn(line);
    // eslint-disable-next-line no-console -- single sanctioned logging sink
    else console.log(line);
  }
}

/** Captures records for assertions; used by the foundation test suite. */
export class MemoryTransport implements LogTransport {
  readonly records: LogRecord[] = [];
  write(record: LogRecord): void {
    this.records.push(record);
  }
}

export interface LoggerOptions {
  engine: string;
  level?: LogLevel;
  clock?: Clock;
  transport?: LogTransport;
  redactKeys?: readonly string[];
  correlationId?: string;
  causationId?: string;
  baseFields?: Record<string, unknown>;
}

export interface LogInput {
  reasonCode: ReasonCode;
  message?: string;
  correlationId?: string;
  causationId?: string;
  fields?: Record<string, unknown>;
}

export class Logger {
  private readonly engine: string;
  private readonly level: LogLevel;
  private readonly clock: Clock;
  private readonly transport: LogTransport;
  private readonly redactKeys: readonly string[];
  private readonly correlationId: string | undefined;
  private readonly causationId: string | undefined;
  private readonly baseFields: Record<string, unknown>;

  constructor(options: LoggerOptions) {
    this.engine = options.engine;
    this.level = options.level ?? "info";
    this.clock = options.clock ?? systemClock;
    this.transport = options.transport ?? new JsonConsoleTransport();
    this.redactKeys = options.redactKeys ?? DEFAULT_REDACT;
    this.correlationId = options.correlationId;
    this.causationId = options.causationId;
    this.baseFields = options.baseFields ?? {};
  }

  child(options: Partial<LoggerOptions>): Logger {
    const correlationId = options.correlationId ?? this.correlationId;
    const causationId = options.causationId ?? this.causationId;
    return new Logger({
      engine: options.engine ?? this.engine,
      level: options.level ?? this.level,
      clock: options.clock ?? this.clock,
      transport: options.transport ?? this.transport,
      redactKeys: options.redactKeys ?? this.redactKeys,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(causationId === undefined ? {} : { causationId }),
      baseFields: { ...this.baseFields, ...(options.baseFields ?? {}) },
    });
  }

  debug(input: LogInput): void {
    this.emit("debug", input);
  }
  info(input: LogInput): void {
    this.emit("info", input);
  }
  warn(input: LogInput): void {
    this.emit("warn", input);
  }
  error(input: LogInput): void {
    this.emit("error", input);
  }

  private emit(level: LogLevel, input: LogInput): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const spec = REASON_CODES[input.reasonCode];
    const correlationId = input.correlationId ?? this.correlationId;
    const causationId = input.causationId ?? this.causationId;

    this.transport.write({
      timestamp: this.clock.isoNow(),
      level,
      engine: this.engine,
      message: input.message ?? spec.description,
      reasonCode: spec.code,
      ...(correlationId ? { correlationId } : {}),
      ...(causationId ? { causationId } : {}),
      fields: redact({ ...this.baseFields, ...(input.fields ?? {}) }, this.redactKeys) as Record<
        string,
        unknown
      >,
    });
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}
