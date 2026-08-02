import { describe, expect, it } from "vitest";

import { FixedClock, SystemClock, fromIsoUtc, measureClockSkew, orderingKey, toIsoUtc } from "@/core/shared/time";
import { Ids, deterministicId, digest128, isId, parseId } from "@/core/shared/ids";

describe("time foundation", () => {
  it("emits UTC ISO-8601 with millisecond precision", () => {
    const clock = new FixedClock(fromIsoUtc("2026-01-02T03:04:05.678Z"));
    expect(clock.isoNow()).toBe("2026-01-02T03:04:05.678Z");
    expect(toIsoUtc(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("advances deterministically and keeps monotonic time ordered", () => {
    const clock = new FixedClock(1_000);
    const first = clock.monotonic();
    clock.advance(250);
    expect(clock.now()).toBe(1_250);
    expect(clock.monotonic()).toBeGreaterThan(first);
  });

  it("never lets the system monotonic clock go backwards", () => {
    const clock = new SystemClock();
    const samples = Array.from({ length: 50 }, () => clock.monotonic());
    const sorted = [...samples].sort((a, b) => a - b);
    expect(samples).toEqual(sorted);
  });

  it("measures skew against tolerance without correcting it", () => {
    const withinTolerance = measureClockSkew(1_000, 1_400, 500);
    const outside = measureClockSkew(1_000, 2_000, 500);
    expect(withinTolerance.withinTolerance).toBe(true);
    expect(outside.withinTolerance).toBe(false);
    expect(outside.offsetMillis).toBe(1_000);
  });

  it("produces lexicographically sortable ordering keys", () => {
    const keys = [orderingKey(2, 0), orderingKey(1, 9), orderingKey(1, 10)];
    expect([...keys].sort()).toEqual([orderingKey(1, 9), orderingKey(1, 10), orderingKey(2, 0)]);
  });

  it("rejects non-UTC and malformed timestamps", () => {
    expect(() => fromIsoUtc("2026-01-02T03:04:05.678+02:00")).toThrow();
    expect(() => fromIsoUtc("not-a-date")).toThrow();
  });
});

describe("domain identifiers", () => {
  it("is deterministic for identical inputs", () => {
    expect(deterministicId("order", "a", "b")).toBe(deterministicId("order", "a", "b"));
    expect(deterministicId("order", "a", "b")).not.toBe(deterministicId("order", "a", "c"));
  });

  it("separates parts so concatenation cannot collide", () => {
    expect(digest128("ab|c")).not.toBe(digest128("a|bc"));
    expect(deterministicId("order", "ab", "c")).not.toBe(deterministicId("order", "a", "bc"));
  });

  it("prefixes every identifier kind and validates round-trip", () => {
    const id = Ids.order("market-1", "intent-1");
    expect(id.startsWith("ord_")).toBe(true);
    expect(isId("order", id)).toBe(true);
    expect(isId("event", id)).toBe(false);
    expect(parseId("order", id)).toBe(id);
    expect(() => parseId("event", id)).toThrow();
  });

  it("keeps identifier kinds mutually distinct for the same input", () => {
    expect(Ids.order("x")).not.toBe(Ids.event("x"));
  });
});
