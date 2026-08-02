/**
 * ARC — M6.5 operational excellence tests.
 *
 * Covers the startup validator gates, environment validation, watchdogs,
 * the secret scanner, the log contract and process lifecycle (graceful
 * shutdown and restart with duplicate suppression).
 */
import { describe, expect, it } from "vitest";

import { validateEnvironment, ARC_ENV_SPECS } from "@/core/configuration/env-validator";
import {
  WatchdogRegistry,
  defaultWatchdogPolicies,
  WATCHDOG_SUBSYSTEMS,
} from "@/core/infrastructure/watchdogs";
import { scanText, scanFiles } from "@/core/infrastructure/secret-scanner";
import { OperationalLogger } from "@/core/infrastructure/log-contract";
import { validateStartup, STARTUP_GATES } from "@/core/platform/startup-validator";
import {
  GracefulShutdown,
  SHUTDOWN_STEPS,
  restoreAfterRestart,
  suppressDuplicateEmissions,
} from "@/core/platform/lifecycle";
import { createEvent } from "@/core/contracts/event-envelope";
import { fixedClock } from "@/core/shared/time";

const VALID_ENV: Record<string, string> = {
  ARC_ENVIRONMENT: "development",
  ARC_NETWORK: "testnet",
  ARC_TWAP_PROVIDER: "provider-a",
  ARC_TWAP_WINDOW_SECONDS: "900",
  ARC_FEED_IDS: "feed-a,feed-b",
  EXECUTION_PROFILE_ID: "profile-default",
  EXECUTION_WINDOWS: "15m@0.5|size=2",
  EXECUTION_MODE: "single",
  SUPABASE_ANON_KEY: "sb_publishable_test",
  SUPABASE_URL: "https://example.supabase.co",
};

describe("environment validator", () => {
  it("rejects a missing required variable instead of defaulting it", () => {
    const { ARC_NETWORK: _omitted, ...partial } = VALID_ENV;
    const result = validateEnvironment(partial);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes("ARC_NETWORK"))).toBe(true);
  });

  it("accepts a fully specified environment", () => {
    expect(validateEnvironment(VALID_ENV).valid).toBe(true);
  });

  it("declares no business default for execution variables", () => {
    const business = ARC_ENV_SPECS.filter((spec) =>
      spec.name.startsWith("EXECUTION_") || spec.name.startsWith("ARC_TWAP_"),
    );
    expect(business.length).toBeGreaterThan(0);
    for (const spec of business) {
      expect(spec.defaultValue).toBeUndefined();
    }
  });
});

describe("startup validator", () => {
  it("blocks startup when the environment is incomplete", async () => {
    const report = await validateStartup({ env: {} });
    expect(report.allowed).toBe(false);
    expect(report.reasonCode).toBe("SYSTEM_START_BLOCKED");
    expect(report.failedGates).toContain("environment-variables");
  });

  it("evaluates every declared gate exactly once", async () => {
    const report = await validateStartup({ env: VALID_ENV });
    expect(report.gates.map((gate) => gate.gate)).toEqual([...STARTUP_GATES]);
  });

  it("blocks mainnet unless it is explicitly allowed", async () => {
    const report = await validateStartup({
      env: { ...VALID_ENV, ARC_NETWORK: "mainnet" },
      allowMainnet: false,
    });
    const gate = report.gates.find((entry) => entry.gate === "network-guard");
    expect(gate?.status).toBe("failed");
    expect(report.allowed).toBe(false);
  });

  it("fails the schema gate on a version mismatch", async () => {
    const report = await validateStartup({
      env: VALID_ENV,
      probes: {
        databaseConnectivity: async () => true,
        schemaVersion: async () => ({ actual: "2020.01.0", expected: "2026.02.0" }),
      },
    });
    const gate = report.gates.find((entry) => entry.gate === "database-schema-version");
    expect(gate?.status).toBe("failed");
  });
});

describe("watchdogs", () => {
  it("marks a subsystem silent once its heartbeat interval lapses", () => {
    const clock = fixedClock(1_000);
    const registry = new WatchdogRegistry(defaultWatchdogPolicies(), clock);
    registry.heartbeat("scheduler");
    expect(registry.inspect("scheduler").status).toBe("healthy");

    clock.advance(10 * 60_000);
    expect(registry.inspect("scheduler").status).not.toBe("healthy");
    expect(registry.report().level).not.toBe("healthy");
  });

  it("escalates to critical after repeated errors", () => {
    const registry = new WatchdogRegistry(defaultWatchdogPolicies(), fixedClock(0));
    for (let index = 0; index < 25; index += 1) {
      registry.recordError("execution", "boom");
    }
    expect(registry.inspect("execution").status).toBe("critical");
  });

  it("covers every critical subsystem", () => {
    const policies = defaultWatchdogPolicies();
    expect(policies.map((policy) => policy.subsystem).sort()).toEqual([...WATCHDOG_SUBSYSTEMS].sort());
  });
});

