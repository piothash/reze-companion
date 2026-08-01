import { NextResponse } from "next/server"
import { checkControlAuth } from "@/lib/v2/engine/api-auth"

export const dynamic = "force-dynamic"

/**
 * Phase 6C — read-only credential presence diagnostics.
 *
 * Returns the PRESENCE (boolean) of each configuration item required for the
 * LIVE_V2 pipeline. Values are NEVER read, echoed, or hashed — the operator
 * must consult the VPS filesystem for actual secrets. This endpoint exists so
 * the dashboard can show a missing/present matrix without scraping logs.
 *
 * Reads `process.env` directly (not the parsed `env` object) so a startup-
 * time parse failure in the engine graph does not blank the diagnostics.
 */
const REQUIRED: { name: string; env: readonly string[]; description: string }[] = [
  {
    name: "WALLET_PRIVATE_KEY",
    env: ["WALLET_PRIVATE_KEY", "POLY_PRIVATE_KEY"],
    description: "Signer key for the wallet that owns the Polymarket proxy.",
  },
  {
    name: "FUNDER_ADDRESS",
    env: ["FUNDER_ADDRESS", "POLY_PROXY_ADDRESS"],
    description: "The Polymarket proxy (funder) address matching the signer.",
  },
  {
    name: "CLOB_API_KEY",
    env: ["CLOB_API_KEY", "POLY_API_KEY"],
    description: "CLOB REST API key issued by Polymarket for this wallet.",
  },
  {
    name: "CLOB_API_SECRET",
    env: ["CLOB_API_SECRET", "POLY_API_SECRET"],
    description: "CLOB REST API secret paired with the API key.",
  },
  {
    name: "CLOB_API_PASSPHRASE",
    env: ["CLOB_API_PASSPHRASE", "POLY_API_PASSPHRASE"],
    description: "CLOB REST API passphrase paired with the API key.",
  },
]

function present(names: readonly string[]): boolean {
  for (const n of names) {
    const v = process.env[n]
    if (typeof v === "string" && v.length > 0) return true
  }
  return false
}

export async function GET(req: Request) {
  const auth = checkControlAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: auth.message }, { status: 401 })
  }
  const items = REQUIRED.map((r) => ({
    name: r.name,
    present: present(r.env),
    envVarsChecked: r.env,
    description: r.description,
  }))
  const allPresent = items.every((i) => i.present)
  return NextResponse.json({
    ok: true,
    liveReady: allPresent,
    items,
    missing: items.filter((i) => !i.present).map((i) => i.name),
    generatedAtMs: Date.now(),
  })
}
