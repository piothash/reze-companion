/**
 * ARC — platform audit trail (M4 Platform Services).
 *
 * Every configuration change, profile change, replay run, authentication
 * action and platform action produces an immutable audit record. Audit records
 * are control-plane facts: they never carry credentials and never describe a
 * trading instruction.
 */
import { type AuditRecord, type AuditRepository } from "../infrastructure/persistence";
import { versionOf } from "../contracts/versions";
import { type Clock } from "../shared/time";

export const AUDIT_ACTIONS = [
  "CONFIGURATION_CHANGED",
  "CONFIGURATION_SNAPSHOT_SAVED",
  "PROFILE_CHANGED",
  "PROFILE_ACTIVATED",
  "REPLAY_STARTED",
  "REPLAY_COMPLETED",
  "AUTH_SIGNED_IN",
  "AUTH_SIGNED_OUT",
  "PLATFORM_ACTION",
  "API_READ",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface PlatformAuditRecord extends AuditRecord {
  action: AuditAction;
  entity: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(Object.freeze({ ...record }));
  }
}

/**
 * Thin recorder over any AuditRepository. Failures are surfaced, never
 * swallowed: an unrecorded platform action is a compliance gap.
 */
export class AuditTrail {
  readonly auditVersion = versionOf("auditTrail");

  constructor(
    private readonly repository: AuditRepository,
    private readonly clock: Clock,
    private readonly actor: string,
  ) {}

  private async write(
    action: AuditAction,
    entity: string | null,
    entityId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<PlatformAuditRecord> {
    const record: PlatformAuditRecord = {
      action,
      entity,
      entityId,
      metadata: {
        ...metadata,
        actor: this.actor,
        recordedAtIso: this.clock.isoNow(),
        auditVersion: this.auditVersion,
      },
    };
    await this.repository.append(record);
    return record;
  }

  configurationChanged(snapshotId: string, metadata: Record<string, unknown> = {}) {
    return this.write("CONFIGURATION_CHANGED", "configuration", snapshotId, metadata);
  }

  configurationSnapshotSaved(snapshotId: string, metadata: Record<string, unknown> = {}) {
    return this.write("CONFIGURATION_SNAPSHOT_SAVED", "configuration", snapshotId, metadata);
  }

  profileChanged(profileId: string, metadata: Record<string, unknown> = {}) {
    return this.write("PROFILE_CHANGED", "execution_profile", profileId, metadata);
  }

  profileActivated(profileId: string, metadata: Record<string, unknown> = {}) {
    return this.write("PROFILE_ACTIVATED", "execution_profile", profileId, metadata);
  }

  replayStarted(runId: string, metadata: Record<string, unknown> = {}) {
    return this.write("REPLAY_STARTED", "replay_run", runId, metadata);
  }

  replayCompleted(runId: string, metadata: Record<string, unknown> = {}) {
    return this.write("REPLAY_COMPLETED", "replay_run", runId, metadata);
  }

  authAction(action: "AUTH_SIGNED_IN" | "AUTH_SIGNED_OUT", metadata: Record<string, unknown> = {}) {
    return this.write(action, "auth", null, metadata);
  }

  platformAction(name: string, metadata: Record<string, unknown> = {}) {
    return this.write("PLATFORM_ACTION", "platform", name, metadata);
  }

  apiRead(endpoint: string, metadata: Record<string, unknown> = {}) {
    return this.write("API_READ", "api", endpoint, metadata);
  }
}
