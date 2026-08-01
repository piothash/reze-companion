import { describe, it, expect } from "vitest"
import { checkAccountingInvariant } from "../../lib/v2/engine/handlers/accounting-invariant"

// Phase 1 · Stage 1A · P-2 regression coverage.
//
// The invariant `closing = opening + payout` is the single mathematical
// contract that both the SLO path and the strategy-engine path must satisfy
// at settlement. These tests pin the contract so a future refactor that
// silently drops the check on either path is caught immediately.

describe("checkAccountingInvariant", () => {
  it("returns null when closing exactly equals opening + payout (WIN)", () => {
    // A $10 pool bets $6, wins $10 (10 shares × $1). Expected closing $14.
    expect(checkAccountingInvariant({ opening: 4, payout: 10, closing: 14 })).toBeNull()
  })

  it("returns null when closing equals opening + payout (LOSS, payout 0)", () => {
    // Bet $6, lost. Pool at settlement = pool at fill (already debited).
    expect(checkAccountingInvariant({ opening: 4, payout: 0, closing: 4 })).toBeNull()
  })

  it("returns null on SCRATCH refund", () => {
    // Bet $6, scratched. Pool refunds the cost: opening $4, payout $6 → $10.
    expect(checkAccountingInvariant({ opening: 4, payout: 6, closing: 10 })).toBeNull()
  })

  it("tolerates sub-cent floating error within default tolerance", () => {
    // Real-world floating result e.g. from 0.1 + 0.2 arithmetic.
    expect(checkAccountingInvariant({ opening: 4, payout: 10, closing: 14.005 })).toBeNull()
  })

  it("detects a double-credit (payout applied twice)", () => {
    const v = checkAccountingInvariant({ opening: 4, payout: 10, closing: 24 })
    expect(v).not.toBeNull()
    expect(v!.drift).toBeCloseTo(10, 4)
    expect(v!.expectedClosing).toBeCloseTo(14, 4)
    expect(v!.absoluteError).toBeCloseTo(10, 4)
  })

  it("detects a missed credit (payout not applied)", () => {
    const v = checkAccountingInvariant({ opening: 4, payout: 10, closing: 4 })
    expect(v).not.toBeNull()
    expect(v!.drift).toBeCloseTo(-10, 4)
  })

  it("respects a custom tolerance", () => {
    // 5 cent tolerance accepts a 4 cent drift.
    expect(checkAccountingInvariant({ opening: 4, payout: 10, closing: 14.04, tolerance: 0.05 })).toBeNull()
    // Same drift under a stricter 1 cent tolerance is flagged.
    expect(checkAccountingInvariant({ opening: 4, payout: 10, closing: 14.04, tolerance: 0.01 })).not.toBeNull()
  })
})
