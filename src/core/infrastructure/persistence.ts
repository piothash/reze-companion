/**
 * ARC — persistence foundation (P0/M0).
 *
 * Abstraction only. Lovable Cloud (Postgres) is the companion's primary
 * backend; SQLite never runs inside the companion (ADR-0001). No trading
 * tables and no trading records exist at this milestone — only configuration,
 * profiles, feature flags, audit, and the future event/replay contracts.
 */
import { type ArcConfig, type ExecutionProfile } from "../configuration/schema";
import { type EventEnvelope } from "../contracts/event-envelope";

export interface ConfigurationSnapshot {
  id: string;
  name: string;
  description: string | null;
  configVersion: string;
  config: ArcConfig;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigurationRepository {
  listSnapshots(): Promise<ConfigurationSnapshot[]>;
  getSnapshot(id: string): Promise<ConfigurationSnapshot | null>;
  getDefaultSnapshot(): Promise<ConfigurationSnapshot | null>;
  saveSnapshot(input: {
    name: string;
    description?: string | null;
    config: ArcConfig;
    isDefault?: boolean;
  }): Promise<ConfigurationSnapshot>;
}

export interface FeatureFlagRecord {
  key: string;
  enabled: boolean;
  description: string | null;
}

export interface FeatureFlagRepository {
  list(): Promise<FeatureFlagRecord[]>;
  isEnabled(key: string, fallback?: boolean): Promise<boolean>;
}

export interface ExecutionProfileRepository {
  list(): Promise<ExecutionProfile[]>;
  get(id: string): Promise<ExecutionProfile | null>;
}

export interface AuditRecord {
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
}

/**
 * Append-only event store contract. Reserved for a later milestone; declaring
 * it now fixes the shape every engine will code against.
 */
export interface EventStore {
  append(envelope: EventEnvelope): Promise<void>;
  readSince(isoTimestamp: string, limit: number): Promise<EventEnvelope[]>;
  readByCorrelation(correlationId: string): Promise<EventEnvelope[]>;
}

/** Generic key/value runtime state. Never a source of trading truth. */
export interface RuntimeStateStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemoryRuntimeStateStore implements RuntimeStateStore {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.map.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly flags: Record<string, boolean> = {}) {}

  async list(): Promise<FeatureFlagRecord[]> {
    return Object.entries(this.flags).map(([key, enabled]) => ({ key, enabled, description: null }));
  }

  async isEnabled(key: string, fallback = false): Promise<boolean> {
    return this.flags[key] ?? fallback;
  }
}

export interface PersistenceContext {
  configuration: ConfigurationRepository;
  featureFlags: FeatureFlagRepository;
  profiles: ExecutionProfileRepository;
  audit: AuditRepository;
  runtimeState: RuntimeStateStore;
}
