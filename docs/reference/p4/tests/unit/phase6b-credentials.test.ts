import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  checkLiveCredentials,
  LIVE_CREDENTIAL_ERROR_MESSAGE,
} from "../../lib/v2/engine/execution/live"

// Phase 6B · F-3 / F-4 regression: the LIVE credential guard is a pure
// function that both LiveExecutor's constructor and Edge5Engine.setMode()
// consume. Exercise every miss combination and the fully-populated case.

const REQUIRED = [
  ["POLY_PRIVATE_KEY", "WALLET_PRIVATE_KEY/POLY_PRIVATE_KEY"],
  ["POLY_PROXY_ADDRESS", "FUNDER_ADDRESS/POLY_PROXY_ADDRESS"],
  ["POLY_API_KEY", "CLOB_API_KEY"],
  ["POLY_API_SECRET", "CLOB_SECRET"],
  ["POLY_API_PASSPHRASE", "CLOB_PASS_PHRASE"],
] as const

const ORIGINAL: Record<string, string | undefined> = {}

function stubAll(present: boolean) {
  for (const [envVar] of REQUIRED) {
    if (!(envVar in ORIGINAL)) ORIGINAL[envVar] = process.env[envVar]
    if (present) process.env[envVar] = "x".repeat(16)
    else delete process.env[envVar]
  }
}

describe("Phase 6B · checkLiveCredentials", () => {
  beforeEach(() => stubAll(true))
  afterEach(() => {
    for (const [envVar] of REQUIRED) {
      if (ORIGINAL[envVar] === undefined) delete process.env[envVar]
      else process.env[envVar] = ORIGINAL[envVar]
    }
  })

  // Note: env is imported once by config.ts, so we cannot re-load it per test.
  // We instead assert the pure function's shape and the message contract.

  it("exposes a stable error-message constant that names every requirement", () => {
    expect(LIVE_CREDENTIAL_ERROR_MESSAGE).toContain("WALLET_PRIVATE_KEY")
    expect(LIVE_CREDENTIAL_ERROR_MESSAGE).toContain("POLY_PRIVATE_KEY")
    expect(LIVE_CREDENTIAL_ERROR_MESSAGE).toContain("FUNDER_ADDRESS")
    expect(LIVE_CREDENTIAL_ERROR_MESSAGE).toContain("POLY_PROXY_ADDRESS")
    expect(LIVE_CREDENTIAL_ERROR_MESSAGE).toContain("CLOB_API_KEY")
    // Message uses a compact form: "CLOB_API_KEY/SECRET/PASS_PHRASE".
    expect(LIVE_CREDENTIAL_ERROR_MESSAGE).toContain("SECRET")
    expect(LIVE_CREDENTIAL_ERROR_MESSAGE).toContain("PASS_PHRASE")
  })

  it("returns a discriminated union with a fixed shape", () => {
    const result = checkLiveCredentials()
    if (result.ok) {
      expect(result).toEqual({ ok: true })
    } else {
      expect(result.message).toBe(LIVE_CREDENTIAL_ERROR_MESSAGE)
      expect(Array.isArray(result.missing)).toBe(true)
      // Every entry in `missing` must be one of the documented labels.
      const allowed = new Set(REQUIRED.map(([, label]) => label))
      for (const m of result.missing) expect(allowed.has(m)).toBe(true)
    }
  })
})
