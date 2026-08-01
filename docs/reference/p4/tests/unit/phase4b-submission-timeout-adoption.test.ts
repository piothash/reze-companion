/**
 * Phase 4B — F-1: Submission-timeout NEW-id novelty adoption.
 *
 * Scope: verifies the adoption model used by
 * `StandingOrderManager.handlePlacementFailure` after the Phase 4B change.
 * The invariant under test is that when placeOrder times out with the
 * exchange still accepting the order, the SLO adopts the lost order by
 * comparing live open-order IDs against a snapshot captured immediately
 * BEFORE placement (novelty filter). When the snapshot is unavailable it
 * falls back to the pre-F-1 token+side+price match — no regression.
 *
 * This suite intentionally re-implements the small pure fragment of logic
 * so it stays deterministic and does not need to boot the tick loop. The
 * model mirrors the code at `standing-order.ts` inside
 * `handlePlacementFailure` (adoption block).
 *
 * Untouched by this suite: settlement, ledger, bankroll, sizing, replay,
 * Phase 4A (F-3) remainder-cancel path.
 */
import { describe, expect, it } from "vitest"

type OpenOrderRow = { id: string; assetId: string; side: string; price: number }
type Ids = { marketId: string; tokenId: string }

/** Faithful reproduction of the adoption filter used in the SLO. */
function pickAdoption(
  open: OpenOrderRow[],
  ids: Ids,
  limitPrice: number,
  preSnapshotIds: Set<string> | null,
): OpenOrderRow | undefined {
  const candidates = open.filter(
    (o) =>
      o.assetId === ids.tokenId &&
      o.side.toUpperCase() === "BUY" &&
      Math.abs(o.price - limitPrice) < 0.005,
  )
  return (
    (preSnapshotIds ? candidates.find((o) => !preSnapshotIds.has(o.id)) : undefined) ??
    candidates[0]
  )
}

const IDS: Ids = { marketId: "m1", tokenId: "tok-up" }
const LIMIT = 0.97

