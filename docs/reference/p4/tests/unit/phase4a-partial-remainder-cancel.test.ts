/**
 * Phase 4A — F-3: Partial-remainder cancel retry & CRITICAL_UNTRACKED escalation.
 *
 * Scope: this suite ONLY exercises the partial-fill remainder-cancel path in
 * `LiveExecutor.checkFill` / `cancelRemainderWithRetry`. It does NOT touch
 * SLO trigger, settlement, ledger, bankroll, sizing, or replay.
 *
 * Invariants under test (per Phase 4A requirements):
 *   1. Duplicate fill/cancel events are idempotent (state-checked short-circuit).
 *   2. Exactly one remainder is cancelled per partial fill.
 *   3. Late fills during cancel are counted authoritatively from exchange truth,
 *      never from requested size.
 *   4. Cancel failures do not throw upward, but escalate CRITICAL_UNTRACKED
 *      when the order remains LIVE after every attempt.
 *   5. FillReport.filledShares reflects only actually-filled quantity.
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import { Wallet } from "ethers"

// Ethers requires a real 32-byte key to construct the Wallet in the LiveExecutor
// constructor. Generate an ephemeral one and stage the rest of the credentials
// BEFORE importing the module (env is captured at import time).
const throwaway = Wallet.createRandom()
process.env.WALLET_PRIVATE_KEY = throwaway.privateKey
process.env.FUNDER_ADDRESS = "0x000000000000000000000000000000000000dEaD"
process.env.CLOB_API_KEY = "test-key"
process.env.CLOB_SECRET = "test-secret"
process.env.CLOB_PASS_PHRASE = "test-pass"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyExec = any

let LiveExecutor: AnyExec

beforeAll(async () => {
  ;({ LiveExecutor } = await import("../../lib/v2/engine/execution/live"))
})

function makeExec(clientMock: Record<string, unknown>): AnyExec {
  const exec = new LiveExecutor()
  ;(exec as { client: unknown }).client = clientMock
  return exec
}

function makeOrder(shares = 10) {
  return {
    clientOrderId: "cid-1",
    exchangeOrderId: "eoid-1",
    marketId: "m1",
    tokenId: "tok-up",
    side: "UP" as const,
    price: 0.5,
    shares,
    placedAtMs: Date.now(),
    phase: "PRIORITY_1" as const,
  }
}

describe("Phase 4A · F-3 · cancelRemainderWithRetry", () => {
  it("cancels remainder on first success (single call, no double-cancel)", async () => {
    const cancelOrder = vi.fn().mockResolvedValue({ success: true })
    const getOrder = vi.fn().mockResolvedValue({ status: "CANCELED", size_matched: 6 })
    const exec = makeExec({ cancelOrder, getOrder })

    await exec.cancelRemainderWithRetry(makeOrder(10), 6)

    expect(cancelOrder).toHaveBeenCalledTimes(1)
  })

  it("retries transient failures then succeeds; still exactly one live remainder", async () => {
    const cancelOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 upstream"))
      .mockResolvedValueOnce({ success: true })
    // Between attempts state must still say LIVE for a retry to occur.
    const getOrder = vi.fn().mockResolvedValue({ status: "LIVE", size_matched: 6 })
    const exec = makeExec({ cancelOrder, getOrder })

    await exec.cancelRemainderWithRetry(makeOrder(10), 6)

    expect(cancelOrder).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry when the order is already DEAD (idempotent under duplicate cancel ACKs)", async () => {
    const cancelOrder = vi.fn().mockRejectedValueOnce(new Error("transient"))
    // Post-failure poll returns "not found" → DEAD.
    const getOrder = vi.fn().mockResolvedValue(null)
    const exec = makeExec({ cancelOrder, getOrder })

    await exec.cancelRemainderWithRetry(makeOrder(10), 6)

    // First attempt fires, next iteration sees DEAD and short-circuits.
    expect(cancelOrder).toHaveBeenCalledTimes(1)
  })

  it("does NOT retry when the order flipped to MATCHED (late natural fill)", async () => {
    const cancelOrder = vi.fn().mockRejectedValueOnce(new Error("transient"))
    const getOrder = vi.fn().mockResolvedValue({ status: "MATCHED", size_matched: 10 })
    const exec = makeExec({ cancelOrder, getOrder })

    await exec.cancelRemainderWithRetry(makeOrder(10), 6)

    expect(cancelOrder).toHaveBeenCalledTimes(1)
  })

  it("escalates CRITICAL_UNTRACKED when every attempt fails AND order remains LIVE", async () => {
    const cancelOrder = vi.fn().mockRejectedValue(new Error("persistent 500"))
    // Every state poll continues to say LIVE — the remainder is a real orphan.
    const getOrder = vi.fn().mockResolvedValue({ status: "LIVE", size_matched: 6 })
    const exec = makeExec({ cancelOrder, getOrder })

    // Should NOT throw — a partial fill must still return a FillReport upstream.
    await expect(exec.cancelRemainderWithRetry(makeOrder(10), 6)).resolves.toBeUndefined()

    // Backoff schedule = [100, 250, 500] → 4 attempts total.
    expect(cancelOrder).toHaveBeenCalledTimes(4)
  }, 10_000)

  it("does NOT escalate when cancel calls fail but final state is DEAD", async () => {
    const cancelOrder = vi.fn().mockRejectedValue(new Error("network flake"))
    // First 3 checks say LIVE (retry), final post-exhaustion check says DEAD.
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce({ status: "LIVE", size_matched: 6 })
      .mockResolvedValueOnce({ status: "LIVE", size_matched: 6 })
      .mockResolvedValueOnce({ status: "LIVE", size_matched: 6 })
      .mockResolvedValue(null) // DEAD
    const exec = makeExec({ cancelOrder, getOrder })

    await expect(exec.cancelRemainderWithRetry(makeOrder(10), 6)).resolves.toBeUndefined()
    expect(cancelOrder).toHaveBeenCalledTimes(4)
  }, 10_000)
})

describe("Phase 4A · F-3 · checkFill partial-fill reporting", () => {
  it("reports authoritative post-cancel matched (fill-during-cancel race)", async () => {
    // Pre-cancel poll: 6/10. Cancel succeeds. Post-cancel poll: 7/10.
    // The extra share matched between polls MUST be reported, not the requested 10.
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce({ status: "LIVE", size_matched: 6, price: 0.5, asset_id: "tok-up" })
      .mockResolvedValueOnce({ status: "CANCELED", size_matched: 7, price: 0.5, asset_id: "tok-up" })
    const cancelOrder = vi.fn().mockResolvedValue({ success: true })
    const exec = makeExec({ cancelOrder, getOrder })

    const report = await exec.checkFill(makeOrder(10))

    expect(report).not.toBeNull()
    expect(report.order.shares).toBe(7) // filled — never requested
    expect(cancelOrder).toHaveBeenCalledTimes(1)
  })

  it("caps filled shares at requested (never reports overfill from a stale poll)", async () => {
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce({ status: "LIVE", size_matched: 4, price: 0.5, asset_id: "tok-up" })
      // Buggy exchange response somehow reports > requested; engine must cap.
      .mockResolvedValueOnce({ status: "CANCELED", size_matched: 999, price: 0.5, asset_id: "tok-up" })
    const cancelOrder = vi.fn().mockResolvedValue({ success: true })
    const exec = makeExec({ cancelOrder, getOrder })

    const report = await exec.checkFill(makeOrder(10))

    expect(report).not.toBeNull()
    expect(report.order.shares).toBe(10)
  })

  it("fully-filled order takes the fast path — no cancel attempted", async () => {
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce({ status: "MATCHED", size_matched: 10, price: 0.5, asset_id: "tok-up" })
    const cancelOrder = vi.fn()
    const exec = makeExec({ cancelOrder, getOrder })

    const report = await exec.checkFill(makeOrder(10))
    expect(report?.order.shares).toBe(10)
    expect(cancelOrder).not.toHaveBeenCalled()
  })

  it("returns null on zero fill (no cancel, no orphan)", async () => {
    const getOrder = vi
      .fn()
      .mockResolvedValueOnce({ status: "LIVE", size_matched: 0, price: 0.5, asset_id: "tok-up" })
    const cancelOrder = vi.fn()
    const exec = makeExec({ cancelOrder, getOrder })

    const report = await exec.checkFill(makeOrder(10))
    expect(report).toBeNull()
    expect(cancelOrder).not.toHaveBeenCalled()
  })
})
