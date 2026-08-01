import { NextResponse } from "next/server"
import { checkControlAuth } from "@/lib/v2/engine/api-auth"
import { getEngine } from "@/lib/v2/engine/engine"
import type { PipelineMode, SloSizingMode, TIF, TriggerMode } from "@/lib/v2/engine/types"

export const dynamic = "force-dynamic"

interface ControlBody {
  action:
    | "start"
    | "stop"
    | "set_mode"
    | "set_balance"
    | "set_drift"
    | "set_tif"
    | "set_p1_window"
    | "set_limit_order"
    | "clear_limit_order"
    | "pause_limit_order"
    | "resume_limit_order"
    | "reset_ledger"
    | "kill_switch_engage"
    | "kill_switch_disengage"
    | "set_risk_limits"
  mode?: PipelineMode
  /** kill_switch_engage: optional operator note recorded with the stop. */
  reason?: string
  /** set_risk_limits fields (all optional; only provided values change). */
  maxDailyLossUsd?: number
  maxOrderNotionalUsd?: number
  maxDailyOrders?: number
  maxSharesPerOrder?: number
  amount?: number
  driftUsd?: number
  tif?: TIF
  p1WindowMs?: number
  /** Standing limit order fields (majority side auto-detected, trigger is user-defined) */
  limitPrice?: number
  limitShares?: number
  minPrice?: number
  maxPrice?: number
  triggerPrice?: number
  /** Optional trigger mode; defaults to UPWARD_CROSSING in the engine when omitted. */
  triggerMode?: TriggerMode
  /** Position sizing model; defaults to FIXED_SHARES (legacy) when omitted. */
  sizingMode?: SloSizingMode
  /** Share count | dollar amount | percent of pool, per sizingMode. */
  sizeValue?: number
  /** FINAL entry window in SECONDS before settlement; null/0/omitted = disabled. */
  entryWindowSec?: number | null
  /** Feature toggles — omitted = ON (today's verified behaviour). */
  compounding?: boolean
  useTriggerPrice?: boolean
  useLimitPrice?: boolean
}

/** Reject NaN/Infinity — JSON.parse can't produce them, but belt-and-braces
 *  against proxies or future body sources. Returns undefined for non-finite. */
function finite(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) ? n : undefined
}

