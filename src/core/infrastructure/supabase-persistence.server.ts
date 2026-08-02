/**
 * ARC — Supabase-backed persistence adapters (P0/M0).
 *
 * Server-only by filename. Implements the persistence contracts against the
 * existing companion tables (`configuration_profiles`, `feature_flags`,
 * `audit_log`). No trading tables are touched — none exist.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseConfigOrThrow, executionProfileSchema, type ExecutionProfile } from "../configuration/schema";
import {
  type AuditRecord,
  type AuditRepository,
  type ConfigurationRepository,
  type ConfigurationSnapshot,
  type ExecutionProfileRepository,
  type FeatureFlagRecord,
  type FeatureFlagRepository,
  type PersistenceContext,
  InMemoryRuntimeStateStore,
} from "./persistence";

type Client = SupabaseClient<never, "public", never>;

interface ProfileRow {
  id: string;
  name: string;
  description: string | null;
  config: unknown;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

function toSnapshot(row: ProfileRow): ConfigurationSnapshot {
  const config = parseConfigOrThrow((row.config as { config?: unknown })?.config ?? row.config);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    configVersion: config.configVersion,
    config,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseConfigurationRepository implements ConfigurationRepository {
  constructor(
    private readonly supabase: Client,
    private readonly userId: string,
  ) {}

  private table() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types are not generic here
    return (this.supabase as any).from("configuration_profiles");
  }

  async listSnapshots(): Promise<ConfigurationSnapshot[]> {
    const { data, error } = await this.table().select("*").order("created_at", { ascending: false });
    if (error) throw new Error(`configuration snapshots unavailable: ${error.message}`);
    return ((data ?? []) as ProfileRow[]).map(toSnapshot);
  }

  async getSnapshot(id: string): Promise<ConfigurationSnapshot | null> {
    const { data, error } = await this.table().select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`configuration snapshot unavailable: ${error.message}`);
    return data ? toSnapshot(data as ProfileRow) : null;
  }

  async getDefaultSnapshot(): Promise<ConfigurationSnapshot | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("is_default", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`default configuration unavailable: ${error.message}`);
    return data ? toSnapshot(data as ProfileRow) : null;
  }

  async saveSnapshot(input: {
    name: string;
    description?: string | null;
    config: Parameters<typeof parseConfigOrThrow>[0];
    isDefault?: boolean;
  }): Promise<ConfigurationSnapshot> {
    const config = parseConfigOrThrow(input.config);
    const { data, error } = await this.table()
      .insert({
        user_id: this.userId,
        name: input.name,
        description: input.description ?? null,
        config: { configVersion: config.configVersion, config },
        is_default: input.isDefault ?? false,
      })
      .select("*")
      .single();
    if (error) throw new Error(`configuration snapshot not saved: ${error.message}`);
    return toSnapshot(data as ProfileRow);
  }
}

export class SupabaseFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly supabase: Client) {}

  async list(): Promise<FeatureFlagRecord[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types are not generic here
    const { data, error } = await (this.supabase as any)
      .from("feature_flags")
      .select("key, enabled, description");
    if (error) throw new Error(`feature flags unavailable: ${error.message}`);
    return (data ?? []) as FeatureFlagRecord[];
  }

  async isEnabled(key: string, fallback = false): Promise<boolean> {
    const flags = await this.list();
    return flags.find((flag) => flag.key === key)?.enabled ?? fallback;
  }
}

/**
 * Execution profiles are stored as configuration snapshots whose payload
 * carries an `executionProfile` document. Malformed rows are ignored rather
 * than crashing the control plane.
 */
export class SupabaseExecutionProfileRepository implements ExecutionProfileRepository {
  constructor(private readonly supabase: Client) {}

  async list(): Promise<ExecutionProfile[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types are not generic here
    const { data, error } = await (this.supabase as any)
      .from("configuration_profiles")
      .select("config");
    if (error) throw new Error(`execution profiles unavailable: ${error.message}`);
    return ((data ?? []) as { config: { executionProfile?: unknown } }[])
      .map((row) => executionProfileSchema.safeParse(row.config?.executionProfile))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  }

  async get(id: string): Promise<ExecutionProfile | null> {
    return (await this.list()).find((profile) => profile.id === id) ?? null;
  }
}

export class SupabaseAuditRepository implements AuditRepository {
  constructor(
    private readonly supabase: Client,
    private readonly userId: string,
  ) {}

  async append(record: AuditRecord): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types are not generic here
    const { error } = await (this.supabase as any).from("audit_log").insert({
      user_id: this.userId,
      action: record.action,
      entity: record.entity ?? null,
      entity_id: record.entityId ?? null,
      metadata: record.metadata ?? {},
    });
    if (error) throw new Error(`audit record not written: ${error.message}`);
  }
}

export function createSupabasePersistence(supabase: Client, userId: string): PersistenceContext {
  return {
    configuration: new SupabaseConfigurationRepository(supabase, userId),
    featureFlags: new SupabaseFeatureFlagRepository(supabase),
    profiles: new SupabaseExecutionProfileRepository(supabase),
    audit: new SupabaseAuditRepository(supabase, userId),
    runtimeState: new InMemoryRuntimeStateStore(),
  };
}
