/**
 * ARC — M7.10 configuration activation state.
 *
 * Pure. Collapses the publish → pull → verdict → activate round-trip into the
 * single state the operator sees. The rule that matters: ACTIVE is only ever
 * returned when the VPS trading authority itself confirms the running hash on
 * a live read. A mirrored value, a stored "ACTIVE" row, or an optimistic
 * publish never produces ACTIVE.
 */
export const CONFIGURATION_ACTIVATION_STATES = [
  "NOT_PUBLISHED",
  "PENDING",
  "ACCEPTED",
  "ACTIVE",
  "REJECTED",
  "DRIFTED",
] as const;

export type ConfigurationActivationState = (typeof CONFIGURATION_ACTIVATION_STATES)[number];

export interface ConfigurationActivationInput {
  /** Newest stored version, whatever its status. */
  readonly latestVersion: {
    readonly version: number;
    readonly status: string;
    readonly configHash: string;
    readonly rejectionReason: string | null;
  } | null;
  /** What the authority reports, if it answered a live read. */
  readonly runtime: {
    readonly live: boolean;
    readonly runtimeStatus: string;
    readonly configHash: string | null;
    readonly snapshotId: string | null;
    readonly version: number | null;
  } | null;
  readonly drifted: boolean;
}

export interface ConfigurationActivation {
  readonly state: ConfigurationActivationState;
  readonly detail: string;
  /** True only when the authority confirmed the published hash on a live read. */
  readonly confirmedByAuthority: boolean;
}

export function deriveConfigurationActivation(
  input: ConfigurationActivationInput,
): ConfigurationActivation {
  const { latestVersion, runtime, drifted } = input;

  if (!latestVersion) {
    return {
      state: "NOT_PUBLISHED",
      detail: "No configuration version has been published yet.",
      confirmedByAuthority: false,
    };
  }

  if (latestVersion.status === "REJECTED") {
    return {
      state: "REJECTED",
      detail:
        latestVersion.rejectionReason ??
        `The authority rejected v${latestVersion.version}.`,
      confirmedByAuthority: true,
    };
  }

  if (drifted) {
    return {
      state: "DRIFTED",
      detail:
        "The authority is running a configuration that does not match the published version.",
      confirmedByAuthority: runtime?.live === true,
    };
  }

  const hashMatch =
    runtime?.configHash !== null &&
    runtime?.configHash !== undefined &&
    runtime.configHash === latestVersion.configHash;

  if (runtime?.live === true && hashMatch && runtime.snapshotId) {
    if (runtime.runtimeStatus === "LIVE") {
      return {
        state: "ACTIVE",
        detail: `The authority confirms v${runtime.version ?? latestVersion.version} is live.`,
        confirmedByAuthority: true,
      };
    }
    return {
      state: "ACCEPTED",
      detail: `The authority accepted v${latestVersion.version} and reports ${runtime.runtimeStatus}; awaiting LIVE.`,
      confirmedByAuthority: true,
    };
  }

  return {
    state: "PENDING",
    detail:
      runtime?.live === true
        ? `The authority has not yet applied v${latestVersion.version}.`
        : `v${latestVersion.version} is stored; awaiting a live read from the trading authority.`,
    confirmedByAuthority: false,
  };
}