export async function POST(req: Request) {
  try {
    // Opt-in shared-secret auth (BOT_CONTROL_TOKEN). No-op when unset.
    const auth = checkControlAuth(req)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, message: auth.message }, { status: 401 })
    }

    const engine = getEngine()
    let body: ControlBody
    try {
      body = (await req.json()) as ControlBody
    } catch {
      return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 })
    }

    let message = "Unknown action"
    switch (body.action) {
    case "start":
      try {
        message = engine.start()
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        console.error("[control] START failed:", err)
        return NextResponse.json(
          { ok: false, message: `Start failed: ${err}`, startup: engine.getStartupState() },
          { status: 400 },
        )
      }
      // Phase 6C — surface a rejected start (engine returned a message but
      // never entered `running`) as a structured 400 with the recorded
      // StartupError so the dashboard can render the failure panel.
      {
        const startup = engine.getStartupState()
        if (!engine.snapshot().running && startup.lastError) {
          return NextResponse.json(
            {
              ok: false,
              message,
              error: {
                code: startup.lastError.code,
                reason: startup.lastError.reason,
                missing: startup.lastError.missing,
                action: startup.lastError.action,
              },
              startup,
            },
            { status: 400 },
          )
        }
      }
      break

    case "stop":
      message = engine.stop()
      break
    case "set_mode":
      // Exactly two pipelines share one engine: PAPER_V1 (simulated execution
      // against live CLOB data) and LIVE_V2 (real money). The only difference
      // is the execution backend — everything upstream is identical.
      if (body.mode !== "PAPER_V1" && body.mode !== "LIVE_V2") {
        return NextResponse.json(
          { ok: false, error: { code: "INVALID_MODE", reason: "Pipeline must be PAPER_V1 or LIVE_V2.", missing: [], action: "Send `mode: 'PAPER_V1'` or `mode: 'LIVE_V2'`." }, message: "Pipeline must be PAPER_V1 or LIVE_V2." },
          { status: 400 },
        )
      }
      message = engine.setMode(body.mode)
      // Phase 6C — if the engine refused a LIVE_V2 hot-swap it recorded a
      // StartupError; surface it verbatim so the dashboard shows the reason.
      {
        const startup = engine.getStartupState()
        if (body.mode === "LIVE_V2" && engine.snapshot().mode !== "LIVE_V2" && startup.lastError) {
          return NextResponse.json(
            {
              ok: false,
              message,
              error: {
                code: startup.lastError.code,
                reason: startup.lastError.reason,
                missing: startup.lastError.missing,
                action: startup.lastError.action,
              },
              startup,
            },
            { status: 400 },
          )
        }
      }
      break

    case "set_balance":
      if (typeof body.amount !== "number") {
        return NextResponse.json({ ok: false, message: "amount required" }, { status: 400 })
      }
      // QA: never report a refusal as a success. The paper bankroll is only
      // writable in PAPER_V1, and a non-positive amount is invalid — both used
      // to return HTTP 200 { ok: true } with a failure message, which the
      // dashboard rendered as a green confirmation.
      if (engine.snapshot().mode !== "PAPER_V1") {
        return NextResponse.json({ ok: false, message: "Balance can only be set in PAPER_V1" }, { status: 400 })
      }
      if (!(body.amount > 0)) {
        return NextResponse.json({ ok: false, message: "Amount must be positive" }, { status: 400 })
      }
      message = engine.setPaperBalance(body.amount)
      break
    case "set_drift":
      if (typeof body.driftUsd === "number") message = engine.setDriftPadding(body.driftUsd)
      else return NextResponse.json({ ok: false, message: "driftUsd required" }, { status: 400 })
      break
    case "set_tif":
      if (body.tif === "1m" || body.tif === "2m" || body.tif === "GTC") message = engine.setTif(body.tif)
      else return NextResponse.json({ ok: false, message: "tif must be 1m, 2m, or GTC" }, { status: 400 })
      break
    case "set_p1_window":
      if (typeof body.p1WindowMs === "number") message = engine.setP1Window(body.p1WindowMs)
      else return NextResponse.json({ ok: false, message: "p1WindowMs required" }, { status: 400 })
      break
    case "set_limit_order": {
      const limitPrice = finite(body.limitPrice)
      const limitShares = finite(body.limitShares)
      const minPrice = finite(body.minPrice)
      const maxPrice = finite(body.maxPrice)
      const triggerPrice = finite(body.triggerPrice)
      if (limitPrice === undefined || limitShares === undefined) {
        return NextResponse.json(
          { ok: false, message: "limitPrice and limitShares must be finite numbers" },
          { status: 400 },
        )
      }
      if (
        body.triggerMode !== undefined &&
        body.triggerMode !== "UPWARD_CROSSING" &&
        body.triggerMode !== "AT_OR_ABOVE"
      ) {
        return NextResponse.json(
          { ok: false, message: "triggerMode must be UPWARD_CROSSING or AT_OR_ABOVE" },
          { status: 400 },
        )
      }
      if (
        body.sizingMode !== undefined &&
        body.sizingMode !== "FIXED_SHARES" &&
        body.sizingMode !== "FIXED_USD" &&
        body.sizingMode !== "PERCENT"
      ) {
        return NextResponse.json(
          { ok: false, message: "sizingMode must be FIXED_SHARES, FIXED_USD, or PERCENT" },
          { status: 400 },
        )
      }
      const sizeValue = finite(body.sizeValue)
      const entryWindowSec =
        body.entryWindowSec === null || body.entryWindowSec === undefined ? null : finite(body.entryWindowSec) ?? null
      message = engine.setLimitOrder(limitPrice, limitShares, minPrice, maxPrice, triggerPrice, body.triggerMode, {
        sizingMode: body.sizingMode,
        sizeValue,
        entryWindowSec,
        compounding: body.compounding,
        useTriggerPrice: body.useTriggerPrice,
        useLimitPrice: body.useLimitPrice,
      })
      // QA: arm() refuses on validation/credential failures and returns the
      // reason as a plain string. Detect the refusal from ENGINE STATE (no
      // order was armed) rather than by parsing the message, and surface it as
      // a real 400 so the UI cannot show a false success.
      if (!engine.snapshot().standingLimitOrder) {
        return NextResponse.json({ ok: false, message }, { status: 400 })
      }
      break
    }
    // QA: pausing/resuming/clearing a standing order that does not exist is a
    // no-op refusal, not a success. Reject it before touching the engine.
    case "clear_limit_order":
    case "pause_limit_order":
    case "resume_limit_order": {
      if (!engine.snapshot().standingLimitOrder) {
        return NextResponse.json({ ok: false, message: "No standing limit order is configured" }, { status: 400 })
      }
      message =
        body.action === "clear_limit_order"
          ? engine.clearLimitOrder()
          : body.action === "pause_limit_order"
            ? engine.pauseLimitOrder()
            : engine.resumeLimitOrder()
      break
    }
    case "reset_ledger":
      message = engine.resetLedger()
      break
    case "kill_switch_engage":
      message = engine.engageKillSwitch(typeof body.reason === "string" ? body.reason : undefined)
      break
    case "kill_switch_disengage":
      message = engine.disengageKillSwitch()
      break
    case "set_risk_limits":
      message = engine.setRiskLimits({
        maxDailyLossUsd: typeof body.maxDailyLossUsd === "number" ? body.maxDailyLossUsd : undefined,
        maxOrderNotionalUsd: typeof body.maxOrderNotionalUsd === "number" ? body.maxOrderNotionalUsd : undefined,
        maxDailyOrders: typeof body.maxDailyOrders === "number" ? body.maxDailyOrders : undefined,
        maxSharesPerOrder: typeof body.maxSharesPerOrder === "number" ? body.maxSharesPerOrder : undefined,
      })
      break
    default:
      return NextResponse.json({ ok: false, message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, message })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error"
    console.error("[control] Control route error:", errorMsg, err)
    return NextResponse.json({ ok: false, message: `Server error: ${errorMsg}` }, { status: 500 })
  }
}
