import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"

// Phase 1 · Stage 1B — verify the tracer's ENABLED code path.
//
// The module reads `process.env.P4_DIAG_DIRECTION` once at import time, so we
// isolate this suite: set the env var, `vi.resetModules()`, then dynamic-
// import to get a fresh, ENABLED copy. The disabled-path assertions live in
// `direction-trace.test.ts`; keeping the two suites separate prevents the
// module-scope ENABLED constant from bleeding between tests.

const PREV = process.env.P4_DIAG_DIRECTION

async function loadEnabled() {
  process.env.P4_DIAG_DIRECTION = "1"
  vi.resetModules()
  // Silence the events sink so tests don't spam stdout with dtrace lines.
  vi.doMock("../../lib/v2/engine/events", () => ({ logEvent: () => {} }))
  const mod = await import("../../lib/v2/engine/diag/direction-trace")
  mod._resetForTests()
  return mod
}

afterAll(() => {
  if (PREV === undefined) delete process.env.P4_DIAG_DIRECTION
  else process.env.P4_DIAG_DIRECTION = PREV
  vi.doUnmock("../../lib/v2/engine/events")
})

describe("diag/direction-trace (enabled)", () => {
  beforeEach(async () => {
    const mod = await loadEnabled()
    mod._resetForTests()
  })

  it("records hops in insertion order under a shared traceId", async () => {
    const mod = await loadEnabled()
    const id = mod.newTraceId()
    mod.trace(id, "slo-trigger", { step: 1 })
    mod.trace(id, "slo-direction-lock", { step: 2 })
    mod.trace(id, "slo-fill", { step: 3 })
    const recs = mod.getRecentTraces()
    expect(recs.map((r) => r.hop)).toEqual(["slo-trigger", "slo-direction-lock", "slo-fill"])
    expect(recs.every((r) => r.traceId === id)).toBe(true)
    // Monotonic timestamps.
    for (let i = 1; i < recs.length; i++) expect(recs[i]!.ts).toBeGreaterThanOrEqual(recs[i - 1]!.ts)
  })

  it("null / undefined traceId collapses to '-' rather than throwing", async () => {
    const mod = await loadEnabled()
    mod.trace(null, "recovery", { a: 1 })
    mod.trace(undefined, "recovery", { a: 2 })
    const recs = mod.getRecentTraces()
    expect(recs).toHaveLength(2)
    expect(recs.every((r) => r.traceId === "-")).toBe(true)
  })

  it("ring buffer caps at 1024 entries and preserves the tail (FIFO eviction)", async () => {
    const mod = await loadEnabled()
    for (let i = 0; i < 1100; i++) mod.trace("t", "engine-fill", { i })
    const recs = mod.getRecentTraces(2000)
    expect(recs).toHaveLength(1024)
    // First surviving entry must be the (1100 - 1024) = 76th write.
    expect((recs[0]!.payload as { i: number }).i).toBe(76)
    expect((recs[recs.length - 1]!.payload as { i: number }).i).toBe(1099)
  })

  it("getRecentTraces honours the limit argument and clamps to buffer size", async () => {
    const mod = await loadEnabled()
    for (let i = 0; i < 10; i++) mod.trace("t", "engine-fill", { i })
    expect(mod.getRecentTraces(3)).toHaveLength(3)
    expect(mod.getRecentTraces(0)).toHaveLength(0)
    expect(mod.getRecentTraces(9999)).toHaveLength(10)
  })

  it("swallows exceptions from a hostile payload without corrupting the ring", async () => {
    const mod = await loadEnabled()
    const bad: Record<string, unknown> = {}
    bad.self = bad // circular JSON — will throw inside logEvent's stringify
    expect(() => mod.trace("t", "engine-fill", bad)).not.toThrow()
    // Subsequent writes still land.
    mod.trace("t", "engine-fill", { ok: true })
    const recs = mod.getRecentTraces()
    expect(recs.length).toBeGreaterThanOrEqual(1)
    expect(recs[recs.length - 1]!.hop).toBe("engine-fill")
  })
})
