/**
 * Phase 4C — F-2: Reject `success:true && orderID==null` at placement ack.
 *
 * Scope: LiveExecutor.placeOrder only. No change to SLO, settlement, ledger,
 * bankroll, sizing, replay, or Phase 4A/4B paths.
 *
 * Invariants:
 *   1. Normal success (orderID present) → returns OpenOrder unchanged.
 *   2. success:true but orderID missing → THROWS (F-2 fix).
 *   3. success:true but orderID empty string → THROWS (edge case).
 *   4. Explicit success:false path is unchanged (pre-F-2 error still thrown).
 *   5. Repeated bad acks throw every time (idempotent — no cached state).
 *   6. Stress: N sequential rejections do not leak state (no order tracked).
 *   7. Adjacent field variants (orderId vs orderID) still accepted.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { Wallet } from "ethers"

const throwaway = Wallet.createRandom()
process.env.WALLET_PRIVATE_KEY = throwaway.privateKey
process.env.FUNDER_ADDRESS = "0x000000000000000000000000000000000000dEaD"
process.env.CLOB_API_KEY = "test-key"
process.env.CLOB_SECRET = "test-secret"
process.env.CLOB_PASS_PHRASE = "test-pass"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
let LiveExecutor: Any

beforeAll(async () => {
  ;({ LiveExecutor } = await import("../../lib/v2/engine/execution/live"))
})

function makeReq() {
  return {
    marketId: "m1",
    tokenId: "tok-up",
    side: "UP" as const,
    price: 0.5,
    shares: 10,
    phase: "PRIORITY_1" as const,
  }
}

function makeExec(createAndPostOrder: Any): Any {
  const exec = new LiveExecutor()
  ;(exec as { client: unknown }).client = { createAndPostOrder }
  return exec
}

describe("Phase 4C · F-2 · placeOrder ack validation", () => {
  it("normal success with orderID returns an OpenOrder unchanged", async () => {
    const exec = makeExec(async () => ({ success: true, orderID: "eoid-1" }))
    const order = await exec.placeOrder(makeReq())
    expect(order.exchangeOrderId).toBe("eoid-1")
    expect(order.shares).toBe(10)
  })

  it("accepts alt casing `orderId` (SDK variant) — unchanged behavior", async () => {
    const exec = makeExec(async () => ({ success: true, orderId: "eoid-2" }))
    const order = await exec.placeOrder(makeReq())
    expect(order.exchangeOrderId).toBe("eoid-2")
  })

  it("F-2: success:true with null orderID → throws (no untrackable order)", async () => {
    const exec = makeExec(async () => ({ success: true, orderID: null }))
    await expect(exec.placeOrder(makeReq())).rejects.toThrow(/F-2/)
  })

  it("F-2: success:true with missing orderID field → throws", async () => {
    const exec = makeExec(async () => ({ success: true }))
    await expect(exec.placeOrder(makeReq())).rejects.toThrow(/F-2/)
  })

  it("F-2: success:true with empty-string orderID → throws", async () => {
    const exec = makeExec(async () => ({ success: true, orderID: "" }))
    await expect(exec.placeOrder(makeReq())).rejects.toThrow(/F-2/)
  })

  it("success:false path unchanged — pre-F-2 error still thrown", async () => {
    const exec = makeExec(async () => ({ success: false, errorMsg: "rate limited" }))
    await expect(exec.placeOrder(makeReq())).rejects.toThrow(/CLOB rejected order/)
  })

  it("idempotent: N consecutive bad acks each throw; no state leaked between calls", async () => {
    const exec = makeExec(async () => ({ success: true, orderID: null }))
    for (let i = 0; i < 5; i++) {
      await expect(exec.placeOrder(makeReq())).rejects.toThrow(/F-2/)
    }
  })

  it("stress: alternating good/bad acks — bad throws, good returns; no cross-contamination", async () => {
    let n = 0
    const exec = makeExec(async () => {
      n++
      return n % 2 === 1 ? { success: true, orderID: null } : { success: true, orderID: `ok-${n}` }
    })
    await expect(exec.placeOrder(makeReq())).rejects.toThrow(/F-2/)
    const ok = await exec.placeOrder(makeReq())
    expect(ok.exchangeOrderId).toBe("ok-2")
    await expect(exec.placeOrder(makeReq())).rejects.toThrow(/F-2/)
  })
})
