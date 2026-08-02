/**
 * ARC — canonical reason code catalog (P0/M0).
 *
 * Catalog only. No behaviour, no engine implementation. Every future engine
 * annotates its structured logs, events and health reports with a code from
 * this catalog; codes are append-only and never repurposed.
 */

export const REASON_DOMAINS = [
  "CONFIGURATION",
  "INFRASTRUCTURE",
  "SCHEDULER",
  "HEALTH",
  "DECISION",
  "RISK",
  "EXECUTION",
  "RECOVERY",
  "REPLAY",
  "MARKET",
] as const;

export type ReasonDomain = (typeof REASON_DOMAINS)[number];

export type ReasonSeverity = "info" | "warning" | "error" | "fatal";

export interface ReasonCodeSpec {
  readonly code: string;
  readonly domain: ReasonDomain;
  readonly severity: ReasonSeverity;
  readonly description: string;
}

function spec(
  code: string,
  domain: ReasonDomain,
  severity: ReasonSeverity,
  description: string,
): ReasonCodeSpec {
  return { code, domain, severity, description };
}

export const REASON_CODES = {
  // Configuration -----------------------------------------------------------
  CFG_LOADED: spec("CFG_LOADED", "CONFIGURATION", "info", "Configuration loaded and validated"),
  CFG_INVALID: spec(
    "CFG_INVALID",
    "CONFIGURATION",
    "fatal",
    "Configuration failed schema validation",
  ),
  CFG_MISSING_REQUIRED: spec(
    "CFG_MISSING_REQUIRED",
    "CONFIGURATION",
    "fatal",
    "Required configuration value absent",
  ),
  CFG_VERSION_MISMATCH: spec(
    "CFG_VERSION_MISMATCH",
    "CONFIGURATION",
    "error",
    "Configuration version incompatible with platform",
  ),
  CFG_SNAPSHOT_TAKEN: spec(
    "CFG_SNAPSHOT_TAKEN",
    "CONFIGURATION",
    "info",
    "Configuration snapshot persisted",
  ),
  CFG_PROFILE_ACTIVATED: spec(
    "CFG_PROFILE_ACTIVATED",
    "CONFIGURATION",
    "info",
    "Execution profile activated",
  ),
  CFG_FLAG_EVALUATED: spec("CFG_FLAG_EVALUATED", "CONFIGURATION", "info", "Feature flag evaluated"),

  // Infrastructure ----------------------------------------------------------
  INF_STARTUP: spec("INF_STARTUP", "INFRASTRUCTURE", "info", "Runtime foundation started"),
  INF_SHUTDOWN: spec("INF_SHUTDOWN", "INFRASTRUCTURE", "info", "Runtime foundation stopped"),
  INF_DEPENDENCY_UNREACHABLE: spec(
    "INF_DEPENDENCY_UNREACHABLE",
    "INFRASTRUCTURE",
    "error",
    "A required dependency could not be reached",
  ),
  INF_PERSISTENCE_FAILURE: spec(
    "INF_PERSISTENCE_FAILURE",
    "INFRASTRUCTURE",
    "error",
    "Persistence operation failed",
  ),
  INF_SERIALIZATION_FAILURE: spec(
    "INF_SERIALIZATION_FAILURE",
    "INFRASTRUCTURE",
    "error",
    "Payload could not be (de)serialised",
  ),
  INF_EVENT_REJECTED: spec(
    "INF_EVENT_REJECTED",
    "INFRASTRUCTURE",
    "error",
    "Event envelope failed validation",
  ),
  INF_EVENT_DUPLICATE: spec(
    "INF_EVENT_DUPLICATE",
    "INFRASTRUCTURE",
    "info",
    "Event suppressed by idempotency key",
  ),
  INF_UNAUTHORIZED: spec(
    "INF_UNAUTHORIZED",
    "INFRASTRUCTURE",
    "error",
    "Caller is not authorised for this operation",
  ),

  // Scheduler ---------------------------------------------------------------
  SCH_TASK_REGISTERED: spec(
    "SCH_TASK_REGISTERED",
    "SCHEDULER",
    "info",
    "Scheduled task registered",
  ),
  SCH_TASK_STARTED: spec("SCH_TASK_STARTED", "SCHEDULER", "info", "Scheduled task started"),
  SCH_TASK_COMPLETED: spec("SCH_TASK_COMPLETED", "SCHEDULER", "info", "Scheduled task completed"),
  SCH_TASK_FAILED: spec("SCH_TASK_FAILED", "SCHEDULER", "error", "Scheduled task threw"),
  SCH_TASK_OVERRUN: spec(
    "SCH_TASK_OVERRUN",
    "SCHEDULER",
    "warning",
    "Task exceeded its interval budget",
  ),
  SCH_CLOCK_SKEW: spec(
    "SCH_CLOCK_SKEW",
    "SCHEDULER",
    "warning",
    "Clock skew exceeds configured tolerance",
  ),

  // Health ------------------------------------------------------------------
  HLT_HEALTHY: spec("HLT_HEALTHY", "HEALTH", "info", "Component reports healthy"),
  HLT_DEGRADED: spec("HLT_DEGRADED", "HEALTH", "warning", "Component reports degraded operation"),
  HLT_UNAVAILABLE: spec("HLT_UNAVAILABLE", "HEALTH", "error", "Component is unavailable"),
  HLT_CHECK_TIMEOUT: spec(
    "HLT_CHECK_TIMEOUT",
    "HEALTH",
    "warning",
    "Health check exceeded its timeout",
  ),
  HLT_DATA_STALE: spec(
    "HLT_DATA_STALE",
    "HEALTH",
    "warning",
    "Mirrored data is older than its freshness budget",
  ),

  // Decision (catalog only — no decision logic exists in the companion) ------
  DEC_RESERVED: spec("DEC_RESERVED", "DECISION", "info", "Reserved for the VPS decision domain"),
  DEC_INPUT_UNAVAILABLE: spec(
    "DEC_INPUT_UNAVAILABLE",
    "DECISION",
    "error",
    "Decision input unavailable upstream",
  ),
  DEC_WINDOW_CLOSED: spec(
    "DEC_WINDOW_CLOSED",
    "DECISION",
    "info",
    "Execution window closed upstream",
  ),

  // Risk --------------------------------------------------------------------
  RSK_RESERVED: spec("RSK_RESERVED", "RISK", "info", "Reserved for the VPS risk domain"),
  RSK_LIMIT_BREACHED: spec("RSK_LIMIT_BREACHED", "RISK", "error", "Upstream risk limit breached"),
  RSK_QUOTA_EXHAUSTED: spec(
    "RSK_QUOTA_EXHAUSTED",
    "RISK",
    "warning",
    "Upstream trade quota exhausted",
  ),

  // Execution ---------------------------------------------------------------
  EXE_RESERVED: spec("EXE_RESERVED", "EXECUTION", "info", "Reserved for the VPS execution domain"),
  EXE_INTENT_REJECTED: spec(
    "EXE_INTENT_REJECTED",
    "EXECUTION",
    "error",
    "Execution intent rejected upstream",
  ),
  EXE_UPSTREAM_TIMEOUT: spec(
    "EXE_UPSTREAM_TIMEOUT",
    "EXECUTION",
    "error",
    "Upstream execution call timed out",
  ),

  // Recovery ----------------------------------------------------------------
  REC_RESUME: spec("REC_RESUME", "RECOVERY", "info", "Runtime resumed from persisted state"),
  REC_STATE_INCONSISTENT: spec(
    "REC_STATE_INCONSISTENT",
    "RECOVERY",
    "error",
    "Persisted state failed consistency checks",
  ),
  REC_RECONCILED: spec(
    "REC_RECONCILED",
    "RECOVERY",
    "info",
    "Companion mirror reconciled against the engine",
  ),

  // Replay ------------------------------------------------------------------
  RPL_FORMAT_UNSUPPORTED: spec(
    "RPL_FORMAT_UNSUPPORTED",
    "REPLAY",
    "error",
    "Replay format version unsupported",
  ),
  RPL_DIVERGENCE: spec(
    "RPL_DIVERGENCE",
    "REPLAY",
    "error",
    "Replay output diverged from recorded output",
  ),
  RPL_COMPLETED: spec("RPL_COMPLETED", "REPLAY", "info", "Replay run completed deterministically"),

  // State machines (infrastructure framework) -------------------------------
  FSM_TRANSITION: spec("FSM_TRANSITION", "INFRASTRUCTURE", "info", "State machine transitioned"),
  FSM_TRANSITION_REJECTED: spec(
    "FSM_TRANSITION_REJECTED",
    "INFRASTRUCTURE",
    "error",
    "State machine rejected an undeclared transition",
  ),
  FSM_DEFINITION_INVALID: spec(
    "FSM_DEFINITION_INVALID",
    "INFRASTRUCTURE",
    "fatal",
    "State machine definition failed validation",
  ),

  // Market State Domain (M1) — observation and state only, never decisions ---
  MKT_DISCOVERED: spec("MKT_DISCOVERED", "MARKET", "info", "Market discovered from venue metadata"),
  MKT_DISCOVERY_FAILED: spec(
    "MKT_DISCOVERY_FAILED",
    "MARKET",
    "error",
    "Market discovery request failed",
  ),
  MKT_METADATA_INVALID: spec(
    "MKT_METADATA_INVALID",
    "MARKET",
    "error",
    "Market metadata failed validation",
  ),
  MKT_LIFECYCLE_UPDATED: spec(
    "MKT_LIFECYCLE_UPDATED",
    "MARKET",
    "info",
    "Market lifecycle state changed",
  ),
  MKT_INVALIDATED: spec("MKT_INVALIDATED", "MARKET", "warning", "Market marked invalid"),
  MKT_OBSERVATION_RECEIVED: spec(
    "MKT_OBSERVATION_RECEIVED",
    "MARKET",
    "info",
    "Feed observation ingested",
  ),
  MKT_OBSERVATION_REJECTED: spec(
    "MKT_OBSERVATION_REJECTED",
    "MARKET",
    "warning",
    "Feed observation rejected as malformed or out of order",
  ),
  MKT_FEED_STALE: spec("MKT_FEED_STALE", "MARKET", "warning", "Feed exceeded its staleness budget"),
  MKT_FEED_UNAVAILABLE: spec(
    "MKT_FEED_UNAVAILABLE",
    "MARKET",
    "error",
    "Feed produced no usable observations",
  ),
  MKT_FEED_RECOVERED: spec("MKT_FEED_RECOVERED", "MARKET", "info", "Feed returned to fresh state"),
  MKT_TWAP_UPDATED: spec("MKT_TWAP_UPDATED", "MARKET", "info", "Running TWAP recomputed"),
  MKT_TWAP_INSUFFICIENT_DATA: spec(
    "MKT_TWAP_INSUFFICIENT_DATA",
    "MARKET",
    "warning",
    "TWAP basket does not satisfy the configured minimum",
  ),
  MKT_PTB_UPDATED: spec("MKT_PTB_UPDATED", "MARKET", "info", "Price-to-beat validated and updated"),
  MKT_PTB_UNAVAILABLE: spec(
    "MKT_PTB_UNAVAILABLE",
    "MARKET",
    "warning",
    "Price-to-beat absent or failed validation",
  ),
  MKT_SIGNAL_CONDITIONED: spec(
    "MKT_SIGNAL_CONDITIONED",
    "MARKET",
    "info",
    "Effective TWAP conditioned and published",
  ),
  MKT_SIGNAL_UNUSABLE: spec(
    "MKT_SIGNAL_UNUSABLE",
    "MARKET",
    "warning",
    "Conditioned signal unusable under current configuration",
  ),
  MKT_STATE_PUBLISHED: spec(
    "MKT_STATE_PUBLISHED",
    "MARKET",
    "info",
    "Authoritative market state snapshot published",
  ),

  // Decision Domain (M2) — TWAP-native. No majority, confidence or sentiment --
  DEC_PROFILE_RESOLVED: spec(
    "DEC_PROFILE_RESOLVED",
    "DECISION",
    "info",
    "Execution profile resolved and frozen",
  ),
  DEC_CONTEXT_CREATED: spec(
    "DEC_CONTEXT_CREATED",
    "DECISION",
    "info",
    "Execution context created for a market instance",
  ),
  DEC_WINDOW_OPENED: spec(
    "DEC_WINDOW_OPENED",
    "DECISION",
    "info",
    "Window instance created with a frozen configuration snapshot",
  ),
  DEC_WINDOW_ACTIVATED: spec(
    "DEC_WINDOW_ACTIVATED",
    "DECISION",
    "info",
    "Window instance became active",
  ),
  DEC_WINDOW_EVALUATED: spec(
    "DEC_WINDOW_EVALUATED",
    "DECISION",
    "info",
    "Window evaluated against an authoritative market state",
  ),
  DEC_WINDOW_COMPLETED: spec(
    "DEC_WINDOW_COMPLETED",
    "DECISION",
    "info",
    "Window instance completed exactly once",
  ),
  DEC_WINDOW_EXPIRED: spec(
    "DEC_WINDOW_EXPIRED",
    "DECISION",
    "warning",
    "Window expired without producing an execution intent",
  ),
  DEC_WINDOW_CANCELLED: spec(
    "DEC_WINDOW_CANCELLED",
    "DECISION",
    "warning",
    "Window cancelled before completion",
  ),
  DEC_SIGNAL_UP: spec("DEC_SIGNAL_UP", "DECISION", "info", "Decision produced BUY UP"),
  DEC_SIGNAL_DOWN: spec("DEC_SIGNAL_DOWN", "DECISION", "info", "Decision produced BUY DOWN"),
  DEC_NO_SIGNAL: spec("DEC_NO_SIGNAL", "DECISION", "info", "Decision produced NO SIGNAL"),
  DEC_INTENT_CREATED: spec(
    "DEC_INTENT_CREATED",
    "DECISION",
    "info",
    "Immutable execution intent created",
  ),
  DEC_INTENT_SUPPRESSED: spec(
    "DEC_INTENT_SUPPRESSED",
    "DECISION",
    "warning",
    "Evaluation ignored because the window already produced an intent",
  ),
  DEC_QUOTA_CONSUMED: spec(
    "DEC_QUOTA_CONSUMED",
    "DECISION",
    "info",
    "Trade quota decremented by one",
  ),
  DEC_QUOTA_DEPLETED: spec(
    "DEC_QUOTA_DEPLETED",
    "DECISION",
    "warning",
    "Trade quota exhausted; decision engine not invoked",
  ),
  DEC_STATE_UNUSABLE: spec(
    "DEC_STATE_UNUSABLE",
    "DECISION",
    "warning",
    "Authoritative market state unusable for a decision",
  ),
} as const satisfies Record<string, ReasonCodeSpec>;

export type ReasonCode = keyof typeof REASON_CODES;

export const REASON_CODE_LIST: readonly ReasonCodeSpec[] = Object.values(REASON_CODES);

export function reasonCodesByDomain(domain: ReasonDomain): readonly ReasonCodeSpec[] {
  return REASON_CODE_LIST.filter((entry) => entry.domain === domain);
}

export function isReasonCode(value: string): value is ReasonCode {
  return Object.prototype.hasOwnProperty.call(REASON_CODES, value);
}

export function reasonCode(code: ReasonCode): ReasonCodeSpec {
  return REASON_CODES[code];
}
