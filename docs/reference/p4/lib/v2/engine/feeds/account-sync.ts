import { env } from "../config"
import { logEvent } from "../events"
import type { Executor } from "../execution/executor"
import type { LiveAccountData, LiveAccountPosition } from "../types"

// ------------------------------------------------------------
// LIVE_V2 account mirror.
//
// Assembles a read-only snapshot of the authenticated Polymarket account from
// two OFFICIAL sources and hands it to the engine for the dashboard:
//   • CLOB SDK (via the executor): available USDC, open orders, recent trades.
//   • Public Data API (keyed by wallet address): positions, portfolio value,
//     and PnL — none of which the CLOB SDK exposes.
//
// This NEVER feeds trading logic. It is display-only, fully null-safe, and
// never throws into the caller: any source failure degrades that one field to
// null and is recorded in `errors[]`. Refreshes are always fire-and-forget so
// the 50ms trading loop is never blocked.
//
// Efficiency guarantees (per the spec — "do not poll unnecessarily"):
//   • A hard MIN_REST_INTERVAL floor coalesces bursts into one REST pass.
//   • WS account events call requestRefresh() → a short debounce window batches
//     rapid order/trade/cancel events into a single refresh.
//   • A slow FALLBACK_POLL only fires as a safety net if nothing else refreshed
//     recently (e.g. the User WebSocket is down).
//
// Phase 6B (F-1, F-2):
//   • Malformed POLY_PROXY_ADDRESS → Data-API polling is disabled entirely and
//     the reason is logged once at boot instead of producing a warn every 30s.
//   • Persistent HTTP 400 from /positions or /value → the Data-API side of the
//     sync is placed in a "cold" state: positions cached as [] and portfolio
//     value cached as 0 (both are the correct display for an uninitialised
//     wallet), Data-API calls back off to DATA_API_COLD_INTERVAL_MS, and the
//     transition is logged exactly once. A subsequent non-400 response
//     restores the hot cadence and logs the recovery.
// ------------------------------------------------------------

/** Never issue REST syncs more often than this (except the very first). */
const MIN_REST_INTERVAL_MS = 4_000
/** Coalesce window for WS-triggered refreshes. */
const WS_DEBOUNCE_MS = 1_500
/** Safety poll — only refreshes if the cache is older than this. */
const FALLBACK_POLL_MS = 30_000
/** Per-request timeout for the public Data API. */
const DATA_API_TIMEOUT_MS = 8_000
/** How long the Data-API side of the sync stays cold after a 400. */
const DATA_API_COLD_INTERVAL_MS = 5 * 60_000
/** Fields with no official retrieval path keyed by wallet address. */
const UNAVAILABLE_FIELDS = ["username"] as const
/** Canonical Ethereum address shape used by the Polymarket Data API. */
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/

type FetchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: number | null; reason: string }

