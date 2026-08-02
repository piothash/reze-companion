/**
 * ARC — configuration synchronization contract (M6.7).
 *
 * Pure module. It defines the ownership contract between the operator console
 * (editing, validation, viewing), Lovable Cloud (persistence, version history,
 * audit) and the VPS trading authority (validation, activation, immutable
 * runtime snapshots, live configuration).
 *
 * Nothing here executes trading logic, performs I/O, or decides what runs: the
 * VPS is the sole owner of the active runtime configuration (ADR-0001). This
 * module only describes, hashes, validates and interprets configuration state.
 */
import { z } from "zod";

import { EventEnvelopeFactory, type EventEnvelope } from "../contracts/event-envelope";
import type { Clock } from "../shared/time";
import { digest128 } from "../shared/ids";
import { EVENT_CATALOG } from "../platform/event-catalog";
import { offsetToMillis, stableStringify, type ExecutionProfile } from "../decision/configuration";

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

/** Lifecycle of an immutable stored configuration version. */
export const CONFIGURATION_VERSION_STATUSES = [
  "PENDING",
  "ACTIVE",
  "REJECTED",
  "ARCHIVED",
  "SUPERSEDED",
] as const;
export type ConfigurationVersionStatus = (typeof CONFIGURATION_VERSION_STATUSES)[number];

/** Runtime status reported back by the trading authority. */
export const RUNTIME_CONFIGURATION_STATUSES = [
  "RUNNING",
  "STOPPED",
  "DEGRADED",
  "UNKNOWN",
] as const;
export type RuntimeConfigurationStatus = (typeof RUNTIME_CONFIGURATION_STATUSES)[number];

/** Why a configuration change was dispatched. */
export const CONFIGURATION_ORIGINS = [
  "SAVE",
  "ACTIVATE",
  "ROLLBACK",
  "DUPLICATE",
  "ARCHIVE",
  "RESTORE",
] as const;
export type ConfigurationOrigin = (typeof CONFIGURATION_ORIGINS)[number];

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Deterministic content hash of a configuration document. Identical documents
 * always hash identically, so a restart or reconnect cannot produce drift or a
 * duplicate activation for the same content.
 */
export function configurationHash(profile: ExecutionProfile): string {
  // Window order is presentation only — priority derives from the offset — so
  // the canonical form sorts windows and reordering never mints a new version.
  const canonical = {
    ...profile,
    windows: [...profile.windows].sort(
      (left, right) =>
        offsetToMillis(left.offset, left.unit) - offsetToMillis(right.offset, right.unit),
    ),
  };
  return `cfgh_${digest128(stableStringify(canonical))}`;
}


// ---------------------------------------------------------------------------
// Pre-dispatch validation (console-side; the authority validates again)
// ---------------------------------------------------------------------------

export interface ConfigurationValidationIssue {
  readonly reasonCode: string;
  readonly detail: string;
}

export interface ConfigurationValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ConfigurationValidationIssue[];
}

function issue(reasonCode: string, detail: string): ConfigurationValidationIssue {
  return { reasonCode, detail };
}

/**
 * Console-side pre-flight validation. It never authorises activation — the VPS
 * validates independently before it swaps runtime configuration — it only stops
 * obviously invalid documents from ever reaching the trading authority.
 */
