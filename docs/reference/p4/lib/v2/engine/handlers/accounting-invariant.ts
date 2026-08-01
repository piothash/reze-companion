// ============================================================================
// HANDLER · ACCOUNTING INVARIANT (Phase 1 — Stage 1A · P-2 fix)
// ============================================================================
// Single source of truth for the settlement identity:
//     closing_pool = opening_pool + payout
// where `opening_pool = bankroll.balance + bankroll.dustReserve` right before
// `bankroll.settle(payout)` is called, and `closing_pool` is the same sum
// immediately after.
//
// Extracted from lib/v2/engine/standing-order.ts (the original SLO
// implementation at lines 2331-2354) so both the SLO path AND the registry
// engine path use the same invariant. Prior to this extraction only the SLO
// path detected drift; a double-credit or missed credit on the engine path
// would appear only as slow drift between the bankroll and `Σ pnl` in the
// analytics view.
// ============================================================================

export interface InvariantInput {
  /** Pool total (balance + dustReserve) captured immediately BEFORE settle(). */
  opening: number
  /** Payout applied to the bankroll (WIN → shares×$1, LOSS → 0, SCRATCH → cost). */
  payout: number
  /** Pool total captured immediately AFTER settle() + any ledger writes. */
  closing: number
  /** Tolerance in dollars; drift under this is not reported. */
  tolerance?: number
}

export interface InvariantViolation {
  /** Difference between actual closing and expected closing (opening + payout). */
  drift: number
  /** What the pool should have been given the opening + payout. */
  expectedClosing: number
  /** Absolute value of drift, for threshold comparisons. */
  absoluteError: number
}

/**
 * Return null when the settlement identity holds within tolerance; otherwise
 * return a violation record describing the drift. This function is pure and
 * does not log — callers decide how to react (log ERROR, insertOrderLog row,
 * halt, etc).
 */
export function checkAccountingInvariant(input: InvariantInput): InvariantViolation | null {
  const tolerance = input.tolerance ?? 0.01
  const expectedClosing = Math.round((input.opening + input.payout) * 10000) / 10000
  const drift = Math.round((input.closing - expectedClosing) * 10000) / 10000
  const absoluteError = Math.abs(drift)
  if (absoluteError <= tolerance) return null
  return { drift, expectedClosing, absoluteError }
}