describe("secret scanner", () => {
  it("detects credential-shaped material", () => {
    const findings = scanText("config.ts", 'const key = "sk_live_0123456789abcdefghij";');
    expect(findings.length).toBeGreaterThan(0);
  });

  it("ignores environment variable references", () => {
    expect(scanText("config.ts", 'const key = process.env["SUPABASE_URL"];')).toHaveLength(0);
  });

  it("reports a clean verdict for safe files", () => {
    const report = scanFiles([{ path: "safe.ts", content: "export const x = 1;" }]);
    expect(report.clean).toBe(true);
  });
});

describe("log contract", () => {
  it("rejects a log record without a reason code", () => {
    const records: unknown[] = [];
    const logger = new OperationalLogger({
      sink: (record) => records.push(record),
      clock: fixedClock(0),
    });
    expect(() => logger.info("no reason", {} as never)).toThrowError();
  });

  it("emits structured JSON carrying operational identifiers", () => {
    const records: Array<Record<string, unknown>> = [];
    const logger = new OperationalLogger({
      sink: (record) => records.push(record as Record<string, unknown>),
      clock: fixedClock(0),
    });
    logger.info("tick", {
      reasonCode: "SYS_CHECK_PASSED",
      correlationId: "corr-1",
      marketInstanceId: "mkt-1",
    });
    expect(records[0]).toMatchObject({
      level: "info",
      reasonCode: "SYS_CHECK_PASSED",
      correlationId: "corr-1",
      marketInstanceId: "mkt-1",
    });
  });
});

describe("graceful shutdown", () => {
  it("runs steps in the declared order and reports clean", async () => {
    const order: string[] = [];
    const shutdown = new GracefulShutdown({ clock: fixedClock(0) });
    for (const step of SHUTDOWN_STEPS) {
      shutdown.register({ name: step, run: () => void order.push(step) });
    }
    const report = await shutdown.shutdown("SIGTERM");
    expect(order).toEqual([...SHUTDOWN_STEPS]);
    expect(report.clean).toBe(true);
    expect(report.exitCode).toBe(0);
  });

  it("is idempotent under repeated signals", async () => {
    let runs = 0;
    const shutdown = new GracefulShutdown({ clock: fixedClock(0) });
    shutdown.register({ name: "flush-logs", run: () => void (runs += 1) });
    const [first, second] = await Promise.all([
      shutdown.shutdown("SIGTERM"),
      shutdown.shutdown("SIGINT"),
    ]);
    expect(runs).toBe(1);
    expect(first).toBe(second);
  });

  it("degrades but still completes when a step fails", async () => {
    const shutdown = new GracefulShutdown({ clock: fixedClock(0) });
    let flushed = false;
    shutdown.register({
      name: "flush-event-store",
      run: () => {
        throw new Error("store unreachable");
      },
    });
    shutdown.register({ name: "flush-logs", run: () => void (flushed = true) });
    const report = await shutdown.shutdown("SIGTERM");
    expect(flushed).toBe(true);
    expect(report.clean).toBe(false);
    expect(report.exitCode).toBe(1);
  });
});

describe("graceful restart", () => {
  const clock = fixedClock(0);

  function intentEvent(sequence: number, intentId: string) {
    return createEvent(
      {
        type: "trade.intent.created",
        payload: { intentId },
        metadata: {
          correlationId: "corr-restart",
          source: "trade",
          reasonCode: "EXE_INTENT_CREATED",
          executionIntentId: intentId,
        },
        sequence,
      },
      clock,
    );
  }

  it("restores context deterministically from the same stream", () => {
    const events = [intentEvent(1, "intent-1"), intentEvent(2, "intent-2")];
    const first = restoreAfterRestart(events, { clock });
    const second = restoreAfterRestart(events, { clock });
    expect(first.context.digest).toBe(second.context.digest);
    expect(first.context.resumeSequence).toBe(3);
  });

  it("suppresses business events that already exist in the stream", () => {
    const events = [intentEvent(1, "intent-1")];
    const { guard } = restoreAfterRestart(events, { clock });
    const { emit, suppressed } = suppressDuplicateEmissions(
      [intentEvent(2, "intent-1"), intentEvent(3, "intent-9")],
      guard,
    );
    expect(suppressed).toHaveLength(1);
    expect(emit).toHaveLength(1);
  });
});
