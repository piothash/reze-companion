/**
 * ARC — M8.1 operator audit record shape.
 *
 * Pure. Every operator-significant action writes one record with the same six
 * fields, so the audit trail can be read without knowing which subsystem wrote
 * it: actor, timestamp, action, resource, result, correlationId.
 *
 * Audit records are control-plane facts. They never carry credentials, key
 * material or a trading instruction — the VPS owns trading (ADR-0001).
 */

/** Actions the control plane must record. Anything operator-significant is here. */
export const OPERATOR_AUDIT_ACTIONS = [
  "ownership.claimed",
  "ownership.transferred",
  "ownership.finalized",
  "configuration.published",
  "configuration.activated",
  "configuration.rejected",
  "configuration.rollback",
  "configuration.archived",
  "authority.registered",
  "authority.revoked",
  "authority.heartbeat",
  "authority.rejected",
  "security.changed",
] as const;

export type OperatorAuditAction = (typeof OPERATOR_AUDIT_ACTIONS)[number];

export type AuditResult = "SUCCESS" | "FAILURE" | "REJECTED";

export interface OperatorAuditInput {
  /** The signed-in operator, or the authority acting on its own behalf. */
  readonly actor: string;
  readonly action: string;
  /** Logical resource type, e.g. `configuration_version`. */
  readonly resource: string;
  readonly resourceId: string | null;
  readonly result: AuditResult;
  readonly correlationId: string | null;
  readonly occurredAtIso: string;
  /** Extra context. Must never contain secret material. */
  readonly detail?: Record<string, unknown>;
}

export interface OperatorAuditRecord {
  readonly actor: string;
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;
  readonly result: AuditResult;
  readonly correlationId: string | null;
  readonly occurredAtIso: string;
  readonly detail: Record<string, unknown>;
}

/**
 * Keys that must never reach the audit trail. Redaction happens here rather
 * than at each call site, so a new writer cannot leak by omission.
 */
const FORBIDDEN_KEY = /(secret|password|passphrase|private[_-]?key|signing[_-]?key|token|apikey|api[_-]?key|authorization|mnemonic)/i;

export function redactAuditDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (FORBIDDEN_KEY.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? redactAuditDetail(value as Record<string, unknown>)
        : value;
  }
  return out;
}

/** Normalizes any operator action into the canonical audit record. */
export function buildOperatorAuditRecord(input: OperatorAuditInput): OperatorAuditRecord {
  return Object.freeze({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId,
    result: input.result,
    correlationId: input.correlationId,
    occurredAtIso: input.occurredAtIso,
    detail: Object.freeze(redactAuditDetail(input.detail ?? {})),
  });
}

/** True when a stored audit row carries every mandated field. */
export function isCompleteAuditRecord(row: {
  actor?: unknown;
  action?: unknown;
  resource?: unknown;
  result?: unknown;
  correlationId?: unknown;
  occurredAtIso?: unknown;
}): boolean {
  return (
    typeof row.actor === "string" &&
    row.actor.length > 0 &&
    typeof row.action === "string" &&
    row.action.length > 0 &&
    typeof row.resource === "string" &&
    row.resource.length > 0 &&
    typeof row.result === "string" &&
    typeof row.occurredAtIso === "string" &&
    (row.correlationId === null || typeof row.correlationId === "string")
  );
}
