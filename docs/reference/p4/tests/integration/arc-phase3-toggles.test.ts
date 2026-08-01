// ------------------------------------------------------------
// ARC Phase 3 — Execution option toggles.
//
// Covers the three new operator switches (compounding, use trigger
// price, use limit price) plus the expanded execution-window choices.
// The governing invariant for all of them: OMITTED == ON == today's
// verified production behaviour, and direction is ALWAYS the majority
// computed from the fresh snapshot at the execution instant.
// ------------------------------------------------------------

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { StandingOrderManager, SLO_WINDOW_OPTIONS_SEC } from "@/lib/v2/engine/standing-order"
import { RiskManager } from "@/lib/v2/engine/risk"
import type { Bankroll } from "@/lib/v2/engine/bankroll"
import type { ClobPriceFeed } from "@/lib/v2/engine/feeds/clob-price-feed"
import type { BtcReferenceFeed } from "@/lib/v2/engine/feeds/btc-reference-feed"
import type { MarketDiscovery, DiscoveredMarket } from "@/lib/v2/engine/feeds/market-discovery"
import { FakeClobFeed } from "../helpers/fake-clob-feed"

function makeMarket(slotEndMs: number): DiscoveredMarket {
  return {
    slotEndMs,
    slug: `btc-updown-5m-toggles-${slotEndMs}`,
    question: "BTC up or down?",
    conditionId: "0xcond",
    upTokenId: "up-token",
    downTokenId: "down-token",
    orderMinSize: 5,
    tickSize: 0.01,
    active: true,
    closed: false,
    volumeUsd: null,
    liquidityUsd: null,
    endDateIso: null,
  }
}

const live: StandingOrderManager[] = []

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
}

function makeHarness(startingBalance = 1000) {
  const feed = new FakeClobFeed()
  const bankroll = {
    balance: startingBalance,
    dustReserve: 0,
    debitFixed(c: number) {
      this.balance -= c
    },
    settle(payout: number) {
      this.balance += payout
    },
  }
  const spotFeed = {
    get latest() {
      return { price: 100_000, tsMs: Date.now(), source: "chainlink-onchain" as const }
    },
    onTick: () => () => {},
    start() {},
    stop() {},
  } as unknown as BtcReferenceFeed

  const discovery = {
    peek: (slot: number) => makeMarket(slot),
    resolve: async (slot: number) => makeMarket(slot),
    refreshMarket: async (slot: number) => makeMarket(slot),
    fetchResolution: async () => null,
  } as unknown as MarketDiscovery

  // The test ledger DB is shared across suites, so risk limits may carry over
  // from another file. Pin generous limits so sizing math is what's under test.
  const risk = new RiskManager(() => "PAPER_V1")
  risk.setLimits({
    maxSharesPerOrder: 10_000,
    maxOrderNotionalUsd: 100_000,
    maxDailyOrders: 100_000,
    maxDailyLossUsd: 100_000,
  })

  const mgr = new StandingOrderManager({
    getMode: () => "PAPER_V1",
    getBankroll: () => bankroll as unknown as Bankroll,
    discovery,
    clobPriceFeed: feed as unknown as ClobPriceFeed,
    spotFeed,
    risk,
  })
  live.push(mgr)

  return {
    mgr,
    feed,
    bankroll,
    setPrices: (up: number | null, down: number | null) => feed.setPrices(up, down),
    driveTick: async () => {
      feed.listener?.()
      await flush()
    },
    snap: () => mgr.snapshot(),
  }
}

beforeAll(() => {
  const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || "data/test-ledger.db")
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbPath + suffix, { force: true })
    } catch {
      /* ignore */
    }
  }
})

afterEach(() => {
  while (live.length) live.pop()!.dispose()
  vi.useRealTimers()
})

// ------------------------------------------------------------
// TASK 6 — backward compatibility
// ------------------------------------------------------------

describe("Toggles — backward compatibility (omitted == ON)", () => {
  it("an arm() call with no toggle options reports all three toggles ON", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.4, 0.3)
    expect(h.mgr.arm(0.9, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE")).toContain("armed")
    await flush()
    const s = h.snap()!
    expect(s.compounding).toBe(true)
    expect(s.useTriggerPrice).toBe(true)
    expect(s.useLimitPrice).toBe(true)
  })

  it("explicit ON behaves identically to omitted (no entry before the trigger)", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.4, 0.3)
    h.mgr.arm(0.9, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", {
      compounding: true,
      useTriggerPrice: true,
      useLimitPrice: true,
    })
    await h.driveTick()
    expect(h.snap()!.executionCount).toBe(0)
  })
})

// ------------------------------------------------------------
// TASK 1 — execution window expansion
// ------------------------------------------------------------

describe("Execution window expansion", () => {
  it("3s, 7s and 10s are valid window choices", () => {
    for (const sec of [3, 7, 10]) expect(SLO_WINDOW_OPTIONS_SEC).toContain(sec)
  })

  it("the previously supported windows are all still valid", () => {
    for (const sec of [5, 15, 30, 45, 60, 90, 120]) expect(SLO_WINDOW_OPTIONS_SEC).toContain(sec)
  })

  it("each new short window is accepted at arm time", () => {
    for (const sec of [3, 7, 10]) {
      const h = makeHarness(1000)
      expect(h.mgr.arm(0.9, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { entryWindowSec: sec })).toContain("armed")
    }
  })

  it("an unsupported duration is still rejected", () => {
    const h = makeHarness(1000)
    expect(h.mgr.arm(0.9, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { entryWindowSec: 8 })).toContain("Time window")
  })
})

