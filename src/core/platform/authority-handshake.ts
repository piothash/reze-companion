/**
 * ARC — VPS authority handshake contract (M6.8).
 *
 * Pure module. It defines the canonical runtime handshake between the operator
 * console (control plane) and the VPS trading engine (sole trading authority,
 * ADR-0001). Nothing here performs I/O, decides what runs, or implements
 * trading logic: it describes the wire contract, normalises what the engine
 * reports, derives the dashboard runtime state and compares saved
 * configuration against running configuration.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Dashboard runtime state vocabulary
// ---------------------------------------------------------------------------

/**
 * The dashboard runtime states. `UNREGISTERED` is now one state among many —
 * the console reports exactly where the handshake stands at every moment.
 */
export const DASHBOARD_RUNTIME_STATES = [
  "UNREGISTERED",
  "CONNECTING",
  "CONNECTED",
  "DISCONNECTED",
  "UNAUTHORIZED",
  "CONFIGURATION_PENDING",
  "CONFIGURATION_APPLYING",
  "CONFIGURATION_ACTIVE",
  "CONFIGURATION_REJECTED",
] as const;
export type DashboardRuntimeState = (typeof DASHBOARD_RUNTIME_STATES)[number];

/** Transport-level outcome of a single handshake attempt. */
export const HANDSHAKE_TRANSPORTS = [
  "OK",
  "UNREACHABLE",
  "UNAUTHORIZED",
  "PROTOCOL_MISMATCH",
  "NOT_REGISTERED",
] as const;
export type HandshakeTransport = (typeof HANDSHAKE_TRANSPORTS)[number];

export const HANDSHAKE_REASON: Record<HandshakeTransport, string> = {
  OK: "HSK_ACCEPTED",
  UNREACHABLE: "HSK_UNREACHABLE",
  UNAUTHORIZED: "HSK_UNAUTHORIZED",
  PROTOCOL_MISMATCH: "HSK_PROTOCOL_MISMATCH",
  NOT_REGISTERED: "HSK_NO_ENDPOINT",
};

// ---------------------------------------------------------------------------
// Registration contract
// ---------------------------------------------------------------------------

export const ENGINE_ENVIRONMENTS = ["development", "staging", "production"] as const;
export type EngineEnvironment = (typeof ENGINE_ENVIRONMENTS)[number];

/**
 * What an operator may register about an engine. Deliberately public metadata
 * only: no API tokens, wallet keys, service-role keys or trading secrets are
 * ever accepted here — bearer credentials live in the server environment.
 */
export const engineRegistrationSchema = z.object({
  name: z.string().min(1).max(80),
  environment: z.enum(ENGINE_ENVIRONMENTS),
  baseUrl: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    }, "base URL must be a valid http(s) URL"),
  apiVersion: z.string().min(1).max(40),
  engineVersion: z.string().max(40).nullable().default(null),
  platformVersion: z.string().max(40).nullable().default(null),
  healthEndpoint: z.string().min(1).max(200).startsWith("/"),
  handshakeEndpoint: z.string().min(1).max(200).startsWith("/"),
  publicIdentifier: z.string().max(120).nullable().default(null),
  syncIntervalMillis: z.number().int().min(1_000).max(120_000),
  isActive: z.boolean().default(true),
});
export type EngineRegistration = z.infer<typeof engineRegistrationSchema>;

const SECRET_PATTERN =
  /(private[_-]?key|secret|mnemonic|passphrase|service[_-]?role|api[_-]?token|bearer\s|0x[a-fA-F0-9]{40,})/i;

/**
 * Registration guard. A credential pasted into a registration field would be
 * persisted in the control plane and rendered in the browser — both forbidden.
 */