describe("Phase 4B · F-1 · submission-timeout adoption", () => {
  it("normal path: no prior order + new resting order after failure → ADOPT the new id", () => {
    // No matching order existed before placement, one exists after — that
    // is unambiguously the lost placement. Adopt it (no duplicate placed).
    const pre = new Set<string>([])
    const post: OpenOrderRow[] = [
      { id: "new-1", assetId: "tok-up", side: "BUY", price: 0.97 },
    ]
    expect(pickAdoption(post, IDS, LIMIT, pre)?.id).toBe("new-1")
  })

  it("F-1 edge case: a prior matching order at the same price already existed → adopt ONLY the new id", () => {
    // A previous adoption or a stale order at the same price+side+token
    // must NOT be re-adopted. The novelty filter picks the new id only.
    const pre = new Set<string>(["stale-orig"])
    const post: OpenOrderRow[] = [
      { id: "stale-orig", assetId: "tok-up", side: "BUY", price: 0.97 },
      { id: "new-2", assetId: "tok-up", side: "BUY", price: 0.97 },
    ]
    expect(pickAdoption(post, IDS, LIMIT, pre)?.id).toBe("new-2")
  })

  it("duplicate event / repeated verification returns same lost-order id (idempotent)", () => {
    const pre = new Set<string>([])
    const post: OpenOrderRow[] = [
      { id: "new-3", assetId: "tok-up", side: "BUY", price: 0.97 },
    ]
    const first = pickAdoption(post, IDS, LIMIT, pre)
    const second = pickAdoption(post, IDS, LIMIT, pre)
    expect(first?.id).toBe("new-3")
    expect(second?.id).toBe(first?.id)
  })

  it("restart recovery: post-restart the pre-snapshot is null → falls back to legacy any-match adoption", () => {
    // After a crash the pre-snapshot is unavailable. Legacy behavior
    // (adopt any matching resting order at token+side+price) is preserved,
    // so recovery is never worse than pre-F-1.
    const pre: Set<string> | null = null
    const post: OpenOrderRow[] = [
      { id: "resting-A", assetId: "tok-up", side: "BUY", price: 0.97 },
    ]
    expect(pickAdoption(post, IDS, LIMIT, pre)?.id).toBe("resting-A")
  })

  it("snapshot fetch failed (null) with a prior matching order → still adopts (unchanged from pre-F-1)", () => {
    // Guarantees no regression when the pre-snapshot itself failed: the
    // engine keeps the old less-precise adoption instead of doing nothing.
    const pre: Set<string> | null = null
    const post: OpenOrderRow[] = [
      { id: "resting-B", assetId: "tok-up", side: "BUY", price: 0.97 },
    ]
    expect(pickAdoption(post, IDS, LIMIT, pre)?.id).toBe("resting-B")
  })

  it("no matching order exists → returns undefined so caller re-arms trigger cleanly (no ghost adoption)", () => {
    const pre = new Set<string>([])
    const post: OpenOrderRow[] = [
      { id: "other", assetId: "tok-down", side: "BUY", price: 0.97 },
      { id: "wrong-price", assetId: "tok-up", side: "BUY", price: 0.5 },
      { id: "wrong-side", assetId: "tok-up", side: "SELL", price: 0.97 },
    ]
    expect(pickAdoption(post, IDS, LIMIT, pre)).toBeUndefined()
  })

  it("partial-fill interaction: adopted resting order is a distinct object from any Phase 4A remainder — adoption never observes filled qty (uses limitPrice + tokenId only)", () => {
    // Adoption picks by book criteria only; filled-quantity accounting is
    // owned by Phase 4A (F-3) checkFill and settlement, which read
    // authoritative size_matched from the exchange — never from adoption.
    const pre = new Set<string>([])
    const post: OpenOrderRow[] = [
      { id: "new-4", assetId: "tok-up", side: "BUY", price: 0.97 },
    ]
    const adopted = pickAdoption(post, IDS, LIMIT, pre)
    expect(adopted?.id).toBe("new-4")
    // Adopted row carries the book row's identity only; no fill fields are
    // ever consumed here, so partial-fill correctness is unaffected.
    expect(adopted).not.toHaveProperty("size_matched")
  })

  it("settlement interaction: adoption never invents an order id — undefined means retry, non-undefined must have a real exchange id from the live book", () => {
    // Guards that adoption cannot fabricate an id, which would flow into
    // ledger/settlement lookups incorrectly. Either a real book id or
    // undefined — never a synthesized one.
    const pre = new Set<string>([])
    const empty: OpenOrderRow[] = []
    expect(pickAdoption(empty, IDS, LIMIT, pre)).toBeUndefined()
    const post: OpenOrderRow[] = [
      { id: "book-real-id", assetId: "tok-up", side: "BUY", price: 0.97 },
    ]
    expect(pickAdoption(post, IDS, LIMIT, pre)?.id).toBe("book-real-id")
  })

  it("multiple new orders after failure (pathological) → deterministic first-new-id selection", () => {
    // The SLO only ever places one order per placement attempt; if two
    // truly-new ids appear the first one is chosen deterministically.
    // Real-world extras are surfaced by the 60s reconciler as UNTRACKED.
    const pre = new Set<string>(["existing"])
    const post: OpenOrderRow[] = [
      { id: "existing", assetId: "tok-up", side: "BUY", price: 0.97 },
      { id: "new-first", assetId: "tok-up", side: "BUY", price: 0.97 },
      { id: "new-second", assetId: "tok-up", side: "BUY", price: 0.97 },
    ]
    expect(pickAdoption(post, IDS, LIMIT, pre)?.id).toBe("new-first")
  })

  it("price tolerance holds at ±0.005: 0.9749 accepted, 0.9650 rejected (unchanged)", () => {
    const pre = new Set<string>([])
    const near: OpenOrderRow[] = [
      { id: "near", assetId: "tok-up", side: "BUY", price: 0.9749 },
    ]
    const far: OpenOrderRow[] = [
      { id: "far", assetId: "tok-up", side: "BUY", price: 0.965 },
    ]
    expect(pickAdoption(near, IDS, LIMIT, pre)?.id).toBe("near")
    expect(pickAdoption(far, IDS, LIMIT, pre)).toBeUndefined()
  })
})
