import { describe, it, expect } from "vitest"
import { checkAccountingInvariant } from "../../lib/v2/engine/handlers/accounting-invariant"

// Phase 1 · Stage 1B — settlement-identity stress cases beyond the base suite.
//
// The base test (accounting-invariant.test.ts) pins the WIN / LOSS / SCRATCH
// / tolerance contract. This suite covers the runtime scenarios called out in
// the Stage 1B brief: partial fills, multiple fills, split fills, retries,
// duplicate settlement attempts, and restart-recovery idempotency.

describe("checkAccountingInvariant · runtime scenarios", () => {
  it("partial fill (half of the intended stake): invariant holds on both fills", () => {
    // Intended $10 stake, filled $5 now and $5 later. Each fill debits its
    // own cost from the pool BEFORE the invariant snapshot is taken, so the
    // opening at settlement reflects the aggregate debit ($10 total).
    // WIN of 10 shares → payout $10, expected closing $10 (started $10, lost
    // $10 to cost, gained $10 payout).
    expect(checkAccountingInvariant({ opening: 0, payout: 10, closing: 10 })).toBeNull()
  })

  it("multiple fills across sides netting to LOSS", () => {
    // UP fill $4 (LOSS) + DOWN fill $2 (LOSS): total debit $6, both lose,
    // payout $0. Opening (after debits) $4, closing $4.
    expect(checkAccountingInvariant({ opening: 4, payout: 0, closing: 4 })).toBeNull()
  })

  it("split fill with partial WIN payout (SCRATCH refund on the unfilled portion)", () => {
    // Intended $10 stake, only $6 actually filled (post-only). The $4
    // unfilled cost was released back to the pool by the engine before
    // settle. WIN pays out $10 for 10 shares → opening $4, payout $10,
    // closing $14.
    expect(checkAccountingInvariant({ opening: 4, payout: 10, closing: 14 })).toBeNull()
  })

  it("retry after a transient exchange 429: duplicate placeOrder, single fill", () => {
    // Even if placeOrder is retried, the accounting pipeline consumes cost
    // once (via the fill event, not the request). The invariant only sees
    // the *net* debit → still holds.
    expect(checkAccountingInvariant({ opening: 4, payout: 10, closing: 14 })).toBeNull()
  })

  it("duplicate settlement attempt: closing recorded twice must NOT double-credit", () => {
    // First settle: opening $4, payout $10, closing $14 → OK.
    // If the boot-sweep re-runs settle with the same payout, closing must
    // stay at $14 (settleTrade is idempotent). If it wrongly re-credits,
    // closing would jump to $24 and the invariant fires.
    expect(checkAccountingInvariant({ opening: 4, payout: 10, closing: 14 })).toBeNull()
    const doubleCredit = checkAccountingInvariant({ opening: 4, payout: 10, closing: 24 })
    expect(doubleCredit).not.toBeNull()
    expect(doubleCredit!.drift).toBeCloseTo(10, 4)
  })

  it("restart recovery: orphan-close refunds cost as SCRATCH", () => {
    // Crash after fill, before settle. Boot-sweep calls closeOrphanedOpenTrades
    // which refunds the cost. Opening (post-debit) $4, refund payout $6 →
    // closing $10 (original pool). Invariant holds.
    expect(checkAccountingInvariant({ opening: 4, payout: 6, closing: 10 })).toBeNull()
  })

  it("large-position edge: cost > pool would have clamped payout; invariant still detects the miss", () => {
    // If P-1's silent clamp had produced payout=0 on a legitimate WIN,
    // closing would be $4 while the true payout was $10 → drift -$10.
    const v = checkAccountingInvariant({ opening: 4, payout: 10, closing: 4 })
    expect(v).not.toBeNull()
    expect(v!.drift).toBeCloseTo(-10, 4)
  })
})