export function rejectsSecretMaterial(registration: EngineRegistration): string | null {
  const fields: [string, string | null][] = [
    ["name", registration.name],
    ["base URL", registration.baseUrl],
    ["public identifier", registration.publicIdentifier],
    ["health endpoint", registration.healthEndpoint],
    ["handshake endpoint", registration.handshakeEndpoint],
  ];
  for (const [label, value] of fields) {
    if (value && SECRET_PATTERN.test(value)) {
      return `The ${label} looks like credential material. Engine registration stores public metadata only.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handshake response contract
// ---------------------------------------------------------------------------

export const HEALTH_STATES = ["healthy", "degraded", "unavailable", "unknown"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** The subsystems the console always renders, in operator reading order. */
export const REQUIRED_HEALTH_COMPONENTS = [
  "engine",
  "feed",
  "twap",
  "scheduler",
  "decision",
  "risk",
  "execution",
  "settlement",
  "replay",
  "notifications",
  "database",
  "api",
] as const;
export type RequiredHealthComponent = (typeof REQUIRED_HEALTH_COMPONENTS)[number];

const healthEntrySchema = z.object({
  component: z.string().min(1),
  status: z.enum(HEALTH_STATES).catch("unknown"),
  detail: z.string().nullable().default(null),
  latencyMillis: z.number().nullable().default(null),
});
export type HealthEntry = z.infer<typeof healthEntrySchema>;

/**
 * `GET /authority/handshake` response. Every field beyond the engine identity
 * is optional so a partially reporting engine still completes a handshake —
 * the console shows what is missing instead of inventing placeholder values.
 */
export const handshakeResponseSchema = z.object({
  engineId: z.string().min(1),
  publicIdentifier: z.string().nullable().default(null),
  apiVersion: z.string().nullable().default(null),
  engineVersion: z.string().nullable().default(null),
  platformVersion: z.string().nullable().default(null),
  environment: z.string().nullable().default(null),
  network: z.string().nullable().default(null),
  configuration: z
    .object({
      version: z.number().int().nullable().default(null),
      configHash: z.string().nullable().default(null),
      snapshotId: z.string().nullable().default(null),
      snapshotHash: z.string().nullable().default(null),
      status: z.string().nullable().default(null),
      activatedAtIso: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  currentMarket: z
    .object({
      marketInstanceId: z.string().nullable().default(null),
      question: z.string().nullable().default(null),
      lifecycle: z.string().nullable().default(null),
      resolutionIso: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  scheduler: z
    .object({
      status: z.string().nullable().default(null),
      tickIntervalMillis: z.number().nullable().default(null),
      lastTickIso: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  feed: z
    .object({
      status: z.string().nullable().default(null),
      provider: z.string().nullable().default(null),
      twapFeed: z.string().nullable().default(null),
      lastObservationIso: z.string().nullable().default(null),
      ageMillis: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),
  health: z.array(healthEntrySchema).default([]),
  startedAtIso: z.string().nullable().default(null),
  uptimeSeconds: z.number().nullable().default(null),
  capabilities: z.array(z.string()).default([]),
});
export type HandshakeResponse = z.infer<typeof handshakeResponseSchema>;

/**
 * Normalises reported health into the full subsystem grid. Subsystems the
 * engine did not report read `unknown` — never `healthy` by omission.
 */
export function mergeHealth(reported: readonly HealthEntry[]): HealthEntry[] {
  const byName = new Map<string, HealthEntry>();
  for (const entry of reported) {
    byName.set(entry.component.trim().toLowerCase(), entry);
  }
  const merged: HealthEntry[] = REQUIRED_HEALTH_COMPONENTS.map(
    (component) =>
      byName.get(component) ?? {
        component,
        status: "unknown" as HealthState,
        detail: "Not reported by the trading authority.",
        latencyMillis: null,
      },
  );
  for (const [name, entry] of byName) {
    if (!(REQUIRED_HEALTH_COMPONENTS as readonly string[]).includes(name)) merged.push(entry);
  }
  return merged;
}

export function worstHealth(entries: readonly HealthEntry[]): HealthState {
  if (entries.some((entry) => entry.status === "unavailable")) return "unavailable";
  if (entries.some((entry) => entry.status === "degraded")) return "degraded";
  if (entries.every((entry) => entry.status === "unknown")) return "unknown";
  return "healthy";
}

// ---------------------------------------------------------------------------
// Dashboard state derivation
// ---------------------------------------------------------------------------

export interface DashboardStateInput {
  readonly registered: boolean;
  readonly transport: HandshakeTransport;
  /** A handshake is in flight and no previous result exists. */
  readonly connecting?: boolean;
  /** Status of the newest stored configuration version, when one exists. */
  readonly latestVersionStatus?: "PENDING" | "ACTIVE" | "REJECTED" | "ARCHIVED" | "SUPERSEDED" | null;
  /** True while a publish/activate dispatch is awaiting a verdict. */
  readonly applying?: boolean;
  readonly drifted?: boolean;
}

export interface DashboardStateReport {
  readonly state: DashboardRuntimeState;
  readonly reasonCode: string;
  readonly connected: boolean;
}

/**
 * Single derivation of the state the operator sees. Connectivity dominates:
 * the console never claims a configuration state it cannot currently observe.
 */
export function deriveDashboardState(input: DashboardStateInput): DashboardStateReport {
  if (!input.registered) {
    return { state: "UNREGISTERED", reasonCode: "HSK_NO_ENDPOINT", connected: false };
  }
  if (input.transport === "UNAUTHORIZED") {
    return { state: "UNAUTHORIZED", reasonCode: "HSK_UNAUTHORIZED", connected: false };
  }
  if (input.transport !== "OK") {
    if (input.connecting) {
      return { state: "CONNECTING", reasonCode: "HSK_CONNECTING", connected: false };
    }
    return {
      state: "DISCONNECTED",
      reasonCode: HANDSHAKE_REASON[input.transport],
      connected: false,
    };
  }
  if (input.applying) {
    return { state: "CONFIGURATION_APPLYING", reasonCode: "CFG_APPLYING", connected: true };
  }
  if (input.latestVersionStatus === "REJECTED") {
    return { state: "CONFIGURATION_REJECTED", reasonCode: "CFG_REJECTED", connected: true };
  }
  if (input.latestVersionStatus === "PENDING") {
    return { state: "CONFIGURATION_PENDING", reasonCode: "CFG_PENDING", connected: true };
  }
  if (input.drifted) {
    return { state: "CONNECTED", reasonCode: "CFG_RUNTIME_DRIFT", connected: true };
  }
  if (input.latestVersionStatus === "ACTIVE") {
    return { state: "CONFIGURATION_ACTIVE", reasonCode: "CFG_APPLIED", connected: true };
  }
  return { state: "CONNECTED", reasonCode: "HSK_ACCEPTED", connected: true };
}

// ---------------------------------------------------------------------------
// Runtime verification (saved vs running)
// ---------------------------------------------------------------------------

export type VerificationState = "MATCH" | "DRIFT" | "UNKNOWN";

export interface VerificationReport {
  readonly state: VerificationState;
  readonly reasons: readonly { field: string; saved: string; running: string; detail: string }[];
}

export interface ConfigurationFacts {
  readonly version: number | null;
  readonly configHash: string | null;
  readonly snapshotId?: string | null;
}

function show(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/**
 * Compares the saved active configuration against the configuration the engine
 * reports it is running. Divergence is always explained field by field and is
 * never silently reconciled: the engine remains the authority.
 */
export function verifyRuntimeConfiguration(
  saved: ConfigurationFacts | null,
  running: ConfigurationFacts | null,
): VerificationReport {
  if (!running || (running.configHash === null && running.version === null)) {
    return {
      state: "UNKNOWN",
      reasons: [
        {
          field: "runtime",
          saved: show(saved?.version === null ? null : `v${saved?.version}`),
          running: "—",
          detail: "The trading authority has not reported a running configuration.",
        },
      ],
    };
  }
  if (!saved) {
    return {
      state: "DRIFT",
      reasons: [
        {
          field: "version",
          saved: "—",
          running: show(running.version === null ? null : `v${running.version}`),
          detail: "The engine runs a configuration that has no stored active version.",
        },
      ],
    };
  }

  const reasons: { field: string; saved: string; running: string; detail: string }[] = [];
  if (saved.configHash !== running.configHash) {
    reasons.push({
      field: "configuration hash",
      saved: show(saved.configHash),
      running: show(running.configHash),
      detail: "The running configuration document differs from the stored active version.",
    });
  }
  if (saved.version !== null && running.version !== null && saved.version !== running.version) {
    reasons.push({
      field: "version",
      saved: `v${saved.version}`,
      running: `v${running.version}`,
      detail: "The engine is running a different configuration version.",
    });
  }
  if (running.snapshotId === null) {
    reasons.push({
      field: "snapshot",
      saved: show(saved.configHash),
      running: "—",
      detail: "The engine reported no runtime snapshot id for its active configuration.",
    });
  }

  return { state: reasons.length === 0 ? "MATCH" : "DRIFT", reasons };
}

/** Human uptime from seconds, without inventing a value when none is reported. */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