// ------------------------------------------------------------
// TASK 2 — compounding toggle
// ------------------------------------------------------------

describe("Compounding toggle", () => {
  it("ON: PERCENT sizing tracks the live pool", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.4, 0.3)
    expect(h.mgr.arm(0.9, 0, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { sizingMode: "PERCENT", sizeValue: 10 })).toContain("armed")
    await flush()
    // 10% of 1000 = 100 → floor(100/0.90) = 111
    expect(h.snap()!.shares).toBe(111)
    h.bankroll.balance = 2000
    // 10% of 2000 = 200 → floor(200/0.90) = 222
    expect(h.snap()!.shares).toBe(222)
  })

  it("OFF: the sizing basis is frozen at arm time and ignores later pool moves", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.4, 0.3)
    h.mgr.arm(0.9, 0, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", {
      sizingMode: "PERCENT",
      sizeValue: 10,
      compounding: false,
    })
    await flush()
    expect(h.snap()!.shares).toBe(111)
    h.bankroll.balance = 2000
    expect(h.snap()!.shares).toBe(111)
    h.bankroll.balance = 250
    expect(h.snap()!.shares).toBe(111)
    expect(h.snap()!.compounding).toBe(false)
  })

  it("OFF: FIXED_SHARES is unaffected — it never compounded", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.4, 0.3)
    h.mgr.arm(0.9, 12, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { compounding: false })
    await flush()
    expect(h.snap()!.shares).toBe(12)
    h.bankroll.balance = 5000
    expect(h.snap()!.shares).toBe(12)
  })
})

// ------------------------------------------------------------
// TASK 3 — trigger price toggle
// ------------------------------------------------------------

describe("Trigger price toggle", () => {
  it("ON: no entry while the price is below the trigger", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.55, 0.45)
    h.mgr.arm(0.9, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { useTriggerPrice: true })
    await h.driveTick()
    expect(h.snap()!.executionCount).toBe(0)
  })

  it("OFF: an in-band price enters immediately without reaching the trigger", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.55, 0.45)
    h.mgr.arm(0.9, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { useTriggerPrice: false })
    await flush()
    const s = h.snap()!
    expect(s.useTriggerPrice).toBe(false)
    expect(s.executionCount).toBe(1)
  })

  it("OFF: direction is still the live majority, never a preselected side", async () => {
    const h = makeHarness(1000)
    // DOWN is the majority here — the entry must be DOWN.
    h.setPrices(0.35, 0.65)
    h.mgr.arm(0.9, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { useTriggerPrice: false })
    await flush()
    expect(h.snap()!.openPosition?.side).toBe("DOWN")
  })

  it("OFF: the guardrail band is still enforced — an out-of-band price does not enter", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.55, 0.45)
    h.mgr.arm(0.9, 10, 5, 0.6, 0.99, 0.9, "AT_OR_ABOVE", { useTriggerPrice: false })
    await h.driveTick()
    expect(h.snap()!.executionCount).toBe(0)
  })
})

// ------------------------------------------------------------
// TASK 4 — limit price toggle
// ------------------------------------------------------------

describe("Limit price toggle", () => {
  it("ON: the order is submitted at the configured target price", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.95, 0.05)
    h.mgr.arm(0.97, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { useLimitPrice: true })
    await flush()
    const s = h.snap()!
    expect(s.executionCount).toBe(1)
    expect(s.openPosition?.entryPrice).toBeCloseTo(0.97, 2)
  })

  it("OFF: the order is submitted at the current best price on the majority side", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.95, 0.05)
    h.mgr.arm(0.97, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { useLimitPrice: false })
    await flush()
    const s = h.snap()!
    expect(s.useLimitPrice).toBe(false)
    expect(s.executionCount).toBe(1)
    expect(s.openPosition?.side).toBe("UP")
    expect(s.openPosition?.entryPrice).toBeCloseTo(0.95, 2)
  })

  it("OFF: still routes through the single execution pipeline (one order, one position)", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.95, 0.05)
    h.mgr.arm(0.97, 10, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", { useLimitPrice: false })
    await flush()
    expect(h.snap()!.openPositionCount).toBe(1)
  })
})

// ------------------------------------------------------------
// Combined
// ------------------------------------------------------------

describe("Toggles — combined", () => {
  it("all three OFF: enters at the best majority price with a frozen sizing basis", async () => {
    const h = makeHarness(1000)
    h.setPrices(0.30, 0.70)
    h.mgr.arm(0.9, 0, 5, 0.01, 0.99, 0.9, "AT_OR_ABOVE", {
      sizingMode: "PERCENT",
      sizeValue: 10,
      compounding: false,
      useTriggerPrice: false,
      useLimitPrice: false,
    })
    await flush()
    const s = h.snap()!
    expect(s.compounding).toBe(false)
    expect(s.useTriggerPrice).toBe(false)
    expect(s.useLimitPrice).toBe(false)
    expect(s.executionCount).toBe(1)
    expect(s.openPosition?.side).toBe("DOWN")
    expect(s.openPosition?.entryPrice).toBeCloseTo(0.70, 2)
  })
})
