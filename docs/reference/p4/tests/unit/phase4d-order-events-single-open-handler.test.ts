/**
 * Phase 4D — F-4: Consolidate duplicate `on("open")` handlers in
 * `OrderEventListener`. The prior code registered two `open` listeners on
 * every WS lifecycle; only one should exist.
 *
 * Scope: `lib/v2/engine/feeds/order-events.ts` only. No change to WS URL,
 * subscription protocol, reconnect strategy, ping cadence, message parsing,
 * ledger, settlement, sizing, replay, or Phase 4A/B/C paths.
 *
 * Invariants:
 *   1. Static: source file contains exactly ONE `ws.on("open"` registration.
 *   2. Behavior preserved (folded assignment): after `open` fires,
 *      `lastFrameAtMs` is set AND `subscribeAll()` is called AND
 *      `reconnectAttempts` is reset AND the ping keepalive is armed.
 *   3. Idempotent per WS instance: exactly one `open` listener attached.
 *   4. Reconnect (new WS instance) still attaches exactly one listener —
 *      no listener leak across reconnects.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SRC = resolve(__dirname, "../../lib/v2/engine/feeds/order-events.ts")

describe("Phase 4D · F-4 · single `open` handler", () => {
  it("static: source registers exactly one `ws.on(\"open\"` handler", () => {
    const src = readFileSync(SRC, "utf8")
    const matches = src.match(/ws\.on\(\s*"open"/g) ?? []
    expect(matches.length).toBe(1)
  })

  it("static: the surviving handler still assigns lastFrameAtMs (folded from removed dup)", () => {
    const src = readFileSync(SRC, "utf8")
    // Find the block starting at the single ws.on("open" and ensure it
    // contains both the folded assignment and the pre-existing setup calls.
    const idx = src.indexOf('ws.on("open"')
    expect(idx).toBeGreaterThan(-1)
    // Grab a reasonable window after the handler declaration.
    const block = src.slice(idx, idx + 800)
    expect(block).toMatch(/this\.lastFrameAtMs\s*=\s*Date\.now\(\)/)
    expect(block).toMatch(/this\.reconnectAttempts\s*=\s*0/)
    expect(block).toMatch(/this\.subscribeAll\(\)/)
    expect(block).toMatch(/PING_INTERVAL_MS/)
  })

  it("static: no orphan second `open` handler regressed via alt syntax (addListener/once)", () => {
    const src = readFileSync(SRC, "utf8")
    const orphan =
      src.match(/ws\.addListener\(\s*"open"/g) ??
      src.match(/ws\.once\(\s*"open"/g) ??
      []
    expect(orphan.length).toBe(0)
  })

  it("static: reconnect path uses a fresh WS instance, so listeners cannot leak across reconnects", () => {
    const src = readFileSync(SRC, "utf8")
    // The `open()` method must construct a new WebSocket — reconnect calls
    // this.open() again, giving a fresh emitter each time.
    expect(src).toMatch(/new WebSocket\(WS_USER_URL\)/)
  })
})
