import { describe, expect, it } from "vitest";

import {
  EventEnvelopeFactory,
  InMemoryEventSink,
  compareEnvelopes,
  isValidEnvelope,
  validateEnvelope,
} from "@/core/contracts/event-envelope";
import {
  REASON_CODES,
  reasonCodesByDomain,
  REASON_DOMAINS,
  type ReasonCode,
} from "@/core/contracts/reason-codes";
import {
  assertCompatible,
  isCompatible,
  versionManifest,
  versionOf,
} from "@/core/contracts/versions";
import { FixedClock } from "@/core/shared/time";

function factory() {
  return new EventEnvelopeFactory(new FixedClock("2026-02-01T00:00:00.000Z"), "test-suite");
}

const baseInput = {
  type: "configuration.snapshot.created",
  payload: { name: "default" },
  reasonCode: "CFG_LOADED" as ReasonCode,
  source: "configuration",
  correlationId: "corr-1",
};

describe("event envelope", () => {
  it("stamps schema version, sequence and validates itself", () => {
    const events = factory();
    const first = events.create(baseInput);
    const second = events.create(baseInput);

    expect(first.schemaVersion).toBe(versionOf("eventSchema"));
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(isValidEnvelope(first)).toBe(true);
  });

  it("carries correlation and causation identifiers", () => {
    const first = factory().create({ ...baseInput, causationId: "evt-parent" });
    expect(first.metadata.correlationId).toBe("corr-1");
    expect(first.metadata.causationId).toBe("evt-parent");
  });

  it("rejects a non-canonical event type", () => {
    expect(() => factory().create({ ...baseInput, type: "Configuration Created" })).toThrow();
  });

  it("collapses duplicates on idempotency key in an append-only sink", async () => {
    const events = factory();
    const sink = new InMemoryEventSink();
    const envelope = events.create({ ...baseInput, idempotencyKey: "fixed-key" });

    await sink.append(envelope);
    await sink.append(envelope);
    expect(sink.events).toHaveLength(1);
  });

  it("orders events by timestamp then sequence", () => {
    const events = factory();
    const a = events.create(baseInput);
    const b = events.create(baseInput);
    expect(compareEnvelopes(a, b)).toBeLessThan(0);
    expect([b, a].sort(compareEnvelopes)[0]).toEqual(a);
  });

  it("refuses a malformed envelope", () => {
    expect(() => validateEnvelope({ eventId: "x" })).toThrow();
  });
});

describe("reason codes", () => {
  it("keys and codes always agree", () => {
    for (const [key, spec] of Object.entries(REASON_CODES)) {
      expect(spec.code).toBe(key);
    }
  });

  it("groups codes by domain with no empty domain", () => {
    for (const domain of REASON_DOMAINS) {
      expect(reasonCodesByDomain(domain).length).toBeGreaterThan(0);
    }
  });
});

describe("versioning", () => {
  it("accepts only the current version and its declared compatible set", () => {
    const current = versionOf("eventSchema");
    expect(isCompatible("eventSchema", current)).toBe(true);
    expect(isCompatible("eventSchema", "999.0.0")).toBe(false);
    expect(() => assertCompatible("eventSchema", "999.0.0")).toThrow();
    expect(() => assertCompatible("eventSchema", current)).not.toThrow();
  });

  it("exposes a complete manifest", () => {
    const manifest = versionManifest();
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
    for (const value of Object.values(manifest)) expect(value).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
