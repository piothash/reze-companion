/**
 * ARC — production cutover readiness (M7.5).
 *
 * Pure, isomorphic rules for the Supabase control-plane migration:
 *  - which tables the control plane requires,
 *  - which operator actions must fail closed when the active backend is not
 *    the required deployment target.
 *
 * No project URL, project reference or key is compiled in: the required
 * backend is supplied exclusively through `ARC_REQUIRED_SUPABASE_URL`.
 */

/** Operations that are refused when the backend guard is not satisfied. */
export const CUTOVER_GUARDED_ACTIONS = [
  "sign-in",
  "ownership-change",
  "configuration-publish",
  "authority-registration",
] as const;
export type CutoverGuardedAction = (typeof CUTOVER_GUARDED_ACTIONS)[number];

export interface RequiredTableSpec {
  /** Logical name used by the ARC migration checklist. */
  readonly logicalName: string;
  /** Physical table implementing it in this schema. */
  readonly physicalName: string;
  readonly purpose: string;
  /** True when the logical name differs from the physical implementation. */
  readonly aliased: boolean;
}

/**
 * The control-plane tables the companion depends on. Logical names come from
 * the migration specification; `physicalName` is the table that actually
 * implements the contract, so an existing table is never recreated blindly.
 */
export const REQUIRED_CONTROL_PLANE_TABLES: readonly RequiredTableSpec[] = [
  {
    logicalName: "operator_ownership",
    physicalName: "operator_ownership",
    purpose: "Single-operator ownership record and finalization flag.",
    aliased: false,
  },
  {
    logicalName: "configuration_versions",
    physicalName: "configuration_versions",
    purpose: "Immutable operator configuration versions.",
    aliased: false,
  },
  {
    logicalName: "audit_log",
    physicalName: "audit_log",
    purpose: "Append-only operator action trail.",
    aliased: false,
  },
  {
    logicalName: "operator_sessions",
    physicalName: "user_roles",
    purpose:
      "Operator identity and capabilities. Session material itself is owned by the auth service (auth.sessions) and is never mirrored into the public schema.",
    aliased: true,
  },
  {
    logicalName: "authority_registry",
    physicalName: "authority_registry",
    purpose: "Public identity of registered VPS trading authorities.",
    aliased: false,
  },
  {
    logicalName: "configuration_dispatch",
    physicalName: "configuration_versions",
    purpose:
      "Dispatch verdicts (status, reason code, correlation id, applied_at) are recorded on the immutable version rows rather than in a second, divergent table.",
    aliased: true,
  },
  {
    logicalName: "runtime_mirrors",
    physicalName: "runtime_configuration_state",
    purpose: "Read-only mirror of the configuration the VPS reports as running.",
    aliased: true,
  },
] as const;

export type TableReadiness = "PRESENT" | "SATISFIED" | "MISSING";

export interface TableReadinessRow {
  readonly logicalName: string;
  readonly physicalName: string;
  readonly purpose: string;
  readonly readiness: TableReadiness;
}

export interface MigrationReadinessReport {
  readonly rows: readonly TableReadinessRow[];
  readonly missing: readonly string[];
  /** True when every required contract is satisfied by an existing table. */
  readonly ready: boolean;
  readonly detail: string;
}

/** Evaluates the checklist against the tables actually present in the schema. */
export function evaluateMigrationReadiness(
  presentTables: readonly string[],
): MigrationReadinessReport {
  const present = new Set(presentTables);
  const rows = REQUIRED_CONTROL_PLANE_TABLES.map<TableReadinessRow>((spec) => ({
    logicalName: spec.logicalName,
    physicalName: spec.physicalName,
    purpose: spec.purpose,
    readiness: !present.has(spec.physicalName)
      ? "MISSING"
      : spec.aliased
        ? "SATISFIED"
        : "PRESENT",
  }));
  const missing = rows.filter((row) => row.readiness === "MISSING").map((row) => row.logicalName);
  return {
    rows,
    missing,
    ready: missing.length === 0,
    detail:
      missing.length === 0
        ? "All required control-plane tables are present."
        : `Migration required: ${missing.join(", ")}.`,
  };
}

/** Human-readable reason used when an action is refused by the guard. */
export function cutoverBlockedMessage(action: CutoverGuardedAction): string {
  return `Blocked: the companion is not connected to the required control-plane backend (ARC_REQUIRED_SUPABASE_URL). ${action} is disabled until the cutover target matches.`;
}
