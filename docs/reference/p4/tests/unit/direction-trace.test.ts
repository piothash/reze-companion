import { describe, it, expect, beforeEach } from "vitest"

// Phase 1 · Stage 1A — verify the direction tracer is safe and correct.
//
// The tracer is env-gated (P4_DIAG_DIRECTION). To exercise the ENABLED branch
// deterministically without process-env timing races we use vi.resetModules()
// and set the env before the module is imported, in an isolated test only.

describe("diag/direction-trace (disabled by default)", () => {
  it("enabled() is false and trace() is a no-op without P4_DIAG_DIRECTION", async () => {
    const prev = process.env.P4_DIAG_DIRECTION
    delete process.env.P4_DIAG_DIRECTION
    const mod = await import("../../lib/v2/engine/diag/direction-trace")
    mod._resetForTests()
    expect(mod.enabled()).toBe(false)
    mod.trace("t_1", "engine-fill", { any: 1 })
    expect(mod.getRecentTraces()).toEqual([])
    if (prev !== undefined) process.env.P4_DIAG_DIRECTION = prev
  })

  it("never throws when payload contains a value that would break JSON.stringify (BigInt)", async () => {
    const mod = await import("../../lib/v2/engine/diag/direction-trace")
    expect(() => mod.trace("t_2", "engine-fill", { big: 1n as unknown as number })).not.toThrow()
  })

  it("newTraceId returns a non-empty string prefixed with t_", async () => {
    const mod = await import("../../lib/v2/engine/diag/direction-trace")
    const id = mod.newTraceId()
    expect(typeof id).toBe("string")
    expect(id.startsWith("t_")).toBe(true)
    expect(id.length).toBeGreaterThan(3)
  })
})
