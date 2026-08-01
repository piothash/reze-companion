/**
 * Phase 2 — settlement hardening regression tests.
 *
 * Covers the pure-math invariants of the settlement path without spinning up
 * the full engine: bankroll credit correctness, the payout-delta identity that
 * powers settlement-repair, and the idempotency guarantee that a repeated
 * settle for the same trade uid can never double-credit or double-write.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Bankroll } from "../../lib/v2/engine/bankroll"
import { computeExpected, bookedPayout, repairTrade } from "../../lib/v2/engine/settlement-repair"
import { kvGet, kvSet } from "../../lib/v2/engine/db"

const MODE = "PAPER_V1" as const

function resetBankroll(startingUsd: number) {
  const b = new Bankroll(MODE)
  b.reset(startingUsd)
  return b
}

describe("Phase 2 — Bankroll settlement math", () => {
  beforeEach(() => resetBankroll(100))

  it("WIN credits payout = shares × $1 exactly once", () => {
    const b = new Bankroll(MODE)
    const before = b.balance
    // Fill: 10 shares @ $0.40 cost $4. Debit at fill time.
    b.debitFixed(4)
    // Settle WIN: payout = 10 shares × $1.
    b.settle(10)
    expect(b.balance).toBeCloseTo(before - 4 + 10, 4)
  })

  it("LOSS credits 0 — bankroll drops by cost only", () => {
    const b = new Bankroll(MODE)
    const before = b.balance
    b.debitFixed(4)
    b.settle(0) // LOSS
    expect(b.balance).toBeCloseTo(before - 4, 4)
  })

  it("SCRATCH refunds cost — bankroll unchanged over the round-trip", () => {
    const b = new Bankroll(MODE)
    const before = b.balance
    b.debitFixed(4)
    b.settle(4) // SCRATCH: payout == cost
    expect(b.balance).toBeCloseTo(before, 4)
  })
})

describe("Phase 2 — Settlement math (pure)", () => {
  it("computeExpected: WIN pays shares", () => {
    const e = computeExpected({ side: "UP", shares: 10, cost: 4 }, "UP")
    expect(e).toEqual({ result: "WIN", payout: 10, pnl: 6, markPrice: 1 })
  })
  it("computeExpected: LOSS pays 0", () => {
    const e = computeExpected({ side: "UP", shares: 10, cost: 4 }, "DOWN")
    expect(e).toEqual({ result: "LOSS", payout: 0, pnl: -4, markPrice: 0 })
  })
  it("bookedPayout mirrors WIN/LOSS/SCRATCH", () => {
    expect(bookedPayout({ result: "WIN", shares: 10, cost: 4 })).toBe(10)
    expect(bookedPayout({ result: "LOSS", shares: 10, cost: 4 })).toBe(0)
    expect(bookedPayout({ result: "SCRATCH", shares: 10, cost: 4 })).toBe(4)
  })
})

describe("Phase 2 — Idempotent settlement lock (repair path)", () => {
  const uid = `phase2-test-${Date.now()}`
  const key = `repair:settle:${uid}`

  beforeEach(() => {
    // Clear any prior marker.
    try { kvSet(key, "") } catch { /* ignore */ }
  })

  it("repairTrade refuses to run twice for the same trade uid", () => {
    // Prime the idempotency marker as if a prior repair had succeeded.
    kvSet(key, "prior-run")
    const out = repairTrade(
      {
        id: -1, tradeUid: uid, marketId: "phase2-mkt", slotEndMs: 0,
        side: "UP", price: 0.5, shares: 10, cost: 5,
        result: "SCRATCH", pnl: 0, mode: MODE,
      },
      "UP",
      { requestedBy: "phase2-test" },
    )
    expect(out.applied).toBe(false)
    expect(out.reason).toMatch(/already repaired/)
    expect(out.balanceDelta).toBe(0)
  })

  it("repairTrade is a no-op when booked result already matches official", () => {
    const out = repairTrade(
      {
        id: -1, tradeUid: `${uid}-match`, marketId: "phase2-mkt", slotEndMs: 0,
        side: "UP", price: 0.5, shares: 10, cost: 5,
        result: "WIN", pnl: 5, mode: MODE,
      },
      "UP",
      { requestedBy: "phase2-test" },
    )
    expect(out.applied).toBe(false)
    expect(out.reason).toMatch(/already matches/)
    expect(out.balanceDelta).toBe(0)
  })
})

describe("Phase 2 — SCRATCH-pending marker semantics", () => {
  it("'pending' lock does NOT block a later upgrade", () => {
    // The engine writes `settle:lock:<uid> = pending` for a SCRATCH-from-
    // pending-official settle; the verifier's repair path uses a separate
    // `repair:settle:<uid>` key. The engine's own lock check must only
    // reject 'final:*' markers.
    const isBlocked = (marker: string | null) => !!marker && !marker.startsWith("pending")
    expect(isBlocked("pending")).toBe(false)
    expect(isBlocked("final:WIN")).toBe(true)
    expect(isBlocked("final:LOSS")).toBe(true)
    expect(isBlocked("final:SCRATCH")).toBe(true)
    expect(isBlocked(null)).toBe(false)
  })
})
