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
  "PLATFORM",
  "LEDGER",
  "ANALYTICS",
  "NOTIFICATION",
  "AUDIT",
  "SYNCHRONIZATION",
  "STARTUP",
  "WATCHDOG",
  "SECURITY",
  "LIFECYCLE",
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

  // Configuration synchronization (M6.7) ------------------------------------
  CFG_VERSION_CREATED: spec(
    "CFG_VERSION_CREATED",
    "CONFIGURATION",
    "info",
    "Immutable configuration version created",
  ),
  CFG_CHANGED: spec(
    "CFG_CHANGED",
    "CONFIGURATION",
    "info",
    "Operator configuration change dispatched to the trading authority",
  ),
  CFG_VALIDATED: spec(
    "CFG_VALIDATED",
    "CONFIGURATION",
    "info",
    "Configuration accepted by the trading authority validator",
  ),
  CFG_APPLIED: spec(
    "CFG_APPLIED",
    "CONFIGURATION",
    "info",
    "Configuration applied to the runtime engine",
  ),
  CFG_REJECTED: spec(
    "CFG_REJECTED",
    "CONFIGURATION",
    "error",
    "Configuration rejected by the trading authority",
  ),
  CFG_ARCHIVED: spec("CFG_ARCHIVED", "CONFIGURATION", "info", "Configuration version archived"),
  CFG_ROLLED_BACK: spec(
    "CFG_ROLLED_BACK",
    "CONFIGURATION",
    "warning",
    "Runtime configuration rolled back to a previous version",
  ),
  CFG_APPLY_FAILED: spec(
    "CFG_APPLY_FAILED",
    "CONFIGURATION",
    "error",
    "Configuration dispatch to the trading authority failed",
  ),
  CFG_AUTHORITY_UNREACHABLE: spec(
    "CFG_AUTHORITY_UNREACHABLE",
    "CONFIGURATION",
    "error",
    "Trading authority endpoint unreachable — configuration remains pending",
  ),
  CFG_AUTHORITY_UNREGISTERED: spec(
    "CFG_AUTHORITY_UNREGISTERED",
    "CONFIGURATION",
    "warning",
    "No trading authority endpoint registered — configuration remains pending",
  ),
  CFG_PROFILE_EMPTY: spec(
    "CFG_PROFILE_EMPTY",
    "CONFIGURATION",
    "error",
    "Profile contains no enabled window definitions",
  ),
  CFG_PROFILE_NOT_FOUND: spec(
    "CFG_PROFILE_NOT_FOUND",
    "CONFIGURATION",
    "error",
    "Requested configuration version does not exist",
  ),
  CFG_WINDOW_DUPLICATE: spec(
    "CFG_WINDOW_DUPLICATE",
    "CONFIGURATION",
    "error",
    "Duplicate window offset in profile",
  ),
  CFG_INVALID_BUFFER: spec(
    "CFG_INVALID_BUFFER",
    "CONFIGURATION",
    "error",
    "Window TWAP buffer is invalid",
  ),
  CFG_INVALID_TIMEOUT: spec(
    "CFG_INVALID_TIMEOUT",
    "CONFIGURATION",
    "error",
    "Order timeout is invalid",
  ),
  CFG_INVALID_QUOTA: spec(
    "CFG_INVALID_QUOTA",
    "CONFIGURATION",
    "error",
    "Trades per market cannot be satisfied by the enabled windows",
  ),
  CFG_RUNTIME_DRIFT: spec(
    "CFG_RUNTIME_DRIFT",
    "CONFIGURATION",
    "warning",
    "Runtime configuration differs from the latest active version",
  ),
  CFG_RUNTIME_SYNCED: spec(
    "CFG_RUNTIME_SYNCED",
    "CONFIGURATION",
    "info",
    "Active runtime configuration read back from the trading authority",
  ),
  CFG_PENDING: spec(
    "CFG_PENDING",
    "CONFIGURATION",
    "warning",
    "Configuration version stored but not yet running on the trading authority",
  ),
  CFG_APPLYING: spec(
    "CFG_APPLYING",
    "CONFIGURATION",
    "info",
    "Configuration dispatch in flight — awaiting the authority verdict",
  ),

  // Runtime handshake (M6.8) -----------------------------------------------
  HSK_ACCEPTED: spec(
    "HSK_ACCEPTED",
    "SYNCHRONIZATION",
    "info",
    "Runtime handshake accepted by the trading authority",
  ),
  HSK_CONNECTING: spec(
    "HSK_CONNECTING",
    "SYNCHRONIZATION",
    "info",
    "Runtime handshake in progress",
  ),
  HSK_UNREACHABLE: spec(
    "HSK_UNREACHABLE",
    "SYNCHRONIZATION",
    "error",
    "Trading authority did not answer the runtime handshake",
  ),
  HSK_UNAUTHORIZED: spec(
    "HSK_UNAUTHORIZED",
    "SYNCHRONIZATION",
    "error",
    "Trading authority rejected the companion credential",
  ),
  HSK_PROTOCOL_MISMATCH: spec(
    "HSK_PROTOCOL_MISMATCH",
    "SYNCHRONIZATION",
    "error",
    "Handshake response did not match the canonical contract",
  ),
  HSK_NO_ENDPOINT: spec(
    "HSK_NO_ENDPOINT",
    "SYNCHRONIZATION",
    "warning",
    "No trading engine is registered for this control plane",
  ),
  HSK_UNKNOWN: spec(
    "HSK_UNKNOWN",
    "SYNCHRONIZATION",
    "warning",
    "Runtime handshake has not been attempted yet",
  ),


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
  REC_DUPLICATE_SUPPRESSED: spec(
    "REC_DUPLICATE_SUPPRESSED",
    "RECOVERY",
    "info",
    "Duplicate emission suppressed by the recovery idempotency guard",
  ),
  REC_QUOTA_RESTORED: spec(
    "REC_QUOTA_RESTORED",
    "RECOVERY",
    "info",
    "Trade quota restored from the canonical event stream",
  ),
  REC_EXPOSURE_RESTORED: spec(
    "REC_EXPOSURE_RESTORED",
    "RECOVERY",
    "info",
    "Exposure reservations restored from the canonical event stream",
  ),
  REC_WINDOWS_RESTORED: spec(
    "REC_WINDOWS_RESTORED",
    "RECOVERY",
    "info",
    "Active execution windows restored from the canonical event stream",
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

  // Trade Domain (M3) — Risk ------------------------------------------------
  RSK_APPROVED: spec("RSK_APPROVED", "RISK", "info", "Risk engine approved an execution intent"),
  RSK_DENIED_KILL_SWITCH: spec(
    "RSK_DENIED_KILL_SWITCH",
    "RISK",
    "error",
    "Kill switch engaged; execution denied",
  ),
  RSK_DENIED_MARKET_INVALID: spec(
    "RSK_DENIED_MARKET_INVALID",
    "RISK",
    "error",
    "Market instance is not valid or not tradable; execution denied",
  ),
  RSK_DENIED_FEED_STALE: spec(
    "RSK_DENIED_FEED_STALE",
    "RISK",
    "error",
    "Feed freshness below policy; execution denied",
  ),
  RSK_DENIED_EXPOSURE: spec(
    "RSK_DENIED_EXPOSURE",
    "RISK",
    "error",
    "Reserved plus live exposure would exceed the configured limit",
  ),
  RSK_DENIED_POSITION_LIMIT: spec(
    "RSK_DENIED_POSITION_LIMIT",
    "RISK",
    "error",
    "Per-market or per-side position limit would be exceeded",
  ),
  RSK_DENIED_LIQUIDITY: spec(
    "RSK_DENIED_LIQUIDITY",
    "RISK",
    "error",
    "Book liquidity or spread outside configured policy; execution denied",
  ),
  RSK_DENIED_POLICY: spec(
    "RSK_DENIED_POLICY",
    "RISK",
    "error",
    "A configured risk policy denied the execution intent",
  ),
  RSK_EXPOSURE_RESERVED: spec(
    "RSK_EXPOSURE_RESERVED",
    "RISK",
    "info",
    "Exposure reserved for an execution intent",
  ),
  RSK_EXPOSURE_RELEASED: spec(
    "RSK_EXPOSURE_RELEASED",
    "RISK",
    "info",
    "Exposure reservation released without becoming live exposure",
  ),
  RSK_EXPOSURE_COMMITTED: spec(
    "RSK_EXPOSURE_COMMITTED",
    "RISK",
    "info",
    "Reserved exposure converted into live exposure on fill",
  ),

  // Trade Domain (M3) — Execution / orders ----------------------------------
  EXE_ORDER_CREATED: spec("EXE_ORDER_CREATED", "EXECUTION", "info", "Order created in the FSM"),
  EXE_ORDER_SUBMITTED: spec(
    "EXE_ORDER_SUBMITTED",
    "EXECUTION",
    "info",
    "Order submitted to the venue gateway",
  ),
  EXE_ORDER_WORKING: spec(
    "EXE_ORDER_WORKING",
    "EXECUTION",
    "info",
    "Order acknowledged and resting on the book",
  ),
  EXE_ORDER_UPDATED: spec(
    "EXE_ORDER_UPDATED",
    "EXECUTION",
    "info",
    "Order state or quantities updated",
  ),
  EXE_ORDER_PARTIALLY_FILLED: spec(
    "EXE_ORDER_PARTIALLY_FILLED",
    "EXECUTION",
    "info",
    "Order partially filled",
  ),
  EXE_ORDER_FILLED: spec("EXE_ORDER_FILLED", "EXECUTION", "info", "Order completely filled"),
  EXE_ORDER_CANCELLED: spec("EXE_ORDER_CANCELLED", "EXECUTION", "info", "Order cancelled"),
  EXE_ORDER_REJECTED: spec(
    "EXE_ORDER_REJECTED",
    "EXECUTION",
    "error",
    "Order rejected by the venue gateway",
  ),
  EXE_ORDER_EXPIRED: spec(
    "EXE_ORDER_EXPIRED",
    "EXECUTION",
    "warning",
    "Order expired before being filled",
  ),
  EXE_ORDER_REPRICED: spec(
    "EXE_ORDER_REPRICED",
    "EXECUTION",
    "info",
    "Standing order repriced through cancel/replace",
  ),
  EXE_REPRICE_EXHAUSTED: spec(
    "EXE_REPRICE_EXHAUSTED",
    "EXECUTION",
    "warning",
    "Maximum reprice attempts reached",
  ),
  EXE_RETRY_SCHEDULED: spec(
    "EXE_RETRY_SCHEDULED",
    "EXECUTION",
    "warning",
    "Execution attempt failed; retry scheduled",
  ),
  EXE_RETRY_EXHAUSTED: spec(
    "EXE_RETRY_EXHAUSTED",
    "EXECUTION",
    "error",
    "Retry budget exhausted for an execution intent",
  ),
  EXE_IOC_FALLBACK: spec(
    "EXE_IOC_FALLBACK",
    "EXECUTION",
    "warning",
    "Passive maker attempt abandoned; IOC fallback engaged",
  ),
  EXE_QUOTA_COMMITTED: spec(
    "EXE_QUOTA_COMMITTED",
    "EXECUTION",
    "info",
    "Trade quota consumed once at the first meaningful cumulative fill",
  ),
  EXE_SETTLEMENT_HOOK: spec(
    "EXE_SETTLEMENT_HOOK",
    "EXECUTION",
    "info",
    "Settlement hook notified of a terminal execution",
  ),
  EXE_COMPLETED: spec(
    "EXE_COMPLETED",
    "EXECUTION",
    "info",
    "Execution completed for an execution intent",
  ),
  EXE_FAILED: spec(
    "EXE_FAILED",
    "EXECUTION",
    "error",
    "Execution failed for an execution intent; reservations released",
  ),
  EXE_DUPLICATE_SUPPRESSED: spec(
    "EXE_DUPLICATE_SUPPRESSED",
    "EXECUTION",
    "warning",
    "Duplicate execution for an already-known execution intent suppressed",
  ),
  EXE_RECOVERED: spec(
    "EXE_RECOVERED",
    "RECOVERY",
    "info",
    "Execution state rebuilt from a persisted snapshot after restart",
  ),

  // Platform services (M4) --------------------------------------------------
  EVT_APPENDED: spec("EVT_APPENDED", "PLATFORM", "info", "Event appended to the append-only store"),
  EVT_DUPLICATE_SUPPRESSED: spec(
    "EVT_DUPLICATE_SUPPRESSED",
    "PLATFORM",
    "info",
    "Duplicate event suppressed by idempotency key",
  ),
  EVT_RETROACTIVE_REJECTED: spec(
    "EVT_RETROACTIVE_REJECTED",
    "PLATFORM",
    "error",
    "Retroactive event insertion rejected by the append-only store",
  ),
  EVT_MUTATION_REJECTED: spec(
    "EVT_MUTATION_REJECTED",
    "PLATFORM",
    "error",
    "Attempt to mutate or delete a stored event rejected",
  ),
  EVT_INVALID: spec("EVT_INVALID", "PLATFORM", "error", "Event failed envelope validation"),
  EVT_STREAM_READ: spec("EVT_STREAM_READ", "PLATFORM", "info", "Event stream read"),
  PLT_TRADE_SETTLED: spec("PLT_TRADE_SETTLED", "PLATFORM", "info", "Trade settlement recorded"),
  PLT_SCHEDULER_TICK: spec("PLT_SCHEDULER_TICK", "PLATFORM", "info", "Scheduler tick observed"),
  PLT_HEALTH_CHANGED: spec("PLT_HEALTH_CHANGED", "PLATFORM", "info", "Health status changed"),
  PLT_FEED_CONNECTED: spec("PLT_FEED_CONNECTED", "PLATFORM", "info", "Feed connection established"),
  PLT_FEED_DISCONNECTED: spec(
    "PLT_FEED_DISCONNECTED",
    "PLATFORM",
    "warning",
    "Feed connection lost",
  ),
  PLT_WINDOW_CLOSED: spec("PLT_WINDOW_CLOSED", "PLATFORM", "info", "Execution window closed"),
  PLT_API_READ: spec("PLT_API_READ", "PLATFORM", "info", "Read-only platform API served"),

  // Ledger ------------------------------------------------------------------
  LDG_RECORDED: spec("LDG_RECORDED", "LEDGER", "info", "Ledger record written"),
  LDG_RECONSTRUCTED: spec(
    "LDG_RECONSTRUCTED",
    "LEDGER",
    "info",
    "Ledger reconstructed from business events",
  ),
  LDG_OPERATIONAL_REJECTED: spec(
    "LDG_OPERATIONAL_REJECTED",
    "LEDGER",
    "error",
    "Operational event rejected by the ledger",
  ),
  LDG_INCONSISTENT: spec(
    "LDG_INCONSISTENT",
    "LEDGER",
    "error",
    "Ledger reconstruction produced inconsistent totals",
  ),

  // Replay (M4 additions) ---------------------------------------------------
  RPL_STARTED: spec("RPL_STARTED", "REPLAY", "info", "Replay run started"),
  RPL_ORDERING_VIOLATION: spec(
    "RPL_ORDERING_VIOLATION",
    "REPLAY",
    "error",
    "Replay detected an event ordering violation",
  ),
  RPL_VERSION_REGRESSION: spec(
    "RPL_VERSION_REGRESSION",
    "REPLAY",
    "error",
    "Replay detected a market state version regression",
  ),
  RPL_TRANSITION_INVALID: spec(
    "RPL_TRANSITION_INVALID",
    "REPLAY",
    "error",
    "Replay detected an illegal FSM transition",
  ),
  RPL_QUOTA_REGRESSION: spec(
    "RPL_QUOTA_REGRESSION",
    "REPLAY",
    "error",
    "Replay detected non-monotonic trade quota progression",
  ),
  RPL_CORRELATION_MISSING: spec(
    "RPL_CORRELATION_MISSING",
    "REPLAY",
    "error",
    "Replay detected an event without a usable correlation id",
  ),
  RPL_UNKNOWN_EXECUTION: spec(
    "RPL_UNKNOWN_EXECUTION",
    "REPLAY",
    "error",
    "Replay observed an execution id that was never created",
  ),

  // Analytics ---------------------------------------------------------------
  ANL_COMPUTED: spec("ANL_COMPUTED", "ANALYTICS", "info", "Analytics summary computed from events"),
  ANL_INSUFFICIENT_DATA: spec(
    "ANL_INSUFFICIENT_DATA",
    "ANALYTICS",
    "warning",
    "Analytics metric undefined for the observed event window",
  ),

  // Notifications -----------------------------------------------------------
  NTF_RAISED: spec(
    "NTF_RAISED",
    "NOTIFICATION",
    "info",
    "Notification raised from a canonical event",
  ),
  NTF_SUPPRESSED: spec(
    "NTF_SUPPRESSED",
    "NOTIFICATION",
    "info",
    "Notification suppressed by deduplication or category filter",
  ),
  NTF_DELIVERY_FAILED: spec(
    "NTF_DELIVERY_FAILED",
    "NOTIFICATION",
    "warning",
    "Notification channel failed to accept a notification",
  ),

  // Audit -------------------------------------------------------------------
  AUD_RECORDED: spec("AUD_RECORDED", "AUDIT", "info", "Audit record written"),
  AUD_WRITE_FAILED: spec("AUD_WRITE_FAILED", "AUDIT", "error", "Audit record could not be written"),

  // Synchronization ---------------------------------------------------------
  SYN_STARTED: spec("SYN_STARTED", "SYNCHRONIZATION", "info", "Synchronization batch started"),
  SYN_COMPLETED: spec(
    "SYN_COMPLETED",
    "SYNCHRONIZATION",
    "info",
    "Synchronization batch completed",
  ),
  SYN_SKIPPED_RUNTIME_STATE: spec(
    "SYN_SKIPPED_RUNTIME_STATE",
    "SYNCHRONIZATION",
    "info",
    "Runtime-only state excluded from synchronization by policy",
  ),
  SYN_FAILED: spec("SYN_FAILED", "SYNCHRONIZATION", "error", "Synchronization batch failed"),

  // Startup (M6.5) ----------------------------------------------------------
  SYS_START_VALIDATING: spec(
    "SYS_START_VALIDATING",
    "STARTUP",
    "info",
    "Startup validation sequence began",
  ),
  SYS_START_OK: spec("SYS_START_OK", "STARTUP", "info", "Startup validation passed"),
  SYS_START_BLOCKED: spec(
    "SYS_START_BLOCKED",
    "STARTUP",
    "fatal",
    "Startup blocked — one or more startup gates failed",
  ),
  SYS_CHECK_PASSED: spec("SYS_CHECK_PASSED", "STARTUP", "info", "Startup gate passed"),
  SYS_CHECK_WARNING: spec(
    "SYS_CHECK_WARNING",
    "STARTUP",
    "warning",
    "Startup gate passed with warnings",
  ),
  SYS_CHECK_FAILED: spec("SYS_CHECK_FAILED", "STARTUP", "error", "Startup gate failed"),
  SYS_CHECK_SKIPPED: spec(
    "SYS_CHECK_SKIPPED",
    "STARTUP",
    "info",
    "Startup gate skipped — no probe supplied",
  ),
  SYS_ENV_INVALID: spec(
    "SYS_ENV_INVALID",
    "STARTUP",
    "fatal",
    "Environment variable failed type, enum, range, url or secret validation",
  ),
  SYS_ENV_MISSING: spec(
    "SYS_ENV_MISSING",
    "STARTUP",
    "fatal",
    "Required environment variable is absent — no silent default is applied",
  ),
  SYS_ENV_SILENT_DEFAULT: spec(
    "SYS_ENV_SILENT_DEFAULT",
    "STARTUP",
    "warning",
    "Environment variable absent and a documented default was substituted",
  ),
  SYS_SCHEMA_VERSION_MISMATCH: spec(
    "SYS_SCHEMA_VERSION_MISMATCH",
    "STARTUP",
    "fatal",
    "Database schema version does not match the expected version",
  ),
  SYS_BOOT_CONFIG_INVALID: spec(
    "SYS_BOOT_CONFIG_INVALID",
    "STARTUP",
    "fatal",
    "Business configuration failed boot validation",
  ),

  // Watchdogs (M6.5) --------------------------------------------------------
  WDG_REGISTERED: spec("WDG_REGISTERED", "WATCHDOG", "info", "Subsystem watchdog registered"),
  WDG_HEARTBEAT: spec("WDG_HEARTBEAT", "WATCHDOG", "info", "Subsystem heartbeat recorded"),
  WDG_HEALTHY: spec("WDG_HEALTHY", "WATCHDOG", "info", "Subsystem watchdog healthy"),
  WDG_WARNING: spec("WDG_WARNING", "WATCHDOG", "warning", "Subsystem watchdog in warning state"),
  WDG_CRITICAL: spec("WDG_CRITICAL", "WATCHDOG", "error", "Subsystem watchdog in critical state"),
  WDG_SILENT: spec(
    "WDG_SILENT",
    "WATCHDOG",
    "error",
    "Subsystem produced no heartbeat within its budget",
  ),

  // Security (M6.5) ---------------------------------------------------------
  SEC_SCAN_CLEAN: spec("SEC_SCAN_CLEAN", "SECURITY", "info", "Secret scan found no material"),
  SEC_SECRET_DETECTED: spec(
    "SEC_SECRET_DETECTED",
    "SECURITY",
    "fatal",
    "Candidate secret material detected in source",
  ),
  SEC_SCAN_FAILED: spec("SEC_SCAN_FAILED", "SECURITY", "error", "Secret scan could not complete"),

  // Lifecycle (M6.5) --------------------------------------------------------
  LIF_SHUTDOWN_REQUESTED: spec(
    "LIF_SHUTDOWN_REQUESTED",
    "LIFECYCLE",
    "info",
    "Graceful shutdown requested",
  ),
  LIF_STEP_COMPLETED: spec(
    "LIF_STEP_COMPLETED",
    "LIFECYCLE",
    "info",
    "Shutdown step completed cleanly",
  ),
  LIF_STEP_FAILED: spec("LIF_STEP_FAILED", "LIFECYCLE", "error", "Shutdown step failed"),
  LIF_STEP_TIMEOUT: spec("LIF_STEP_TIMEOUT", "LIFECYCLE", "error", "Shutdown step exceeded budget"),
  LIF_SHUTDOWN_COMPLETED: spec(
    "LIF_SHUTDOWN_COMPLETED",
    "LIFECYCLE",
    "info",
    "Graceful shutdown completed — process may exit",
  ),
  LIF_SHUTDOWN_DEGRADED: spec(
    "LIF_SHUTDOWN_DEGRADED",
    "LIFECYCLE",
    "warning",
    "Shutdown completed with failed steps",
  ),
  LIF_RESTORE_STARTED: spec(
    "LIF_RESTORE_STARTED",
    "LIFECYCLE",
    "info",
    "Restart restore sequence started",
  ),
  LIF_RESTORE_COMPLETED: spec(
    "LIF_RESTORE_COMPLETED",
    "LIFECYCLE",
    "info",
    "Restart restore sequence completed",
  ),
  LIF_RESTORE_FAILED: spec(
    "LIF_RESTORE_FAILED",
    "LIFECYCLE",
    "error",
    "Restart restore sequence failed",
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