async function fetchJsonSafe<T>(url: string, timeoutMs: number): Promise<FetchOutcome<T>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" })
    if (!res.ok) {
      return { ok: false, status: res.status, reason: `HTTP ${res.status}` }
    }
    const value = (await res.json()) as T
    return { ok: true, value }
  } catch (e) {
    return { ok: false, status: null, reason: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

type RawPosition = {
  conditionId?: string
  asset?: string
  title?: string
  outcome?: string
  size?: number
  avgPrice?: number
  curPrice?: number
  currentValue?: number
  initialValue?: number
  cashPnl?: number
  percentPnl?: number
  realizedPnl?: number
  redeemable?: boolean
}

export function isValidFunderAddress(addr: string | null | undefined): addr is string {
  return typeof addr === "string" && ADDRESS_REGEX.test(addr)
}

export class AccountSync {
  private cache: LiveAccountData | null = null
  private lastSyncMs = 0
  private syncing = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private fallbackTimer: ReturnType<typeof setInterval> | null = null
  private stopped = true

  // Data-API state machine (F-1). "cold" means /positions and /value are
  // suppressed until DATA_API_COLD_INTERVAL_MS has elapsed since the last
  // attempt. This prevents a permanent 30-second warn loop against an
  // uninitialised wallet without hiding the failure entirely.
  private dataApiCold = false
  private dataApiLastAttemptMs = 0
  // Set once at construction; if false, Data-API polling is skipped
  // permanently for this session (F-2 malformed-address gate).
  private readonly addressPollable: boolean
  private addressLoggedOnce = false

  constructor(
    private readonly executor: Executor,
    private readonly dataApiHost: string = env.DATA_API_HOST,
  ) {
    const addr = this.executor.getFunderAddress?.() ?? null
    this.addressPollable = isValidFunderAddress(addr)
  }

  /** Latest cached account snapshot (null until the first sync completes). */
  get(): LiveAccountData | null {
    return this.cache
  }

  /** Begin the safety-net poll and kick off an immediate first sync. */
  start(): void {
    this.stopped = false
    if (!this.addressPollable && !this.addressLoggedOnce) {
      this.addressLoggedOnce = true
      const addr = this.executor.getFunderAddress?.() ?? null
      logEvent(
        "warn",
        `[LIVE_V2] account sync: Data-API polling disabled — funder address ${addr === null ? "is null" : `"${addr}" does not match /^0x[0-9a-fA-F]{40}$/`}. CLOB balance/orders/trades will still populate.`,
      )
    }
    void this.refresh("start", true)
    if (!this.fallbackTimer) {
      this.fallbackTimer = setInterval(() => {
        // Only poll if nothing refreshed us recently (WS covers the hot path).
        if (Date.now() - this.lastSyncMs >= FALLBACK_POLL_MS) void this.refresh("fallback")
      }, FALLBACK_POLL_MS)
    }
  }

  /** Stop timers and clear transient state. Cache is retained for display. */
  stop(): void {
    this.stopped = true
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer)
      this.fallbackTimer = null
    }
  }

  /**
   * Ask for a refresh in response to an event (WS order/trade/cancel, a new
   * slot, etc.). Debounced so a burst of events triggers a single REST pass.
   */
  requestRefresh(reason: string): void {
    if (this.stopped) return
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.refresh(reason)
    }, WS_DEBOUNCE_MS)
  }

  /**
   * Pull every source in parallel and rebuild the cache. Guarded against
   * overlap and throttled to MIN_REST_INTERVAL_MS unless `force` is set.
   * Never throws.
   */
  async refresh(reason: string, force = false): Promise<void> {
    if (this.stopped && !force) return
    if (this.syncing) return
    if (!force && Date.now() - this.lastSyncMs < MIN_REST_INTERVAL_MS) return
    this.syncing = true

    const errors: string[] = []
    const address = this.executor.getFunderAddress?.() ?? null
    const now = Date.now()

    // F-1 + F-2: decide whether the Data-API portion runs this cycle.
    //   • Address must be pollable (well-formed).
    //   • If we're in the cold state, throttle to DATA_API_COLD_INTERVAL_MS.
    const dataApiEligible =
      this.addressPollable &&
      (!this.dataApiCold || now - this.dataApiLastAttemptMs >= DATA_API_COLD_INTERVAL_MS)

    const positionsPromise: Promise<FetchOutcome<RawPosition[]> | null> = dataApiEligible
      ? fetchJsonSafe<RawPosition[]>(
          `${this.dataApiHost}/positions?user=${address}&sizeThreshold=0.1&limit=100&sortBy=CURRENT&sortDirection=DESC`,
          DATA_API_TIMEOUT_MS,
        )
      : Promise.resolve(null)

    const valuePromise: Promise<FetchOutcome<Array<{ value?: number }>> | null> = dataApiEligible
      ? fetchJsonSafe<Array<{ value?: number }>>(
          `${this.dataApiHost}/value?user=${address}`,
          DATA_API_TIMEOUT_MS,
        )
      : Promise.resolve(null)

    const [balanceR, ordersR, tradesR, positionsR, valueR] = await Promise.allSettled([
      this.executor.getAvailableBalanceUsd?.() ?? Promise.resolve(null),
      this.executor.getOpenOrdersLive?.() ?? Promise.resolve([]),
      this.executor.getRecentTradesLive?.() ?? Promise.resolve([]),
      positionsPromise,
      valuePromise,
    ])

    if (dataApiEligible) this.dataApiLastAttemptMs = now

    const availableUsd = balanceR.status === "fulfilled" ? balanceR.value : null
    if (balanceR.status === "rejected") errors.push(`balance: ${String(balanceR.reason)}`)

    const openOrders = ordersR.status === "fulfilled" ? ordersR.value : []
    if (ordersR.status === "rejected") errors.push(`openOrders: ${String(ordersR.reason)}`)

    const recentTrades = tradesR.status === "fulfilled" ? tradesR.value : []
    if (tradesR.status === "rejected") errors.push(`trades: ${String(tradesR.reason)}`)

    // ------- Data-API positions -------
    let positions: LiveAccountPosition[] = []
    let totalUnrealizedPnl: number | null = null
    let totalRealizedPnl: number | null = null
    let positionsOutcome: FetchOutcome<RawPosition[]> | null = null
    if (positionsR.status === "fulfilled") positionsOutcome = positionsR.value

    if (positionsOutcome?.ok && Array.isArray(positionsOutcome.value)) {
      positions = positionsOutcome.value.map((p) => ({
        conditionId: String(p.conditionId ?? ""),
        asset: String(p.asset ?? ""),
        title: String(p.title ?? ""),
        outcome: String(p.outcome ?? ""),
        size: Number(p.size ?? 0),
        avgPrice: Number(p.avgPrice ?? 0),
        curPrice: Number(p.curPrice ?? 0),
        currentValue: Number(p.currentValue ?? 0),
        initialValue: Number(p.initialValue ?? 0),
        cashPnl: Number(p.cashPnl ?? 0),
        percentPnl: Number(p.percentPnl ?? 0),
        realizedPnl: Number(p.realizedPnl ?? 0),
        redeemable: Boolean(p.redeemable),
      }))
      totalUnrealizedPnl = positions.reduce((s, p) => s + (Number.isFinite(p.cashPnl) ? p.cashPnl : 0), 0)
      totalRealizedPnl = positions.reduce((s, p) => s + (Number.isFinite(p.realizedPnl) ? p.realizedPnl : 0), 0)
    } else if (positionsOutcome && !positionsOutcome.ok) {
      // Only record as an error if it wasn't a "cold" empty-account 400.
      if (positionsOutcome.status !== 400) {
        errors.push(`positions: ${positionsOutcome.reason}`)
      }
    }

    // ------- Data-API portfolio value -------
    let portfolioValueUsd: number | null = null
    let valueOutcome: FetchOutcome<Array<{ value?: number }>> | null = null
    if (valueR.status === "fulfilled") valueOutcome = valueR.value
    if (valueOutcome?.ok && Array.isArray(valueOutcome.value) && valueOutcome.value[0]?.value !== undefined) {
      const v = Number(valueOutcome.value[0].value)
      portfolioValueUsd = Number.isFinite(v) ? v : null
    } else if (valueOutcome && !valueOutcome.ok) {
      if (valueOutcome.status !== 400) {
        errors.push(`value: ${valueOutcome.reason}`)
      }
    }

    // ------- Data-API state transitions (F-1) -------
    const dataApiSawHttp400 =
      (positionsOutcome && !positionsOutcome.ok && positionsOutcome.status === 400) ||
      (valueOutcome && !valueOutcome.ok && valueOutcome.status === 400)
    const dataApiSawSuccess =
      (positionsOutcome?.ok ?? false) || (valueOutcome?.ok ?? false)

    if (dataApiEligible && dataApiSawHttp400 && !this.dataApiCold) {
      this.dataApiCold = true
      logEvent(
        "warn",
        `[LIVE_V2] account sync: Data-API returned HTTP 400 for /positions and/or /value — treating as empty/uninitialised wallet. Backing off Data-API polling to every ${Math.round(DATA_API_COLD_INTERVAL_MS / 60_000)} min. CLOB balance/orders/trades unaffected.`,
      )
      // Cache the correct display for an empty wallet.
      if (positionsOutcome && !positionsOutcome.ok && positionsOutcome.status === 400) {
        positions = []
        totalUnrealizedPnl = 0
        totalRealizedPnl = 0
      }
      if (valueOutcome && !valueOutcome.ok && valueOutcome.status === 400) {
        portfolioValueUsd = 0
      }
    } else if (this.dataApiCold && dataApiEligible && dataApiSawSuccess) {
      this.dataApiCold = false
      logEvent(
        "info",
        `[LIVE_V2] account sync: Data-API recovered — resuming normal polling cadence.`,
      )
    } else if (this.dataApiCold && dataApiEligible && dataApiSawHttp400) {
      // Still cold. Keep the caches empty; do NOT re-log.
      if (positionsOutcome && !positionsOutcome.ok && positionsOutcome.status === 400) {
        positions = []
        totalUnrealizedPnl = 0
        totalRealizedPnl = 0
      }
      if (valueOutcome && !valueOutcome.ok && valueOutcome.status === 400) {
        portfolioValueUsd = 0
      }
    }

    // While cold, present the empty-wallet defaults instead of nulls so the
    // dashboard doesn't oscillate between "unknown" and 0.
    if (this.dataApiCold) {
      if (totalUnrealizedPnl === null) totalUnrealizedPnl = 0
      if (totalRealizedPnl === null) totalRealizedPnl = 0
      if (portfolioValueUsd === null) portfolioValueUsd = 0
    }

    this.cache = {
      fetchedAtMs: Date.now(),
      walletAddress: address,
      username: null, // no official API resolves a username by address
      availableUsd,
      portfolioValueUsd,
      totalUnrealizedPnl,
      totalRealizedPnl,
      openOrders,
      positions,
      recentTrades,
      stats: {
        openOrderCount: openOrders.length,
        positionCount: positions.length,
        recentTradeCount: recentTrades.length,
      },
      unavailable: [...UNAVAILABLE_FIELDS],
      errors,
    }
    this.lastSyncMs = Date.now()
    this.syncing = false

    if (errors.length) {
      const errorDetail = errors.map((e) => `  • ${e}`).join("\n")
      const tradingImpact = balanceR.status === "fulfilled" && ordersR.status === "fulfilled" ? "NONE" : "POSSIBLE"
      logEvent(
        "warn",
        `[LIVE_V2] account sync (${reason}) recovered with ${errors.length} source error(s):\n${errorDetail}\nTrading impact: ${tradingImpact}`,
      )
    } else {
      logEvent("info", `[LIVE_V2] account synced (${reason}): $${(availableUsd ?? 0).toFixed(2)} avail, ${positions.length} pos, ${openOrders.length} open`)
    }
  }

  /** Test-only accessors. Not exercised in production paths. */
  _debugState() {
    return {
      dataApiCold: this.dataApiCold,
      addressPollable: this.addressPollable,
      dataApiLastAttemptMs: this.dataApiLastAttemptMs,
    }
  }
}
