import { describe, expect, it } from "vitest";

import { HealthRegistry, stalenessStatus, withTimeout, worstStatus } from "@/core/infrastructure/health";
import { Logger, MemoryTransport, redact } from "@/core/infrastructure/logging";
import { createMetricsRegistry } from "@/core/infrastructure/metrics";
import { bootstrapConfig } from "@/core/configuration/environment";
import { FixedClock } from "@/core/shared/time";

const config = bootstrapConfig({ ARC_ENVIRONMENT: "test", ARC_NETWORK: "testnet" });

function logger(clock = new FixedClock("2026-02-01T00:00:00.000Z")) {
  const transport = new MemoryTransport();
  return {
    transport,
    log: new Logger({ engine: "test", level: "debug", clock, transport }),
  };
}

describe("structured logging", () => {
  it("emits a structured record with reason code and UTC timestamp", () => {
    const { log, transport } = logger();
    log.info({ reasonCode: "INF_STARTUP", fields: { task: "boot" } });

    const record = transport.records[0];
    expect(record?.reasonCode).toBe("INF_STARTUP");
    expect(record?.engine).toBe("test");
    expect(record?.timestamp).toBe("2026-02-01T00:00:00.000Z");
    expect(record?.fields).toEqual({ task: "boot" });
  });

  it("redacts secret-shaped keys at any depth", () => {
    const redacted = redact(
      { apiKey: "abc", nested: { privateKey: "xyz", safe: 1 } },
      ["apiKey", "privateKey"],
    ) as Record<string, unknown>;
    expect(redacted["apiKey"]).toBe("[redacted]");
    expect((redacted["nested"] as Record<string, unknown>)["privateKey"]).toBe("[redacted]");
    expect((redacted["nested"] as Record<string, unknown>)["safe"]).toBe(1);
  });

  it("never writes a secret through the logger", () => {
    const { log, transport } = logger();
    log.warn({ reasonCode: "INF_STARTUP", fields: { apiKey: "super-secret" } });
    expect(JSON.stringify(transport.records)).not.toContain("super-secret");
  });

  it("suppresses records below the configured level", () => {
    const transport = new MemoryTransport();
    const log = new Logger({ engine: "test", level: "warn", transport });
    log.info({ reasonCode: "INF_STARTUP" });
    log.error({ reasonCode: "INF_SHUTDOWN" });
    expect(transport.records).toHaveLength(1);
  });

  it("propagates correlation ids to children", () => {
    const { log, transport } = logger();
    log.child({ correlationId: "corr-9" }).info({ reasonCode: "INF_STARTUP" });
    expect(transport.records[0]?.correlationId).toBe("corr-9");
  });
});

describe("metrics", () => {
  it("counts, gauges and observes with namespacing", () => {
    const metrics = createMetricsRegistry("arc", new FixedClock(0));
    metrics.increment("requests_total", { route: "health" });
    metrics.increment("requests_total", { route: "health" });
    metrics.gauge("queue_depth", 3);
    metrics.observe("latency_ms", 12);

    const names = metrics.snapshot().map((sample) => sample.name);
    expect(names).toContain("arc_requests_total");
    expect(metrics.snapshot().find((s) => s.name === "arc_requests_total")?.value).toBe(2);
    expect(names).toContain("arc_queue_depth");
    expect(names).toContain("arc_latency_ms");
  });

  it("records error outcomes when a timed operation throws", async () => {
    const metrics = createMetricsRegistry("arc", new FixedClock(0));
    await expect(
      metrics.time("op_ms", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(metrics.snapshot().some((s) => s.name.includes("errors_total"))).toBe(true);
  });

  it("renders Prometheus exposition text", () => {
    const metrics = createMetricsRegistry("arc", new FixedClock(0));
    metrics.increment("requests_total");
    expect(metrics.toPrometheus()).toContain("arc_requests_total");
  });
});

describe("health", () => {
  it("reports healthy when every dependency is healthy", async () => {
    const registry = new HealthRegistry(config.health, new FixedClock(0));
    registry.register({ name: "engine", check: async () => ({ status: "healthy", reasonCode: "HLT_HEALTHY" }) });
    const report = await registry.report();
    expect(report.status).toBe("healthy");
  });

  it("degrades on a non-critical failure and stays unhealthy on a critical one", async () => {
    const registry = new HealthRegistry(config.health, new FixedClock(0));
    registry.register({
      name: "optional",
      critical: false,
      check: async () => ({ status: "unavailable", reasonCode: "INF_DEPENDENCY_UNREACHABLE" }),
    });
    const degraded = await registry.report();
    expect(degraded.status).toBe("degraded");

    registry.register({
      name: "critical",
      critical: true,
      check: async () => {
        throw new Error("down");
      },
    });
    for (let i = 0; i < config.health.unavailableAfterFailures; i += 1) await registry.report();
    const final = await registry.report();
    expect(final.status).toBe("unavailable");
  });

  it("times out a hung check instead of hanging the report", async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toThrow();
  });

  it("classifies staleness against a budget", () => {
    expect(stalenessStatus(100, 1_000)).toBe("healthy");
    expect(stalenessStatus(5_000, 1_000)).not.toBe("healthy");
  });

  it("picks the worst status", () => {
    expect(worstStatus(["healthy", "degraded", "healthy"])).toBe("degraded");
    expect(worstStatus(["degraded", "unavailable"])).toBe("unavailable");
  });
});
