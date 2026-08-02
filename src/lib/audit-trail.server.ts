/**
 * ARC — M8.1 operator audit writer.
 *
 * The single path every operator-significant action takes into `audit_log`, so
 * each record carries actor, timestamp, action, resource, result and
 * correlation id. Detail is redacted before it is written; secret material can
 * never reach the trail even if a caller passes it by mistake.
 *
 * An unrecorded operator action is a compliance gap, so write failures are
 * surfaced to the caller rather than swallowed.
 */
import {
  buildOperatorAuditRecord,
  type AuditResult,
  type OperatorAuditRecord,
} from "@/core/platform/audit-record";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

export interface RecordAuditInput {
  readonly action: string;
  readonly resource: string;
  readonly resourceId?: string | null;
  readonly result?: AuditResult;
  readonly correlationId?: string | null;
  readonly detail?: Record<string, unknown>;
  readonly occurredAtIso?: string;
}

/**
 * Appends one operator audit record. `userId` is the actor: the signed-in
 * operator, or the operator who owns the authority that acted.
 */
export async function recordOperatorAudit(
  client: AnyClient,
  userId: string,
  input: RecordAuditInput,
): Promise<OperatorAuditRecord> {
  const record = buildOperatorAuditRecord({
    actor: userId,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ?? null,
    result: input.result ?? "SUCCESS",
    correlationId: input.correlationId ?? null,
    occurredAtIso: input.occurredAtIso ?? new Date().toISOString(),
    detail: input.detail ?? {},
  });

  const { error } = await client.from("audit_log").insert({
    user_id: record.actor,
    action: record.action,
    entity: record.resource,
    entity_id: record.resourceId,
    metadata: {
      ...record.detail,
      actor: record.actor,
      result: record.result,
      correlationId: record.correlationId,
      occurredAtIso: record.occurredAtIso,
    },
  });
  if (error) throw new Error(`audit record failed: ${error.message}`);

  return record;
}
