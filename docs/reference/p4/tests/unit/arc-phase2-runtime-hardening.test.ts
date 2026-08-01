/**
 * ARC PHASE 2 — production runtime hardening regression.
 *
 * Covers the three evidence-backed fixes:
 *   R-1  engine is constructed at process boot (instrumentation.register),
 *        so PM2 restart auto-resume no longer waits for an HTTP request.
 *   R-2  the engine's fallback process guards stand down when the richer
 *        instrumentation crash handlers are already installed (no duplicate
 *        uncaughtException handler racing the diagnostics flush).
 *   D-1  the dashboard never auto-issues `set_mode` — viewing/refreshing a
 *        page cannot mutate engine state.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(__dirname, "../..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")

describe("R-1 — engine boots with the process", () => {
  const src = read("instrumentation.ts")

  it("constructs the engine singleton in register()", () => {
    expect(src).toContain('await import("./lib/v2/engine/engine")')
    expect(src).toMatch(/getEngine\(\)/)
  })

  it("never boots the engine during a production build", () => {
    expect(src).toContain('process.env.NEXT_PHASE === "phase-production-build"')
    const guardIdx = src.indexOf("phase-production-build")
    const bootIdx = src.indexOf('await import("./lib/v2/engine/engine")')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(bootIdx)
  })

  it("cannot crash the process when engine construction throws", () => {
    expect(src).toMatch(/try\s*\{[\s\S]*getEngine\(\)[\s\S]*\}\s*catch/)
  })
})

describe("R-2 — single set of process crash handlers", () => {
  const src = read("lib/v2/engine/engine.ts")

  it("stands down when instrumentation handlers are installed", () => {
    const fn = src.slice(src.indexOf("function installProcessGuards"))
    const body = fn.slice(0, fn.indexOf("\n}\n"))
    expect(body).toContain("__edge5CrashHandlersInstalled")
    // The bail-out must precede any process.on registration.
    expect(body.indexOf("__edge5CrashHandlersInstalled")).toBeLessThan(body.indexOf("process.on("))
  })

  it("still registers guards when instrumentation did not run", () => {
    const fn = src.slice(src.indexOf("function installProcessGuards"))
    expect(fn).toContain('process.on("unhandledRejection"')
    expect(fn).toContain('process.on("uncaughtException"')
  })

  it("keeps the process alive on unhandled rejections", () => {
    const fn = src.slice(src.indexOf("function installProcessGuards"))
    const rejection = fn.slice(fn.indexOf('process.on("unhandledRejection"'), fn.indexOf('process.on("uncaughtException"'))
    expect(rejection).not.toContain("process.exit")
  })
})

describe("D-1 — dashboard is read-only on open/refresh", () => {
  const src = read("components/v2/terminal-dashboard.tsx")

  it("has no mount-time auto set_mode effect", () => {
    expect(src).not.toMatch(/useEffect\([\s\S]{0,400}set_mode/)
  })

  it("only issues set_mode from an explicit operator click", () => {
    expect(src).toContain('sendControl({ action: "set_mode"')
    const idx = src.indexOf('sendControl({ action: "set_mode"')
    const fn = src.slice(Math.max(0, idx - 300), idx)
    expect(fn).toContain("switchPipeline")
    expect(src).toMatch(/onClick=\{switchPipeline\}/)
  })

  it("never offers the switch while the engine is running elsewhere", () => {
    expect(src).toContain("!runningElsewhere ? (")
  })
})

describe("dashboard read paths stay side-effect free", () => {
  for (const route of ["status", "analytics", "trades", "system", "health"]) {
    it(`GET /api/v2/bot/${route} performs no writes`, () => {
      const src = read(`app/api/v2/bot/${route}/route.ts`)
      expect(src).not.toContain("kvSet(")
      expect(src).not.toMatch(/\.(start|stop|setMode|reset|settle)\(/)
    })
  }
})
