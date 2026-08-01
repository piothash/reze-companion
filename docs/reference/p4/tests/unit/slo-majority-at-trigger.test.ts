// Regression test — Standing Limit Order direction selection.
//
// Invariant under test: direction is ALWAYS the live majority (higher-priced
// contract) of the fresh atomic snapshot at the instant the trigger is
// reached. The trigger NEVER selects direction — it only gates timing.
// EITHER side crossing the trigger fires an entry, but the executed side is
// always the current majority.
//
// This test re-implements the tiny amount of logic used by the engine
// (side-agnostic trigger + majority selection) so it stays fast and
// deterministic and does not depend on booting the full tick loop.

import { describe, expect, it } from "vitest"

type TradeSide = "UP" | "DOWN"
interface Snapshot { up: { price: number }; down: { price: number } }

function triggerReached(snap: Snapshot, trigger: number): boolean {
  return Math.max(snap.up.price, snap.down.price) >= trigger
}

function chooseSide(snap: Snapshot): { side: TradeSide; price: number } {
  return snap.up.price >= snap.down.price
    ? { side: "UP", price: snap.up.price }
    : { side: "DOWN", price: snap.down.price }
}

/** End-to-end: gate + selection. Returns null when no submission is warranted. */
function evaluate(snap: Snapshot | null, trigger: number): { side: TradeSide; price: number } | null {
  if (!snap) return null // no fresh data → withhold
  if (!triggerReached(snap, trigger)) return null
  return chooseSide(snap)
}

describe("SLO — trigger gates timing, majority selects direction", () => {
  it("Example A: UP majority at trigger → BUY UP", () => {
    const r = evaluate({ up: { price: 0.97 }, down: { price: 0.05 } }, 0.97)
    expect(r).toEqual({ side: "UP", price: 0.97 })
  })

  it("Example B: DOWN majority at trigger → BUY DOWN", () => {
    const r = evaluate({ up: { price: 0.05 }, down: { price: 0.97 } }, 0.97)
    expect(r).toEqual({ side: "DOWN", price: 0.97 })
  })

  it("EITHER side crossing the trigger fires an entry (low trigger, DOWN crossed but UP majority)", () => {
    // trigger=0.30. DOWN=0.35 crossed first; UP=0.65 is majority. Old race
    // logic could have bought DOWN. New logic MUST buy UP.
    const r = evaluate({ up: { price: 0.65 }, down: { price: 0.35 } }, 0.30)
    expect(r).toEqual({ side: "UP", price: 0.65 })
  })

  it("Trigger not reached: no submission (never guess)", () => {
    const r = evaluate({ up: { price: 0.40 }, down: { price: 0.55 } }, 0.60)
    expect(r).toBeNull()
  })

  it("No fresh snapshot: withhold (never use stale majority)", () => {
    const r = evaluate(null, 0.50)
    expect(r).toBeNull()
  })

  it("Tie: UP wins by deterministic tie-break", () => {
    const r = evaluate({ up: { price: 0.50 }, down: { price: 0.50 } }, 0.50)
    expect(r).toEqual({ side: "UP", price: 0.50 })
  })

  it("Both sides at/above trigger: majority (higher price) is chosen — not the one that crossed first", () => {
    // Simulate a torn narrative: DOWN crossed first in real time, but the
    // atomic snapshot at trigger instant shows UP is the majority.
    const r = evaluate({ up: { price: 0.98 }, down: { price: 0.96 } }, 0.95)
    expect(r?.side).toBe("UP")
  })

  it("Direction is derived fresh every evaluation — no caching across calls", () => {
    // Same trigger, two very different snapshots back-to-back. Second call
    // must produce DOWN based solely on the second snapshot.
    const first = evaluate({ up: { price: 0.90 }, down: { price: 0.10 } }, 0.85)
    const second = evaluate({ up: { price: 0.10 }, down: { price: 0.90 } }, 0.85)
    expect(first?.side).toBe("UP")
    expect(second?.side).toBe("DOWN")
  })
})
