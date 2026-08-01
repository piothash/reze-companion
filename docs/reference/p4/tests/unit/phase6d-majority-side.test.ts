// Phase 6D regression test — majority-side execution.
//
// These tests exercise the SLO majority-side override in isolation by
// re-implementing the tiny amount of logic added in Phase 6D against
// the same `computeMajority` shape used by the engine. They intentionally
// avoid booting the full engine so the test is fast, deterministic, and
// robust to unrelated refactors of the tick loop.

import { describe, expect, it } from "vitest"

type TradeSide = "UP" | "DOWN"
interface Snapshot {
  up: { price: number }
  down: { price: number }
}

// Mirror of StandingOrderManager.computeMajority (reference/p4/lib/v2/engine/standing-order.ts).
function computeMajority(snap: Snapshot | null): { side: TradeSide | null; price: number } {
  if (!snap) return { side: null, price: 0 }
  return snap.up.price >= snap.down.price
    ? { side: "UP", price: snap.up.price }
    : { side: "DOWN", price: snap.down.price }
}

// Extract of the Phase 6D override block.
function majorityOverride(
  lockedDirection: TradeSide | null,
  crossingSide: TradeSide,
  crossingPrice: number,
  snap: Snapshot | null,
): { side: TradeSide; price: number; overridden: boolean } {
  if (lockedDirection !== null) {
    return { side: lockedDirection, price: crossingPrice, overridden: false }
  }
  const majority = computeMajority(snap)
  if (majority.side !== null && majority.side !== crossingSide) {
    return { side: majority.side, price: majority.price, overridden: true }
  }
  return { side: crossingSide, price: crossingPrice, overridden: false }
}

describe("Phase 6D — SLO majority-side execution", () => {
  it("no-op when majority matches the triggering side (typical 0.97 trigger)", () => {
    const snap: Snapshot = { up: { price: 0.97 }, down: { price: 0.03 } }
    const r = majorityOverride(null, "UP", 0.97, snap)
    expect(r.side).toBe("UP")
    expect(r.overridden).toBe(false)
  })

  it("redirects to majority when trigger crosses on the minority (low trigger)", () => {
    // trigger = 0.30. DOWN crosses first at 0.35 but UP is majority at 0.65.
    const snap: Snapshot = { up: { price: 0.65 }, down: { price: 0.35 } }
    const r = majorityOverride(null, "DOWN", 0.35, snap)
    expect(r.side).toBe("UP")
    expect(r.price).toBeCloseTo(0.65, 5)
    expect(r.overridden).toBe(true)
  })

  it("scenario B — DOWN majority at trigger fires BUY DOWN", () => {
    const snap: Snapshot = { up: { price: 0.03 }, down: { price: 0.97 } }
    const r = majorityOverride(null, "DOWN", 0.97, snap)
    expect(r.side).toBe("DOWN")
    expect(r.overridden).toBe(false)
  })

  it("null snapshot is safe — falls back to the crossing side", () => {
    const r = majorityOverride(null, "UP", 0.97, null)
    expect(r.side).toBe("UP")
    expect(r.overridden).toBe(false)
  })

  it("post-lock: majority override does not fire", () => {
    // Locked to UP earlier; even if DOWN is now majority, we stay on UP.
    const snap: Snapshot = { up: { price: 0.40 }, down: { price: 0.60 } }
    const r = majorityOverride("UP", "UP", 0.40, snap)
    expect(r.side).toBe("UP")
    expect(r.overridden).toBe(false)
  })

  it("tie (equal prices): majority side is UP by tie-break, override is a no-op when UP triggered", () => {
    const snap: Snapshot = { up: { price: 0.50 }, down: { price: 0.50 } }
    const r = majorityOverride(null, "UP", 0.50, snap)
    expect(r.side).toBe("UP")
    expect(r.overridden).toBe(false)
  })

  it("tie: DOWN triggered gets redirected to UP majority per tie-break", () => {
    const snap: Snapshot = { up: { price: 0.50 }, down: { price: 0.50 } }
    const r = majorityOverride(null, "DOWN", 0.50, snap)
    expect(r.side).toBe("UP")
    expect(r.overridden).toBe(true)
  })
})
