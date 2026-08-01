import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { AccountSync, isValidFunderAddress } from "../../lib/v2/engine/feeds/account-sync"
import type { Executor } from "../../lib/v2/engine/execution/executor"

// Phase 6B — F-1 (HTTP 400 backoff) and F-2 (address validation) regression
// tests. These pin the new behaviour of the LIVE_V2 account mirror.

const VALID = "0x1234567890abcdef1234567890abcdef12345678"
const INVALID_ADDRS = ["", null, "0xnothex", "0x1234", "notanaddress", "0x" + "z".repeat(40)]

function makeExecutor(overrides: Partial<Executor> & { funder?: string | null } = {}): Executor {
  const funder = overrides.funder === undefined ? VALID : overrides.funder
  return {
    label: "LIVE_V2",
    getFunderAddress: () => funder,
    getAvailableBalanceUsd: () => Promise.resolve(100),
    getOpenOrdersLive: () => Promise.resolve([]),
    getRecentTradesLive: () => Promise.resolve([]),
    ...overrides,
  } as unknown as Executor
}

describe("Phase 6B · F-2 · funder address validation", () => {
  it("accepts a canonical 0x + 40 hex address", () => {
    expect(isValidFunderAddress(VALID)).toBe(true)
  })

  it("rejects null / empty / short / non-hex addresses", () => {
    for (const bad of INVALID_ADDRS) {
      expect(isValidFunderAddress(bad as string | null)).toBe(false)
    }
  })

  it("does not fetch /positions or /value when the funder address is malformed", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)
    const sync = new AccountSync(makeExecutor({ funder: "0xnotanaddress" }), "https://data-api.example")
    await sync.refresh("test", true)
    // Only CLOB SDK calls should have run; no Data-API fetch.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sync._debugState().addressPollable).toBe(false)
    vi.unstubAllGlobals()
  })

  it("does fetch when the funder address is well-formed", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchSpy)
    const sync = new AccountSync(makeExecutor(), "https://data-api.example")
    await sync.refresh("test", true)
    // Two Data-API calls: /positions and /value.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(sync._debugState().addressPollable).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe("Phase 6B · F-1 · HTTP 400 backoff", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("caches empty positions and value on the first 400, then suppresses re-fetch for 5 minutes", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }))
    vi.stubGlobal("fetch", fetchSpy)
    const sync = new AccountSync(makeExecutor(), "https://data-api.example")

    await sync.refresh("first", true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const snap1 = sync.get()!
    expect(snap1.positions).toEqual([])
    expect(snap1.portfolioValueUsd).toBe(0)
    expect(snap1.totalUnrealizedPnl).toBe(0)
    expect(snap1.totalRealizedPnl).toBe(0)
    // A 400 must NOT be surfaced as a source error.
    expect(snap1.errors.some((e) => e.startsWith("positions:") || e.startsWith("value:"))).toBe(false)
    expect(sync._debugState().dataApiCold).toBe(true)

    // Second refresh well within the cold window: no Data-API traffic.
    fetchSpy.mockClear()
    await sync.refresh("hot-retry", true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sync.get()!.portfolioValueUsd).toBe(0)
  })

  it("recovers when a subsequent Data-API call returns 200", async () => {
    let callCount = 0
    const fetchSpy = vi.fn().mockImplementation(async () => {
      callCount += 1
      // First round → 400 for both endpoints.
      if (callCount <= 2) return new Response("bad request", { status: 400 })
      // Later rounds → 200 with a value.
      return new Response(JSON.stringify([{ value: 42 }]), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchSpy)
    const sync = new AccountSync(makeExecutor(), "https://data-api.example")

    await sync.refresh("cold", true)
    expect(sync._debugState().dataApiCold).toBe(true)

    // Advance past the cold window and refresh: the sync should retry and recover.
    // (The test simulates the passage of time by manually poking the internal
    // timestamp; the AccountSync uses Date.now() for gating.)
    const past = Date.now() - 6 * 60_000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sync as any).dataApiLastAttemptMs = past
    fetchSpy.mockClear()
    // Simulated recovery: return 200 for both endpoints.
    fetchSpy.mockResolvedValue(new Response(JSON.stringify([{ value: 42 }]), { status: 200 }))
    await sync.refresh("recover", true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(sync._debugState().dataApiCold).toBe(false)
  })

  it("still surfaces non-400 Data-API failures as source errors", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("boom", { status: 502 }))
    vi.stubGlobal("fetch", fetchSpy)
    const sync = new AccountSync(makeExecutor(), "https://data-api.example")
    await sync.refresh("fail", true)
    const snap = sync.get()!
    expect(snap.errors.some((e) => e.startsWith("positions:") && e.includes("HTTP 502"))).toBe(true)
    expect(sync._debugState().dataApiCold).toBe(false)
  })
})
