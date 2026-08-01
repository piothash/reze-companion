// Phase 6D regression test — incremental accounting sweep with a
// KV-persisted watermark. Verifies that after a full initial sweep, a
// second sweep processes only newly-settled rows and that Identity B
// (balance-chain continuity) still holds across the boundary.

import { describe, expect, it } from "vitest"

// Minimal KV shim mirroring the acctverify:* keys the verifier reads.
type Row = { id: number; balance_after: number; pnl: number; status: string; result: string; shares: number; cost: number; mode: string }
class MemKV {
  private m = new Map<string, string>()
  get(k: string) { return this.m.get(k) ?? null }
  set(k: string, v: string) { this.m.set(k, v) }
}

// Reproduces the Phase 6D incremental sweep decision (isolated so the test
// does not require an initialised SQLite for a shared library import).
function sweep(
  rowsAll: Row[],
  mode: string,
  kv: MemKV,
): { checked: number; identityBChainOk: boolean; watermarkAfter: number; prevAfter: number | null } {
  const wKey = `acctverify:${mode}:watermark_id`
  const pKey = `acctverify:${mode}:prev_balance`
  const wRaw = kv.get(wKey)
  const hasW = typeof wRaw === "string" && wRaw.length > 0
  const wId = hasW ? Number(wRaw) : 0
  const settled = rowsAll.filter((r) => r.status === "SETTLED" && r.mode === mode).sort((a, b) => a.id - b.id)
  const rows = hasW && wId > 0 ? settled.filter((r) => r.id > wId) : settled
  const pRaw = hasW ? kv.get(pKey) : null
  let prev: number | null = pRaw !== null && Number.isFinite(Number(pRaw)) ? Number(pRaw) : null
  let last = wId
  let ok = true
  for (const r of rows) {
    if (prev !== null) {
      const delta = Math.round((r.balance_after - prev) * 10000) / 10000
      if (Math.abs(delta - r.pnl) > 0.01) ok = false
    }
    prev = r.balance_after
    if (r.id > last) last = r.id
  }
  if (last > wId && prev !== null) {
    kv.set(wKey, String(last))
    kv.set(pKey, String(prev))
  }
  return { checked: rows.length, identityBChainOk: ok, watermarkAfter: last, prevAfter: prev }
}

const mkRow = (id: number, balAfter: number, pnl: number): Row => ({
  id, balance_after: balAfter, pnl, status: "SETTLED", result: pnl >= 0 ? "WIN" : "LOSS",
  shares: 10, cost: 5, mode: "PAPER_V1",
})

describe("Phase 6D — incremental accounting sweep", () => {
  it("first sweep after boot processes every settled row", () => {
    const kv = new MemKV()
    const rows = [mkRow(1, 105, 5), mkRow(2, 100, -5), mkRow(3, 110, 10)]
    const r = sweep(rows, "PAPER_V1", kv)
    expect(r.checked).toBe(3)
    expect(r.identityBChainOk).toBe(true)
    expect(r.watermarkAfter).toBe(3)
    expect(kv.get("acctverify:PAPER_V1:watermark_id")).toBe("3")
    expect(kv.get("acctverify:PAPER_V1:prev_balance")).toBe("110")
  })

  it("second sweep processes only new rows", () => {
    const kv = new MemKV()
    const initial = [mkRow(1, 105, 5), mkRow(2, 100, -5)]
    sweep(initial, "PAPER_V1", kv)
    const later = [...initial, mkRow(3, 110, 10), mkRow(4, 108, -2)]
    const r = sweep(later, "PAPER_V1", kv)
    expect(r.checked).toBe(2)
    expect(r.identityBChainOk).toBe(true)
    expect(r.watermarkAfter).toBe(4)
  })

  it("Identity B chain continuity holds across sweep boundary", () => {
    const kv = new MemKV()
    sweep([mkRow(1, 100, 0), mkRow(2, 105, 5)], "PAPER_V1", kv)
    // Next row's balance_after − prev_balance MUST equal its pnl.
    const good = sweep([mkRow(1, 100, 0), mkRow(2, 105, 5), mkRow(3, 110, 5)], "PAPER_V1", kv)
    expect(good.identityBChainOk).toBe(true)
  })

  it("Identity B chain break is detected across sweep boundary", () => {
    const kv = new MemKV()
    sweep([mkRow(1, 100, 0), mkRow(2, 105, 5)], "PAPER_V1", kv)
    // Row 3 claims pnl +5 but balance jumped +20 — chain break.
    const bad = sweep([mkRow(1, 100, 0), mkRow(2, 105, 5), mkRow(3, 125, 5)], "PAPER_V1", kv)
    expect(bad.identityBChainOk).toBe(false)
  })

  it("no new rows: sweep is a no-op and watermark is unchanged", () => {
    const kv = new MemKV()
    const rows = [mkRow(1, 100, 0), mkRow(2, 105, 5)]
    sweep(rows, "PAPER_V1", kv)
    const before = kv.get("acctverify:PAPER_V1:watermark_id")
    const r = sweep(rows, "PAPER_V1", kv)
    expect(r.checked).toBe(0)
    expect(kv.get("acctverify:PAPER_V1:watermark_id")).toBe(before)
  })
})
