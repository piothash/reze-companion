/**
 * ARC — M6.5 operational excellence tests.
 *
 * Covers environment validation, the startup gate matrix, subsystem watchdogs,
 * the secret scanner, the structured log contract and process lifecycle
 * (graceful shutdown, graceful restart, duplicate-event suppression).
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
import { Logger, MemoryTransport } from "@/core/infrastructure/logging";
import { validateStartup, STARTUP_GATES } from "@/core/platform/startup-validator";
import {
  GracefulShutdown,
  SHUTDOWN_STEPS,
  restoreAfterRestart,
  suppressDuplicateEmissions,
} from "@/core/platform/lifecycle";
import { EventEnvelopeFactory } from "@/core/contracts/event-envelope";
import { FixedClock } from "@/core/shared/time";

const VALID_ENV: Record<string, string> = {
  ARC_ENVIRONMENT: "development",
  ARC_NETWORK: "testnet",
  ARC_TWAP_PROVIDER: "provider-a",
  ARC_TWAP_WINDOW_SECONDS: "900",
  ARC_FEED_IDS: "feed-a,feed-b",
  EXECUTION_PROFILE_ID: "profile-default",
  EXECUTION_WINDOWS: "15m@0.5|size=2",
  EXECUTION_MODE: "single",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_example_key",
};

const POLICY_OPTIONS = { tickIntervalMillis: 1_000, feedStaleAfterMillis: 5_000 };

describe("environment validator", () => {
  it("rejects a missing required variable instead of defaulting it", () => {
    const { ARC_NETWORK: _omitted, ...partial } = VALID_ENV;
    const report = validateEnvironment(partial);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.key === "ARC_NETWORK")).toBe(true);
  });

  it("reports issues with a catalogued reason code", () => {
    const report = validateEnvironment({});
    expect(report.issues.length).toBeGreaterThan(0);
    for (const issue of report.issues) {
      expect(issue.reasonCode).toMatch(/^SYS_ENV_/);
    }
  });

  it("declares no silent default for business-critical execution variables", () => {
    const business = ARC_ENV_SPECS.filter(
      (spec) => spec.key.startsWith("EXECUTION_") || spec.key.startsWith("ARC_TWAP_"),
    );
    expect(business.length).toBeGreaterThan(0);
    for (const spec of business) {
      expect(spec.defaultValue).toBeUndefined();
    }
  });

  it("never echoes secret values back in the report", () => {
    const report = validateEnvironment(VALID_ENV);
    expect(JSON.stringify(report.values)).not.toContain("sb_publishable_example_key");
  });
});

describe("startup validator", () => {
  it("blocks startup when the environment is incomplete", async () => {
    const report = await validateStartup({ env: {} });
    expect(report.allowed).toBe(false);
    expect(report.reasonCode).toBe("SYSTEM_START_BLOCKED");
    expect(report.failedGates).toContain("environment-variables");
  });

  it("evaluates every declared gate exactly once, in order", async () => {
    const report = await validateStartup({ env: VALID_ENV });
    expect(report.gates.map((gate) => gate.gate)).toEqual([...STARTUP_GATES]);
  });

  it("blocks mainnet unless it is explicitly allowed", async () => {
    const report = await validateStartup({
      env: { ...VALID_ENV, ARC_NETWORK: "mainnet" },
      allowMainnet: false,
    });
    const gate = report.gates.find((entry) => entry.gate === "network-environment");
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
    expect(report.allowed).toBe(false);
  });

  it("fails the connectivity gate when the database does not answer", async () => {
    const report = await validateStartup({
      env: VALID_ENV,
      probes: { databaseConnectivity: async () => false },
    });
    const gate = report.gates.find((entry) => entry.gate === "database-connectivity");
    expect(gate?.status).toBe("failed");
  });
});

describe("watchdogs", () => {
  it("marks a subsystem silent once its heartbeat budget lapses", () => {
    const clock = new FixedClock(1_000);
    const registry = new WatchdogRegistry(defaultWatchdogPolicies(POLICY_OPTIONS), clock);
    registry.heartbeat("scheduler");
    const healthy = registry.report().subsystems.find((s) => s.subsystem === "scheduler");
    expect(healthy?.level).toBe("healthy");

    clock.advance(10 * 60_000);
    const silent = registry.report().subsystems.find((s) => s.subsystem === "scheduler");
    expect(silent?.level).toBe("critical");
    expect(registry.report().level).toBe("critical");
  });

  it("escalates to critical after repeated failures", () => {
    const registry = new WatchdogRegistry(defaultWatchdogPolicies(POLICY_OPTIONS), new FixedClock(0));
    for (let index = 0; index < 25; index += 1) {
      registry.fail("execution", "boom");
    }
    const state = registry.report().subsystems.find((s) => s.subsystem === "execution");
    expect(state?.level).toBe("critical");
  });

  it("covers every critical subsystem", () => {
    const policies = defaultWatchdogPolicies(POLICY_OPTIONS);
    expect(policies.map((policy) => policy.subsystem).sort()).toEqual(
      [...WATCHDOG_SUBSYSTEMS].sort(),
    );
  });
});

describe("secret scanner", () => {
  it("detects credential-shaped material", () => {
    const findings = scanText(
      "config.ts",
      'const key = "0x" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";',
    );
    const direct = scanText(
      "config.ts",
      "const key = 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef;",
    );
    expect(findings.length + direct.length).toBeGreaterThan(0);
  });

  it("detects a service-role key literal", () => {
    expect(scanText("bad.ts", 'const k = "sb_secret_abcdefghijklmno";').length).toBeGreaterThan(0);
  });

  it("ignores environment variable references", () => {
    expect(scanText("config.ts", 'const key = process.env["SUPABASE_URL"];')).toHaveLength(0);
  });

  it("reports a clean verdict for safe files", () => {
    expect(scanFiles([{ path: "safe.ts", content: "export const x = 1;" }]).clean).toBe(true);
  });
});

describe("log contract", () => {
  function makeLogger() {
    const transport = new MemoryTransport();
    const logger = new OperationalLogger(
      new Logger({ engine: "test", clock: new FixedClock(0), transport }),
    );
    return { logger, transport };
  }

  it("emits structured records carrying every operational identifier", () => {
    const { logger, transport } = makeLogger();
    logger.info({
      reasonCode: "SYS_CHECK_PASSED",
      message: "tick",
      context: { correlationId: "corr-1", marketInstanceId: "mkt-1" },
    });
    const record = transport.records[0];
    expect(record?.correlationId).toBe("corr-1");
    expect(record?.fields).toMatchObject({
      marketInstanceId: "mkt-1",
      windowInstanceId: null,
      executionIntentId: null,
      orderId: null,
    });
    expect(record?.reasonCode).toBe("SYS_CHECK_PASSED");
  });

  it("redacts secret-looking fields instead of logging them", () => {
    const { logger, transport } = makeLogger();
    logger.info({
      reasonCode: "SYS_CHECK_PASSED",
      context: { correlationId: "corr-2" },
      fields: { apiKey: "super-secret-value" },
    });
    expect(JSON.stringify(transport.records[0])).not.toContain("super-secret-value");
  });
});

describe("graceful shutdown", () => {
  it("runs steps in the declared order and reports clean", async () => {
    const order: string[] = [];
    const shutdown = new GracefulShutdown({ clock: new FixedClock(0) });
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
    const shutdown = new GracefulShutdown({ clock: new FixedClock(0) });
    shutdown.register({ name: "flush-logs", run: () => void (runs += 1) });
    const [first, second] = await Promise.all([
      shutdown.shutdown("SIGTERM"),
      shutdown.shutdown("SIGINT"),
    ]);
    expect(runs).toBe(1);
    expect(first).toBe(second);
  });

  it("still flushes later steps when an earlier step fails", async () => {
    const shutdown = new GracefulShutdown({ clock: new FixedClock(0) });
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
  function stream() {
    const factory = new EventEnvelopeFactory(new FixedClock(0), "decision");
    return [
      factory.create({
        type: "decision.intent.created",
        payload: { intentId: "intent-1" },
        correlationId: "corr-restart",
        source: "decision",
        reasonCode: "DEC_INTENT_CREATED",
        executionIntentId: "intent-1",
      }),
      factory.create({
        type: "decision.intent.created",
        payload: { intentId: "intent-2" },
        correlationId: "corr-restart",
        source: "decision",
        reasonCode: "DEC_INTENT_CREATED",
        executionIntentId: "intent-2",
      }),
    ];
  }

  it("restores the same context from the same stream", () => {
    const events = stream();
    const first = restoreAfterRestart(events, { clock: new FixedClock(0) });
    const second = restoreAfterRestart(events, { clock: new FixedClock(0) });
    expect(first.context.digest).toBe(second.context.digest);
    expect(first.restored).toBe(true);
    expect(first.context.resumeSequence).toBe(events[events.length - 1]!.sequence + 1);
  });

  it("suppresses business events the stream already contains", () => {
    const events = stream();
    const { guard } = restoreAfterRestart(events, { clock: new FixedClock(0) });
    const factory = new EventEnvelopeFactory(new FixedClock(0), "decision");
    const replayCandidate = factory.create({
      type: "decision.intent.created",
      payload: { intentId: "intent-1" },
      correlationId: "corr-restart",
      source: "decision",
      reasonCode: "DEC_INTENT_CREATED",
      executionIntentId: "intent-1",
    });
    const freshCandidate = factory.create({
      type: "decision.intent.created",
      payload: { intentId: "intent-9" },
      correlationId: "corr-restart",
      source: "decision",
      reasonCode: "DEC_INTENT_CREATED",
      executionIntentId: "intent-9",
    });

    const { emit, suppressed } = suppressDuplicateEmissions(
      [replayCandidate, freshCandidate],
      guard,
    );
    expect(suppressed).toHaveLength(1);
    expect(emit).toHaveLength(1);
    expect(emit[0]?.metadata.executionIntentId).toBe("intent-9");
  });
});