export function validateConfigurationForDispatch(
  profile: ExecutionProfile,
): ConfigurationValidationResult {
  const issues: ConfigurationValidationIssue[] = [];

  if (profile.windows.length === 0) {
    issues.push(issue("CFG_PROFILE_EMPTY", "Profile contains no window definitions."));
  }

  const enabled = profile.windows.filter((window) => window.enabled);
  if (profile.windows.length > 0 && enabled.length === 0) {
    issues.push(issue("CFG_PROFILE_EMPTY", "Every window definition is disabled."));
  }

  const seen = new Set<number>();
  for (const window of profile.windows) {
    const millis = offsetToMillis(window.offset, window.unit);
    if (seen.has(millis)) {
      issues.push(
        issue("CFG_WINDOW_DUPLICATE", `Duplicate window offset: ${window.offset}${window.unit}.`),
      );
    }
    seen.add(millis);

    if (!(window.twapBuffer >= 0) || !Number.isFinite(window.twapBuffer)) {
      issues.push(issue("CFG_INVALID_BUFFER", `Invalid TWAP buffer on window ${window.offset}.`));
    }
    if (window.timeoutMillisOverride !== null && !(window.timeoutMillisOverride > 0)) {
      issues.push(
        issue("CFG_INVALID_TIMEOUT", `Invalid timeout override on window ${window.offset}.`),
      );
    }
  }

  if (!(profile.timeoutMillis > 0)) {
    issues.push(issue("CFG_INVALID_TIMEOUT", "Global order timeout must be greater than zero."));
  }
  if (!(profile.maxTrades > 0)) {
    issues.push(issue("CFG_INVALID_QUOTA", "Trades per market must be at least one."));
  }
  if (profile.executionMode === "SINGLE_TRADE" && profile.maxTrades !== 1) {
    issues.push(issue("CFG_INVALID_QUOTA", "Single trade mode allows exactly one execution."));
  }
  if (
    profile.executionMode === "MULTI_TRADE" &&
    enabled.length > 0 &&
    profile.maxTrades > enabled.length
  ) {
    issues.push(
      issue(
        "CFG_INVALID_QUOTA",
        `Trades per market (${profile.maxTrades}) exceeds the enabled window quota (${enabled.length}).`,
      ),
    );
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Trading authority contract
// ---------------------------------------------------------------------------

/** Payload the console sends to the VPS configuration endpoint. */
export const configurationDispatchSchema = z.object({
  profileName: z.string().min(1),
  executionProfileId: z.string().min(1),
  version: z.number().int().positive(),
  configHash: z.string().min(1),
  origin: z.enum(CONFIGURATION_ORIGINS),
  correlationId: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedAtIso: z.string().min(1),
  configuration: z.unknown(),
});
export type ConfigurationDispatch = z.infer<typeof configurationDispatchSchema>;

/** Response contract the VPS must honour for apply and read-back calls. */
export const authorityConfigurationSchema = z.object({
  accepted: z.boolean(),
  snapshotId: z.string().min(1).nullable().default(null),
  configHash: z.string().min(1).nullable().default(null),
  version: z.number().int().nullable().default(null),
  executionProfileId: z.string().nullable().default(null),
  profileName: z.string().nullable().default(null),
  runtimeStatus: z.enum(RUNTIME_CONFIGURATION_STATUSES).default("UNKNOWN"),
  reasonCode: z.string().nullable().default(null),
  message: z.string().nullable().default(null),
  activatedAtIso: z.string().nullable().default(null),
  activatedBy: z.string().nullable().default(null),
  engineVersion: z.string().nullable().default(null),
  platformVersion: z.string().nullable().default(null),
});
export type AuthorityConfiguration = z.infer<typeof authorityConfigurationSchema>;

export type AuthorityOutcomeKind = "APPLIED" | "REJECTED" | "UNREACHABLE" | "UNREGISTERED";

export interface AuthorityOutcome {
  readonly kind: AuthorityOutcomeKind;
  readonly status: ConfigurationVersionStatus;
  readonly reasonCode: string;
  readonly detail: string;
  readonly authority: AuthorityConfiguration | null;
}

/**
 * Interprets an authority reply. Absence of a reply is never success: an
 * unreachable or unregistered authority leaves the version PENDING, so the
 * console can never claim a configuration is running when it is not.
 */
export function interpretAuthorityReply(
  reply: AuthorityConfiguration | null,
  failure?: { kind: "UNREACHABLE" | "UNREGISTERED"; detail: string },
): AuthorityOutcome {
  if (!reply) {
    const kind = failure?.kind ?? "UNREACHABLE";
    return {
      kind,
      status: "PENDING",
      reasonCode: kind === "UNREGISTERED" ? "CFG_AUTHORITY_UNREGISTERED" : "CFG_AUTHORITY_UNREACHABLE",
      detail:
        failure?.detail ??
        "The trading authority did not answer. The version is stored but is not running.",
      authority: null,
    };
  }

  if (!reply.accepted) {
    return {
      kind: "REJECTED",
      status: "REJECTED",
      reasonCode: reply.reasonCode ?? "CFG_REJECTED",
      detail: reply.message ?? "Configuration rejected by the trading authority.",
      authority: reply,
    };
  }

  if (!reply.snapshotId) {
    return {
      kind: "UNREACHABLE",
      status: "PENDING",
      reasonCode: "CFG_APPLY_FAILED",
      detail: "Authority accepted the configuration without returning a runtime snapshot id.",
      authority: reply,
    };
  }

  return {
    kind: "APPLIED",
    status: "ACTIVE",
    reasonCode: "CFG_APPLIED",
    detail: "Configuration applied to the runtime engine.",
    authority: reply,
  };
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

export interface RuntimeMirror {
  readonly version: number | null;
  readonly configHash: string | null;
  readonly snapshotId: string | null;
}

export interface DriftReport {
  readonly drifted: boolean;
  readonly reasonCode: string | null;
  readonly detail: string | null;
}

/**
 * Compares the configuration the engine reports it is running against the
 * latest version marked ACTIVE in persistence. Divergence is surfaced, never
 * silently reconciled — the engine remains the authority.
 */
export function detectConfigurationDrift(
  runtime: RuntimeMirror | null,
  latestActive: { version: number; configHash: string } | null,
): DriftReport {
  if (!runtime || runtime.configHash === null) {
    return {
      drifted: false,
      reasonCode: null,
      detail: "No runtime configuration reported by the trading authority.",
    };
  }
  if (!latestActive) {
    return {
      drifted: true,
      reasonCode: "CFG_RUNTIME_DRIFT",
      detail: "The engine reports a configuration that has no stored active version.",
    };
  }
  if (runtime.configHash !== latestActive.configHash) {
    return {
      drifted: true,
      reasonCode: "CFG_RUNTIME_DRIFT",
      detail: `Engine runs hash ${runtime.configHash}; latest active version ${latestActive.version} is ${latestActive.configHash}.`,
    };
  }
  return { drifted: false, reasonCode: null, detail: null };
}

// ---------------------------------------------------------------------------
// Canonical synchronization events
// ---------------------------------------------------------------------------

export interface ConfigurationEventContext {
  readonly profileName: string;
  readonly executionProfileId: string;
  readonly version: number;
  readonly configHash: string;
  readonly snapshotId: string | null;
  readonly operator: string;
  readonly origin: ConfigurationOrigin;
  readonly correlationId: string;
}

type ConfigurationEventName =
  | "ConfigurationVersionCreated"
  | "ConfigurationChanged"
  | "ConfigurationValidated"
  | "ConfigurationApplied"
  | "ConfigurationRejected"
  | "ConfigurationActivated"
  | "ConfigurationArchived"
  | "ConfigurationRolledBack";

const EVENT_REASON: Record<ConfigurationEventName, string> = {
  ConfigurationVersionCreated: "CFG_VERSION_CREATED",
  ConfigurationChanged: "CFG_CHANGED",
  ConfigurationValidated: "CFG_VALIDATED",
  ConfigurationApplied: "CFG_APPLIED",
  ConfigurationRejected: "CFG_REJECTED",
  ConfigurationActivated: "CFG_PROFILE_ACTIVATED",
  ConfigurationArchived: "CFG_ARCHIVED",
  ConfigurationRolledBack: "CFG_ROLLED_BACK",
};

/**
 * Deterministic builder for the configuration synchronization events. Every
 * event carries version, snapshot id, operator, timestamp, correlation id and
 * a reason code, so it participates in replay and audit unchanged.
 */
export class ConfigurationEventFactory {
  private readonly factory: EventEnvelopeFactory;

  constructor(clock: Clock, source = "configuration") {
    this.factory = new EventEnvelopeFactory(clock, source);
  }

  build(
    name: ConfigurationEventName,
    context: ConfigurationEventContext,
    extra: Record<string, string | number | boolean | null> = {},
    reasonCodeOverride?: string,
  ): EventEnvelope {
    const entry = EVENT_CATALOG[name];
    const reasonCode = (reasonCodeOverride ?? EVENT_REASON[name]) as never;
    return this.factory.create({
      type: entry.type,
      source: entry.emitter,
      reasonCode,
      correlationId: context.correlationId,
      idempotencyKey: digest128(
        [name, context.profileName, String(context.version), context.configHash].join("\u0000"),
      ),
      attributes: {
        profileName: context.profileName,
        executionProfileId: context.executionProfileId,
        version: context.version,
        configHash: context.configHash,
        origin: context.origin,
        snapshotId: context.snapshotId ?? "",
      },
      payload: {
        ...context,
        ...extra,
      },
    });
  }
}
