/**
 * ARC — M6.7 configuration synchronization tests.
 *
 * These lock the control-plane contract: the console may never claim a
 * configuration is running unless the trading authority said so.
 */
import { describe, expect, it } from "vitest";

import {
  configurationHash,
  detectConfigurationDrift,
  interpretAuthorityReply,
  validateConfigurationForDispatch,
} from "@/core/platform/configuration-sync";
import { DEFAULT_PROFILE_SEED, executionProfileSchema } from "@/core/decision/configuration";

const profile = executionProfileSchema.parse({
  executionMode: "MULTI_TRADE",
  bufferMode: DEFAULT_PROFILE_SEED.bufferMode,
  maxTrades: DEFAULT_PROFILE_SEED.windows.length,
  windows: DEFAULT_PROFILE_SEED.windows,
});

describe("configuration hashing", () => {
  it("is deterministic and order independent", () => {
    const reordered = { ...profile, windows: [...profile.windows].reverse() };
    expect(configurationHash(profile)).toBe(configurationHash(profile));
    expect(configurationHash(reordered)).toBe(configurationHash(profile));
  });

  it("changes when a buffer changes", () => {
    const mutated = {
      ...profile,
      windows: profile.windows.map((window, index) =>
        index === 0 ? { ...window, twapBuffer: window.twapBuffer + 0.01 } : window,
      ),
    };
    expect(configurationHash(mutated)).not.toBe(configurationHash(profile));
  });
});

describe("pre-dispatch validation", () => {
  it("accepts the seeded default profile", () => {
    expect(validateConfigurationForDispatch(profile).valid).toBe(true);
  });

  it("rejects duplicate offsets and unreachable quotas", () => {
    const duplicate = {
      ...profile,
      maxTrades: 99,
      windows: [
        profile.windows[0]!,
        { ...profile.windows[1]!, offset: profile.windows[0]!.offset },
      ],
    };
    const result = validateConfigurationForDispatch(duplicate);
    expect(result.valid).toBe(false);
    expect(result.issues.map((item) => item.reasonCode)).toContain("CFG_WINDOW_DUPLICATE");
    expect(result.issues.map((item) => item.reasonCode)).toContain("CFG_INVALID_QUOTA");
  });
});

describe("authority verdict interpretation", () => {
  const accepted = {
    accepted: true,
    snapshotId: "snap-1",
    version: 3,
    configHash: "cfgh_abc",
    runtimeStatus: "RUNNING" as const,
    executionProfileId: "default",
    activatedAtIso: "2026-01-01T00:00:00.000Z",
    activatedBy: null,
    engineVersion: null,
    platformVersion: null,
    reasonCode: null,
    message: null,
  };

  it("marks a version active only when the authority returns a snapshot", () => {
    expect(interpretAuthorityReply(accepted).status).toBe("ACTIVE");
    expect(interpretAuthorityReply({ ...accepted, snapshotId: null }).status).toBe("PENDING");
  });

  it("never treats an unreachable authority as success", () => {
    const outcome = interpretAuthorityReply(null, { kind: "UNREACHABLE", detail: "timeout" });
    expect(outcome.status).toBe("PENDING");
    expect(outcome.reasonCode).toBe("CFG_AUTHORITY_UNREACHABLE");
  });

  it("propagates authority rejections", () => {
    const outcome = interpretAuthorityReply({
      ...accepted,
      accepted: false,
      reasonCode: "CFG_INVALID_QUOTA",
      message: "quota unreachable",
    });
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.reasonCode).toBe("CFG_INVALID_QUOTA");
  });
});

describe("drift detection", () => {
  it("flags a hash mismatch between engine and stored active version", () => {
    const report = detectConfigurationDrift(
      { version: 2, configHash: "cfgh_a", snapshotId: "snap" },
      { version: 3, configHash: "cfgh_b" },
    );
    expect(report.drifted).toBe(true);
    expect(report.reasonCode).toBe("CFG_RUNTIME_DRIFT");
  });

  it("reports no drift when hashes agree", () => {
    expect(
      detectConfigurationDrift(
        { version: 3, configHash: "cfgh_b", snapshotId: "snap" },
        { version: 3, configHash: "cfgh_b" },
      ).drifted,
    ).toBe(false);
  });
});
