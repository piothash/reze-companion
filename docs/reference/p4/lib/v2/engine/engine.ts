// Side-effect import: installs the tuned keep-alive HTTP dispatcher for the
// whole process before any feed makes a fetch. Must be first.
import "./http-agent"
// Side-effect: patches global fetch + WS to route through HTTPS_PROXY or SOCKS5_PROXY
// when set in .env. No-op when env vars are absent.
import { applyGlobalProxyPatch } from "./proxy"
applyGlobalProxyPatch()
import { startTrace, recordPoint, completeTrace } from "./latency-trace"
import { Bankroll } from "./bankroll"
import { clockOffsetMs, clockSynced, currentSlotEndMs, marketIdForSlot, startClockSync, tMinusMs } from "./clock"
import { DEFAULT_STRATEGY, SLOT_MS, env } from "./config"
import { clearLedger, closeOrphanedOpenTrades, feedStats, insertOrderLog, insertTrade, kvGet, kvSet, openTrade, runDbMaintenance, settleTrade, tradeStats, updateSettledBalance } from "./db"
import { randomUUID } from "node:crypto"
import * as dtrace from "./diag/direction-trace"
import { checkAccountingInvariant } from "./handlers/accounting-invariant"
import { logEvent, recentEvents } from "./events"
import { PaperExecutor } from "./execution/paper"
import { checkLiveCredentials } from "./execution/live"
import type { Executor } from "./execution/executor"
import { MarketDiscovery, type DiscoveredMarket } from "./feeds/market-discovery"
import { makeBtcReferenceFeed } from "./feeds/btc-reference-feed"
import { ClobPriceFeed } from "./feeds/clob-price-feed"
import { getOrderEventListener, closeOrderEventListener } from "./feeds/order-events"
import { AccountSync } from "./feeds/account-sync"
import { tokenPrices } from "./market-model"
import { phaseFor } from "./phase"
import { evaluateOracleGuard } from "./handlers/oracle-sync-guard"
import { classifyCancelReplace } from "./handlers/cancel-replace-pipeline"
import { validateOrderSize } from "./handlers/protocol-validator"
import { buildOrphanCounter, detectOrphan } from "./handlers/orphan-cleaner"
import { Reconciler } from "./reconciler"
import { startAccountingVerifier, stopAccountingVerifier, getLastAccountingAudit } from "./accounting-verifier"
import { stopSettlementVerifier } from "./settlement-verifier"
import { RiskManager, type RiskLimits } from "./risk"
import { Watchdog } from "./watchdog"
import { StandingOrderManager } from "./standing-order"
import { getTelegram } from "./telegram"
import { initNotifier, notify } from "./notifier"
import type { EnginePhase, EngineSnapshot, OpenOrder, PipelineMode, SloSizingMode, StartupError, StartupState, StrategyConfig, TIF, TradeSide, TriggerMode } from "./types"

// ------------------------------------------------------------
// Edge 5 Engine — the orchestrator singleton.
// Runs a 50ms decision loop over the NTP-synced candle clock,
// pipes standing-limit-order execution into the hot-swappable executor, and
// settles/compounds at every 5-minute expiry.
// ------------------------------------------------------------

// --- Settlement resolution (single source of truth = official Polymarket) ---
// Phase 2 hardening: the ONLY authoritative settlement is the official
// Chainlink-resolved Polymarket outcome. When it is not yet published the
// trade settles as SCRATCH (cost refunded, zero PnL) — a temporary state
// that the settlement-verifier upgrades to the true WIN/LOSS as soon as
// the resolution appears. The former "spot-fallback" heuristic has been
// removed from the primary settlement path because it violated the "never
// guess / never infer" invariant of Phase 2.
//
// 100 × 3s = 300s (5 min) of patience before falling through to SCRATCH-
// pending. Gamma's closed flag typically flips 15-30 s post-close; the
// extended window keeps the SCRATCH-then-repair path exceptional rather
// than routine. Both constants may be overridden per deployment via env.
const RESOLUTION_ATTEMPTS = Number(process.env.P4_RESOLUTION_ATTEMPTS ?? 100)
const RESOLUTION_POLL_MS = Number(process.env.P4_RESOLUTION_POLL_MS ?? 3_000)
// Retained only for legacy computeSpotFallback() callers/tests — the value
// is no longer consulted from settleOfficial (spot-fallback was retired).
const FALLBACK_MIN_MARGIN_USD = 20

interface FilledPosition {
  side: TradeSide
  price: number
  shares: number
  cost: number
  dust: number
  marketId: string
  slotEndMs: number
  // Phase 1 · Stage 1A · P-3 fix — the engine path now writes an OPEN ledger
  // row on fill (mirroring the SLO path) so a crash-during-position is
  // refunded by closeOrphanedOpenTrades() at boot instead of silently losing
  // the debited cost. Nullable so an unexpected DB failure at fill time
  // degrades gracefully to the pre-fix insertTrade-at-settle path.
  tradeId: number | null
  tradeUid: string | null
}

export class Edge5Engine {
  // V2 stack is pinned to live trading. This engine copy lives in lib/v2
  // and is fully independent from the V1 (paper) stack in lib/v1.
  mode: PipelineMode = "LIVE_V2"

  /** Namespace a shared kv key to THIS stack so V1 and V2 never collide in the
   *  shared sqlite kv table (trades are already namespaced by the mode column). */
  private nsKey(key: string): string {
    return `${key}:${this.mode}`
  }
  running = false
  cfg: StrategyConfig = { ...DEFAULT_STRATEGY }

  // BTC reference price feed (Chainlink, display + paper-settlement only).
  // Contract prices come exclusively from the Polymarket CLOB feed below.
  private spotFeed = makeBtcReferenceFeed()
  private clobPriceFeed = new ClobPriceFeed()
  private discovery = new MarketDiscovery()
  private market: DiscoveredMarket | null = null
  private executor: Executor | null = null
  private loop: ReturnType<typeof setInterval> | null = null
  private busy = false
  /**
   * LIVE_V2 read-only account mirror (balance/orders/trades/positions/value).
   * Null in PAPER_V1. Populated lazily when the live executor is built.
   */
  private accountSync: AccountSync | null = null

  // Phase 6B F-3: dedupe consecutive LIVE credential-miss log lines. First
  // failure emits at `error`; retries within the window emit at `warn` with
  // an attempt counter to make it obvious the loop isn't a background retry.
  private credentialErrorLastMs = 0
  private credentialErrorAttempts = 0
  private static readonly CREDENTIAL_ERROR_DEDUPE_MS = 60_000
  private static LAST_CREDENTIAL_ERROR_MSG = ""

  // Phase 6C — startup lifecycle telemetry surfaced to the dashboard.
  private startupLastAttemptMs: number | null = null
  private startupLastSuccessMs: number | null = null
  private startupLastFailureMs: number | null = null
  private startupLastError: StartupError | null = null


  private slotEndMs = 0
  private strike: number | null = null
  /**
   * ROLLOVER BARRIER — the engine's market-transition state machine.
   * At every slot rollover the engine enters ROLLING_OVER and stays there
   * until ALL of the following hold for the NEW slot:
   *   1. the new market is discovered (this.market matches this.slotEndMs)
   *   2. token ids are verified (pushed into the price feed → new generation)
   *   3. the websocket is subscribed to the new tokens
   *   4. the first VALIDATED quote pair of the new generation has arrived
   * While ROLLING_OVER, no strategy decision or fill evaluation runs — the
   * engine can never trade the gap between two markets on leftover state.
   * Starts as ROLLING_OVER: a freshly-ignited engine must also prove the
   * pipeline end-to-end before its first decision.
   */
  private rolloverState: "LIVE" | "ROLLING_OVER" = "ROLLING_OVER"
  private rolloverStartedAtMs = 0
  private lastRolloverLogMs = 0
  private openOrder: OpenOrder | null = null
  private position: FilledPosition | null = null
  private lastCancelReplaceMs: number | null = null
  private pendingResolutions = 0
  private lastTickErrorMsg = ""
  private lastTickErrorAtMs = 0
  private lastTickStartMs = 0

  bankroll = new Bankroll(this.mode)

  /** Mandatory pre-order risk gate — kill switch, daily-loss breaker,
   *  notional/order-rate caps, price + share sanity. Every order routes
   *  through it. */
  readonly risk = new RiskManager(() => this.mode)

  /** Read-only exchange-truth reconciler (LIVE_V2, runs while ignited).
   *  Flags untracked live orders, missing tracked orders, wallet drift. */
  private reconciler = new Reconciler({
    getExecutor: () => this.executor,
    getTrackedOrders: () => {
      const tracked: OpenOrder[] = []
      if (this.openOrder) tracked.push(this.openOrder)
      const slo = this.standingOrders?.trackedRestingOrder
      if (slo) tracked.push(slo)
      return tracked
    },
    getLocalBalanceUsd: () => this.bankroll.balance,
    // Both pipelines reconcile against their execution backend's account
    // mirror (real exchange in LIVE_V2, simulated exchange in PAPER_V1).
    isLive: () => true,
    isRunning: () => this.running,
  })

  /**
   * Independent standing limit order subsystem. Runs on its own loop,
   * fully decoupled from this engine's tick loop and the Time Window /
   * phase machine. Instantiated in the constructor.
   */
  private standingOrders!: StandingOrderManager

  /** Self-healing watchdog (process-lifetime; started in the constructor). */
  watchdog!: Watchdog

  constructor() {
    // Restore the persisted pipeline mode FIRST — everything below (orphan
    // cleanup namespace, bankroll, standing orders) depends on it. A restart
    // must never flip a PAPER_V1 session into LIVE_V2 real-money mode.
    // Legacy migration: sessions persisted as "SHADOW_V2" (the retired
    // validation pipeline) map onto PAPER_V1, its direct successor.
    let savedMode = kvGet("v2:pipeline-mode")
    if (savedMode === "SHADOW_V2") {
      savedMode = "PAPER_V1"
      kvSet("v2:pipeline-mode", savedMode)
    }
    if (savedMode === "LIVE_V2" || savedMode === "PAPER_V1") {
      this.mode = savedMode
      if (this.mode === "PAPER_V1") {
        this.bankroll = new Bankroll(this.mode)
        if (this.bankroll.startingBalance === 0) this.bankroll.reset(env.PAPER_STARTING_BALANCE)
      }
    }
    startClockSync()
    // Restart recovery: any ledger row still OPEN belongs to a previous
    // process whose in-memory position was lost — it can never be settled by
    // the normal path. Close them as SCRATCH so history never leaks
    // permanently-open rows across crashes/PM2 restarts/deploys.
    closeOrphanedOpenTrades()
    this.spotFeed.start()
    this.clobPriceFeed.start()
    // Standing limit order is the single execution engine.
    this.standingOrders = new StandingOrderManager({
      getMode: () => this.mode,
      getBankroll: () => this.bankroll,
      discovery: this.discovery,
      clobPriceFeed: this.clobPriceFeed,
      spotFeed: this.spotFeed,
      risk: this.risk,
    })
    this.restoreConfig()
    if (this.bankroll.startingBalance === 0 && this.mode === "PAPER_V1") {
      this.bankroll.reset(env.PAPER_STARTING_BALANCE)
    }
    getTelegram(this)
    // One-way operations notifier (category-gated Telegram push). Separate
    // from the interactive control bot above; boot-once via global singleton.
    initNotifier()
    // Self-healing layer: zombie-WS detection, stale-quote recovery, memory
    // monitoring. Lives for the process lifetime (the feeds it protects start
    // in this constructor and also run regardless of ignition state).
    this.watchdog = new Watchdog({
      clobPriceFeed: this.clobPriceFeed,
      getOrderEvents: () => getOrderEventListener(),
      isTrackingMarket: () => this.clobPriceFeed.diagnostics().upTokenId !== null,
      // SLO tick-loop liveness: detects a wedged timer chain / permanently
      // stuck busy flag while an order is armed, and restarts it (repair
      // only — the kick never touches order state).
      getSloHealth: () => this.standingOrders?.getLoopHealth() ?? null,
      kickSlo: (reason) => this.standingOrders?.kickLoop(reason),
    })
    this.watchdog.start()
    // DB hygiene for months-long operation: prune old order_log rows and
    // truncate the WAL once a day (runs shortly after boot, then every 24h).
    this.dbMaintenanceTimer = setInterval(() => this.runDbMaintenanceSafe(), 24 * 3_600_000)
    // Tracked so dispose() before the 60s mark can't fire a late maintenance
    // pass (a synchronous VACUUM INTO) against a torn-down engine.
    this.dbKickoffTimer = setTimeout(() => this.runDbMaintenanceSafe(), 60_000)
    logEvent("info", `Edge 5 engine initialized in ${this.mode} (bot stopped, awaiting ignition)`)
    this.maybeAutoResume()
  }

  private dbMaintenanceTimer: ReturnType<typeof setInterval> | null = null
  private dbKickoffTimer: ReturnType<typeof setTimeout> | null = null

  private runDbMaintenanceSafe() {
    try {
      logEvent("info", `[DB] maintenance: ${runDbMaintenance()}`)
    } catch (e) {
      logEvent("warn", `[DB] maintenance failed: ${(e as Error).message}`)
    }
  }

  /**
   * Daemon resilience: if the process died (PM2 restart, deploy,
   * crash) while the bot was running, re-arm automatically after a
   * short grace period so the feeds and clock have time to connect.
   */
  private maybeAutoResume() {
    if (kvGet(this.nsKey("engine:running")) !== "1") return
    logEvent("warn", "Previous session was running — auto-resuming ignition in 5s (PM2 restart recovery)")
    setTimeout(() => {
      if (!this.running) {
        const msg = this.start()
        logEvent("info", `Auto-resume: ${msg}`)
      }
    }, 5_000)
  }

  // ---------- persistence of runtime config ----------

  private restoreConfig() {
    const saved = kvGet(this.nsKey("strategy:config"))
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<StrategyConfig>
        this.cfg = { ...this.cfg, ...parsed }
      } catch {
        /* keep defaults */
      }
    }
  }

  private persistConfig() {
    kvSet(this.nsKey("strategy:config"), JSON.stringify(this.cfg))
  }

  // ---------- public controls ----------

  /**
   * Phase 6C — build a structured StartupError from a thrown message.
   * Distinguishes the known LIVE credentials-missing case from any other
   * executor construction failure so the dashboard can render both cleanly.
   */
  private buildStartupError(msg: string): StartupError {
    const cred = checkLiveCredentials()
    if (!cred.ok && msg === cred.message) {
      return {
        code: "LIVE_CREDENTIALS_MISSING",
        reason: cred.message,
        missing: cred.missing,
        action:
          "Set the missing variables in .env on the VPS and run `pm2 restart edge5 --update-env`.",
        atMs: Date.now(),
      }
    }
    return {
      code: "ENGINE_START_FAILED",
      reason: msg,
      missing: [],
      action: "Review `pm2 logs edge5` for the underlying stack trace before retrying.",
      atMs: Date.now(),
    }
  }

  /** Phase 6C — public startup lifecycle snapshot for the dashboard/API. */
  getStartupState(): StartupState {
    return {
      blocked: this.startupLastError !== null && !this.running,
      lastAttemptMs: this.startupLastAttemptMs,
      lastSuccessMs: this.startupLastSuccessMs,
      lastFailureMs: this.startupLastFailureMs,
      lastError: this.startupLastError,
    }
  }

  start(): string {
    if (this.running) return "Already running"
    this.startupLastAttemptMs = Date.now()
    try {
      this.executor = this.buildExecutor()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Phase 6B F-3: same message twice in a row within the dedupe window
      // is downgraded to `warn` with an attempt counter. The first hit stays
      // at `error` so the failure never disappears from logs.
      const now = Date.now()
      const isRepeat =
        msg === Edge5Engine.LAST_CREDENTIAL_ERROR_MSG &&
        now - this.credentialErrorLastMs < Edge5Engine.CREDENTIAL_ERROR_DEDUPE_MS
      if (isRepeat) {
        this.credentialErrorAttempts += 1
        logEvent("warn", `${msg} (attempt #${this.credentialErrorAttempts})`)
      } else {
        this.credentialErrorAttempts = 1
        logEvent("error", msg)
      }
      this.credentialErrorLastMs = now
      Edge5Engine.LAST_CREDENTIAL_ERROR_MSG = msg
      // Phase 6C — persist a structured failure the dashboard can render
      // without scraping logs. Cleared on the next successful ignition.
      this.startupLastFailureMs = now
      this.startupLastError = this.buildStartupError(msg)
      return msg
    }
    // First successful ignition clears the credential-error dedupe state.
    this.credentialErrorAttempts = 0
    Edge5Engine.LAST_CREDENTIAL_ERROR_MSG = ""
    // Clear any hung busy flag from a previous session so the loop can
    // fire immediately without waiting for a ghost promise to resolve.
    this.busy = false
    this.running = true
    this.slotEndMs = currentSlotEndMs()
    this.strike = null
    this.market = null
    // Fresh ignition must prove the full pipeline (discovery → tokens → WS →
    // first validated quote pair) before the first decision, exactly like a
    // slot rollover does.
    this.rolloverState = "ROLLING_OVER"
    this.rolloverStartedAtMs = Date.now()
    this.armMarket(this.slotEndMs)
    // Both pipelines: fetch the wallet balance on boot so the dashboard shows
    // collateral immediately (fire-and-forget; never blocks ignition). In
    // PAPER_V1 the executor answers with the simulated wallet while every
    // read still exercises the identical code path as LIVE_V2.
    {
      void this.syncLiveBalance()
      // Point the authenticated User-channel listener at the market we're now
      // actively monitoring. It observes real-time order/trade events for
      // logging only — fills are still detected by checkFill REST polling.
      getOrderEventListener().setMarkets(this.activeConditionIds())
      // Read-only account mirror: assemble live Polymarket account data
      // (balance/orders/trades/positions/value/PnL) for the dashboard. Wired
      // to the User-channel WS so order/trade events trigger a debounced
      // refresh. Fully decoupled from trading — never touches the tick loop.
      if (this.executor) {
        const sync = new AccountSync(this.executor)
        this.accountSync = sync
        getOrderEventListener().setOnAccountEvent(() => sync.requestRefresh("ws"))
        sync.start()
      }
      // Exchange-truth reconciler: read-only 60s cross-check of open orders
      // and wallet vs the engine's local view. Flags untracked live orders.
      this.reconciler.start()
      // Continuous accounting verifier (Phase 5): pure-math ledger identities
      // (per-trade PnL, balance chain, bankroll agreement, sizing conformance)
      // every 5 minutes in BOTH modes. Report-only except bankroll re-stamp.
      startAccountingVerifier(
        () => this.mode,
        {
          getBankroll: () => this.bankroll,
          getOpenCostUsd: () => this.standingOrders?.getOpenCostUsd() ?? 0,
          getConfiguredShares: () => this.standingOrders?.getConfiguredSizing() ?? null,
        },
      )
    }
    this.loop = setInterval(() => void this.tick(), 50)
    kvSet(this.nsKey("engine:running"), "1")
    kvSet("engine:mode", this.mode)
    logEvent("info", `Ignition ON — ${this.mode} pipeline armed`, "engine")
    notify("lifecycle", "ENGINE IGNITED", `Pipeline: ${this.mode}\nBankroll: $${this.bankroll.balance.toFixed(2)}`)
    // Phase 6C — record the successful ignition; clear the sticky failure.
    this.startupLastSuccessMs = Date.now()
    this.startupLastError = null
    return `Bot started (${this.mode})`
  }


  stop(): string {
    if (!this.running) return "Already stopped"
    this.running = false
    if (this.loop) clearInterval(this.loop)
    this.loop = null
    const order = this.openOrder
    this.openOrder = null
    if (order && this.executor) {
      void this.executor.cancelOrder(order).catch(() => {})
    }
    // Stop the read-only account mirror timers (cache is retained for display).
    getOrderEventListener().setOnAccountEvent(null)
    this.accountSync?.stop()
    this.reconciler.stop()
    stopAccountingVerifier()
    // Close the WebSocket connection for order fill events
    closeOrderEventListener()
    kvSet(this.nsKey("engine:running"), "0")
    logEvent("info", "Ignition OFF — all resting orders dropped", "engine")
    notify("lifecycle", "ENGINE STOPPED", `Pipeline: ${this.mode}`)
    return "Bot stopped"
  }

  /**
   * Full teardown of ALL interval loops owned by this engine instance — the
   * main strategy loop, the independent StandingOrderManager loop, and the CLOB
   * price feed poll timer. Called only when this singleton is being discarded
   * (HMR/version rebuild) so no orphaned setInterval keeps running against the
   * shared price feed and ledger. An orphaned SLO loop was causing duplicate
   * fills and direction-lock flapping alongside the new instance.
   */
  dispose(): void {
    try {
      this.stop()
    } catch {
      /* ignore */
    }
    try {
      this.standingOrders.dispose()
    } catch {
      /* ignore */
    }
    try {
      this.clobPriceFeed.stop()
    } catch {
      /* ignore */
    }
    try {
      this.spotFeed.stop()
    } catch {
      /* ignore */
    }
    try {
      this.watchdog.stop()
    } catch {
      /* ignore */
    }
    if (this.dbMaintenanceTimer) {
      clearInterval(this.dbMaintenanceTimer)
      this.dbMaintenanceTimer = null
    }
    if (this.dbKickoffTimer) {
      clearTimeout(this.dbKickoffTimer)
      this.dbKickoffTimer = null
    }
    // CERTIFICATION FIX (Phase 6): the settlement verifier's module-level
    // interval holds closures over THIS instance's getMode/executor. Because
    // startSettlementVerifier is idempotent (`if (timer) return`), a new
    // engine instance created after HMR/version rebuild could NOT replace the
    // stale closure — the old disposed instance kept running the sweeps and
    // receiving the wallet-mirror credits. Stop it here so the replacement
    // instance's start call re-registers with fresh closures.
    stopSettlementVerifier()
  }

  setMode(mode: PipelineMode): string {
    if (this.running) return "Stop the bot before switching pipelines"
    // Phase 6B F-4: refuse to persist an unreachable mode. Switching to
    // LIVE_V2 on a box that is missing signing/CLOB credentials would leave
    // the KV in a state where every subsequent auto-resume attempts LIVE_V2
    // and dies at the LiveExecutor constructor. Reject the swap up front and
    // return a structured message the dashboard/API can surface verbatim.
    if (mode === "LIVE_V2") {
      const cred = checkLiveCredentials()
      if (!cred.ok) {
        const detail = `${cred.message} Missing: ${cred.missing.join(", ")}.`
        logEvent("error", `Refused to switch to LIVE_V2 — ${detail}`)
        // Phase 6C — also expose this as a structured startup error so the
        // dashboard shows why the LIVE selector click did nothing.
        this.startupLastAttemptMs = Date.now()
        this.startupLastFailureMs = Date.now()
        this.startupLastError = {
          code: "LIVE_CREDENTIALS_MISSING",
          reason: cred.message,
          missing: cred.missing,
          action:
            "Set the missing variables in .env on the VPS and run `pm2 restart edge5 --update-env`.",
          atMs: Date.now(),
        }
        return detail
      }
    }

    this.mode = mode
    // SAFETY: persist under a GLOBAL key (nsKey is namespaced by mode — a
    // chicken-and-egg trap). Without this, a PM2 restart mid-paper-session
    // would silently flip the engine back to LIVE_V2 real-money mode.
    kvSet("v2:pipeline-mode", mode)
    this.bankroll = new Bankroll(mode)
    if (mode === "PAPER_V1" && this.bankroll.startingBalance === 0) {
      // Paper ledger is separate from live: seed simulated collateral so the
      // full order lifecycle (debit on fill, credit on settle) can run.
      this.bankroll.reset(env.PAPER_STARTING_BALANCE)
    }
    this.standingOrders.onModeChanged()
    logEvent("info", `Pipeline hot-swapped to ${mode}`)
    return `Environment set to ${mode}`
  }

  setPaperBalance(amount: number): string {
    if (this.mode !== "PAPER_V1") return "Balance can only be set in PAPER_V1"
    if (!(amount > 0)) return "Amount must be positive"
    this.bankroll.reset(amount)
    logEvent("info", `Paper bankroll reset to $${amount.toFixed(2)}`)
    return `Paper balance set to $${amount.toFixed(2)}`
  }

  setDriftPadding(usd: number): string {
    this.cfg.driftPaddingUsd = Math.max(0, usd)
    this.persistConfig()
    return `Drift guard padding set to $${this.cfg.driftPaddingUsd}`
  }

  setTif(tif: TIF): string {
    const valid: TIF[] = ["1m", "2m", "GTC"]
    if (!valid.includes(tif)) return `Invalid TIF: ${tif}. Must be one of 1m, 2m, GTC`
    this.cfg.tif = tif
    this.persistConfig()
    return `Time-In-Force set to ${tif}`
  }

  setP1Window(windowMs: number): string {
    if (windowMs < 0) return "P1 window must be >= 0 (0 disables time windows)"
    if (windowMs > 300_000) return "P1 window must be <= 300 seconds"
    this.cfg.p1WindowMs = Math.floor(windowMs)
    this.persistConfig()
    const label = windowMs === 0 ? "disabled (no time window)" : `${(windowMs / 1000).toFixed(1)}s`
    logEvent("info", `P1 window set to ${label}`)
    return `P1 window set to ${label}`
  }

  /**
   * Arm the independent standing limit order. The engine monitors the UP and
   * DOWN contracts continuously; the instant EITHER side's live best-ask
   * reaches the trigger, the direction is chosen from the live majority
   * (higher-priced contract) of that same atomic snapshot and a single LIMIT
   * BUY at the target is placed on that side (one order per 5-minute window).
   * Completely independent of engine ignition and the Time Window.
   */
  setLimitOrder(
    limitPrice: number,
    shares: number,
    minPrice?: number,
    maxPrice?: number,
    triggerPrice?: number,
    triggerMode?: TriggerMode,
    opts?: {
      sizingMode?: SloSizingMode
      sizeValue?: number
      entryWindowSec?: number | null
      compounding?: boolean
      useTriggerPrice?: boolean
      useLimitPrice?: boolean
    },
  ): string {
    return this.standingOrders.arm(
      limitPrice,
      shares,
      this.cfg.minShares,
      minPrice,
      maxPrice,
      triggerPrice,
      triggerMode,
      opts,
    )
  }

  clearLimitOrder(): string {
    return this.standingOrders.cancel()
  }

  pauseLimitOrder(): string {
    return this.standingOrders.pause()
  }

  resumeLimitOrder(): string {
    return this.standingOrders.resume()
  }

  /**
   * EMERGENCY STOP — engage the kill switch, cancel every resting order this
   * process knows about, then issue an account-wide cancelAll as the backstop.
   * The switch persists in the DB, so nothing trades again (even across
   * restarts) until the operator explicitly disengages it.
   */
  engageKillSwitch(reason?: string): string {
    this.risk.engageKillSwitch(reason?.trim() || "operator emergency stop", "OPERATOR")
    // Best-effort flatten: SLO resting order + engine resting order + cancelAll.
    this.standingOrders.pause()
    const stale = this.openOrder
    this.openOrder = null
    if (stale && this.executor) {
      void this.executor.cancelOrder(stale).catch((e) =>
        logEvent("error", `[RISK] kill switch: engine order cancel failed: ${(e as Error).message}`),
      )
    }
    if (this.executor?.cancelAllOrders) {
      void this.executor.cancelAllOrders().catch((e) =>
        logEvent("error", `[RISK] kill switch: account cancelAll failed: ${(e as Error).message}`),
      )
    }
    return "KILL SWITCH ENGAGED — all order placement blocked, resting orders cancelled. Standing order paused; disengage + resume to trade again."
  }

  disengageKillSwitch(): string {
    if (!this.risk.killSwitch.engaged) return "Kill switch is not engaged"
    this.risk.disengageKillSwitch()
    return "Kill switch disengaged — trading re-enabled (standing order remains paused until resumed)"
  }

  setRiskLimits(limits: Partial<RiskLimits>): string {
    const next = this.risk.setLimits(limits)
    return `Risk limits updated: daily loss $${next.maxDailyLossUsd}, order notional $${next.maxOrderNotionalUsd}, daily orders ${next.maxDailyOrders}, max shares ${next.maxSharesPerOrder}`
  }

  /**
   * Clear all trade + order history for the current pipeline mode and reset
   * the in-memory position/counters. Cancels any resting standing order first
   * so there is no live lot pointing at a now-deleted ledger row.
   */
  resetLedger(): string {
    this.standingOrders.cancel()
    const removed = clearLedger(this.mode)
    logEvent("info", `Ledger reset: cleared ${removed} ${this.mode} trade(s) and order history`)
    return `Ledger reset — cleared ${removed} ${this.mode} trade${removed === 1 ? "" : "s"}`
  }

  /**
   * The ONE interchangeable execution backend of the shared engine:
   *   PAPER_V1 → simulated execution (live CLOB data, intercepted submission)
   *   LIVE_V2  → real Polymarket execution (wallet → SDK → CLOB)
   * Everything upstream of this seam is identical in both modes.
   */
  private buildExecutor(): Executor {
    if (this.mode === "LIVE_V2") {
      // Lazy import keeps live wallet code entirely out of the paper path.
      const { LiveExecutor } = require("./execution/live") as typeof import("./execution/live")
      return new LiveExecutor()
    }
    // Full pipeline with the exchange submission intercepted. Fill decisions
    // read the LIVE CLOB best-ask; nothing can reach Polymarket.
    return new PaperExecutor((side) => this.livePriceForSide(side))
  }

  /** LIVE CLOB best-ask for a side from ONE atomic validated snapshot, or
   *  null when no validated snapshot exists or its confidence is LOW. This is
   *  the paper executor's ONLY fill-decision input — generation-gated,
   *  identity-verified, freshness-checked real data. */
  private livePriceForSide(side: TradeSide): number | null {
    const snap = this.clobPriceFeed.validatedQuotes()
    if (!snap || snap.confidence === "LOW") return null
    return side === "UP" ? snap.up.price : snap.down.price
  }

  /**
   * ROLLOVER BARRIER exit check — verifies the full pipeline for the NEW slot
   * end-to-end. All four conditions must hold simultaneously:
   *   1. market discovered for the current slot
   *   2. token ids verified in the price feed (generation advanced to them)
   *   3. websocket subscribed to the new tokens
   *   4. first validated quote pair of the new generation received
   * Only then does the engine return to LIVE and resume decisions.
   */
  private tryExitRollover() {
    const now = Date.now()
    const diag = this.clobPriceFeed.diagnostics()
    // (1) + (2): market discovered AND its tokens are what the feed tracks.
    const m = this.market
    const marketReady =
      m !== null && m.slotEndMs === this.slotEndMs && diag.upTokenId === m.upTokenId && diag.downTokenId === m.downTokenId
    // (3): WS subscribed to the new tokens (subscribe sent on current socket).
    const ws = this.clobPriceFeed.wsDiagnostics()
    const wsReady = ws.connected && ws.subscribeSentAtMs > 0
    // (4): a validated snapshot of the CURRENT generation exists.
    const snap = this.clobPriceFeed.validatedQuotes()
    const quotesReady = snap !== null

    if (marketReady && wsReady && quotesReady) {
      this.rolloverState = "LIVE"
      logEvent(
        "info",
        `Rollover barrier CLEARED in ${((now - this.rolloverStartedAtMs) / 1000).toFixed(1)}s — market ${m!.slug}, generation ${snap!.generation}, confidence ${snap!.confidence} — engine LIVE`,
      )
      return
    }
    // Throttled progress log so a stuck barrier is diagnosable, not silent.
    if (now - this.lastRolloverLogMs > 10_000) {
      this.lastRolloverLogMs = now
      logEvent(
        "info",
        `Rollover barrier HOLDING (${((now - this.rolloverStartedAtMs) / 1000).toFixed(0)}s): market ${marketReady ? "ready" : "pending"} | ws ${wsReady ? "subscribed" : "pending"} | validated quotes ${quotesReady ? "ready" : `pending (${diag.validationFailReason || "waiting"})`}`,
      )
    }
  }

  /**
   * ONE AUTHORITATIVE BANKROLL (Phase 5). The kv-persisted, ledger-driven
   * Bankroll (debit at fill, credit at settlement → net move = PnL) is the
   * single source of truth for the pool in BOTH modes.
   *
   * ROOT-CAUSE FIX: this method used to OVERWRITE `bankroll.balance` from the
   * executor wallet on every rollover. The paper wallet is an IN-MEMORY
   * mirror that resets on restart — after a restart it could receive a
   * settlement credit (e.g. +$7.00 payout) without the matching fill debit,
   * and the overwrite then stomped the true ledger balance with that number:
   * the displayed bankroll jumped by the PAYOUT instead of the PnL (+$0.07).
   *
   * New contract:
   * - PAPER_V1: NEVER writes the bankroll. Re-seeds the wallet mirror FROM
   *   the bankroll (authority → mirror), then reports drift read-only.
   * - LIVE_V2: on-chain balance is exchange truth, but it is applied as an
   *   audited RECONCILIATION — dust-aware, drift-logged with a permanent
   *   order_log row when |onchain − ledger| > $0.05 — never a silent stomp.
   * - First read still seeds the starting baseline in both modes.
   */
  private async syncLiveBalance(): Promise<void> {
    if (!this.executor?.getAvailableBalanceUsd) return
    const usd = await this.executor.getAvailableBalanceUsd()
    if (usd === null) return
    const pool = this.bankroll.balance + this.bankroll.dustReserve

    if (this.bankroll.startingBalance === 0) {
      this.bankroll.reset(usd) // seed starting baseline + balance (both modes)
      if (this.mode === "PAPER_V1") this.executor.setWalletUsd?.(usd)
      logEvent("info", `[${this.mode}] Bankroll baseline seeded from wallet: $${usd.toFixed(2)}`)
      return
    }

    if (this.mode === "PAPER_V1") {
      // Authority → mirror: push the ledger pool INTO the sim wallet.
      this.executor.setWalletUsd?.(pool)
      const drift = usd - pool
      if (Math.abs(drift) > 0.05) {
        logEvent(
          "warn",
          `[PAPER_V1] wallet mirror drifted $${drift.toFixed(2)} from ledger bankroll (wallet $${usd.toFixed(2)} vs pool $${pool.toFixed(2)}) — mirror re-seeded; bankroll NOT modified`,
        )
      }
      return
    }

    // LIVE_V2: audited reconciliation. On-chain is truth, but any material
    // divergence from the ledger is a red flag (missed fill debit, missed
    // settlement credit, external deposit/withdrawal) — record it permanently.
    const drift = usd - pool
    if (Math.abs(drift) > 0.05) {
      logEvent(
        "warn",
        `[LIVE_V2] on-chain balance $${usd.toFixed(2)} diverges from ledger bankroll $${pool.toFixed(2)} (drift $${drift.toFixed(2)}) — reconciling to on-chain with audit trail`,
      )
      insertOrderLog({
        mode: this.mode,
        event: "ERROR",
        marketId: this.market?.conditionId ?? "n/a",
        detail: `BANKROLL_RECONCILED to on-chain: ledger pool $${pool.toFixed(4)} → on-chain $${usd.toFixed(4)} (drift $${drift.toFixed(4)}); possible missed debit/credit or external transfer`,
      })
    }
    // Dust-aware mapping: the on-chain number contains the dust reserve.
    this.bankroll.balance = Math.max(0, Math.round((usd - this.bankroll.dustReserve) * 10000) / 10000)
    logEvent("info", `[LIVE_V2] Live balance reconciled: $${usd.toFixed(2)} on-chain (pool $${(this.bankroll.balance + this.bankroll.dustReserve).toFixed(2)})`)
  }

  /**
   * Condition IDs of the markets the engine is ACTIVELY monitoring right now.
   * Used to scope the authenticated User-channel WebSocket subscription so it
   * only receives order/trade events for relevant markets. The 5-minute BTC
   * pipeline monitors a single market per slot, but this returns an array so
   * multiple concurrently-active markets are supported without changes.
   */
  private activeConditionIds(): string[] {
    const ids: string[] = []
    if (this.market?.conditionId) ids.push(this.market.conditionId)
    return ids
  }

  // ---------- market discovery ----------

  /**
   * Fire-and-forget Gamma resolution for the current slot plus a
   * prefetch of the next one, so real token ids are in cache well
   * before the T-20s firing window opens. Never blocks the loop.
   */
  private armMarket(slotEndMs: number) {
    // If the next slot's market was already prefetched (the normal case, since
    // we prefetch a slot ahead), install its tokens SYNCHRONOUSLY so the price
    // feed never has a null-quote gap at the rollover boundary. Only when there
    // is no cached market do we clear (so we never show/trade the old slot).
    const cached = this.discovery.peek(slotEndMs)
    if (cached && cached.slotEndMs === slotEndMs) {
      this.market = cached
      this.clobPriceFeed.setTokenIds(cached.upTokenId, cached.downTokenId)
    } else {
      this.clobPriceFeed.clearTokenIds()
    }
    void this.discovery.resolve(slotEndMs).then((m) => {
      if (m && slotEndMs === this.slotEndMs) {
        this.market = m
        // Push the new token IDs into the price feed so it starts
        // polling live CLOB prices for the current slot.
        this.clobPriceFeed.setTokenIds(m.upTokenId, m.downTokenId)
        notify("market", "NEW MARKET DETECTED", `${m.slug}\nSettles: ${new Date(slotEndMs).toISOString().slice(11, 19)} UTC`)
      }
    }).catch((e) => {
      // Never let a discovery failure become an unhandled rejection — the
      // engine keeps ticking on the cached market and discovery retries.
      logEvent("warn", `market resolve failed for slot ${slotEndMs}: ${e instanceof Error ? e.message : String(e)}`, "engine")
    })
    void this.discovery.resolve(slotEndMs + SLOT_MS).catch(() => {
      /* prefetch is best-effort; the on-slot resolve above retries */
    })
  }

  /** Real Gamma-discovered ids in BOTH modes — the paper executor's fill
   *  engine reads the live CLOB, so synthetic ids would break it too. */
  private orderIds(side: TradeSide): { marketId: string; tokenId: string } | null {
    const m = this.market
    if (m && m.slotEndMs === this.slotEndMs) {
      return { marketId: m.slug, tokenId: side === "UP" ? m.upTokenId : m.downTokenId }
    }
    return null // never sign or simulate against synthetic ids
  }

  // ---------- market model helpers ----------

  /**
   * BTC reference staleness guard: a Chainlink tick older than this must
   * never drive the (registry-strategy) drift guard — a frozen tape during
   * an RPC outage would otherwise look like directional certainty. Note the
   * Standing Limit Order does NOT use this: it trades solely on live CLOB
   * prices and holds (NO_DATA) whenever those are unavailable.
   */
  private static readonly SPOT_STALE_MS = 10_000

  private freshSpot(): number | null {
    const tick = this.spotFeed.latest
    if (!tick) return null
    if (Date.now() - tick.tsMs > Edge5Engine.SPOT_STALE_MS) return null
    return tick.price
  }

  private fairFor(side: TradeSide): number {
    const spot = this.spotFeed.latest?.price ?? 0
    const strike = this.strike ?? spot
    const prices = tokenPrices(spot, strike, tMinusMs())
    return side === "UP" ? prices.up : prices.down
  }

  // ---------- main 50ms decision loop ----------

  private async tick() {
    if (!this.running || !this.executor) return
    // Deadlock guard: if a previous tick is still in-flight after 5s,
    // reset the flag so the engine does not permanently stall.
    if (this.busy) {
      if (Date.now() - this.lastTickStartMs > 5_000) {
        this.busy = false
        logEvent("warn", "tick busy watchdog fired — resetting busy flag to prevent engine deadlock")
      }
      return
    }
    const traceId = `tick-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const trace = startTrace(traceId)
    this.lastTickStartMs = Date.now()
    this.busy = true
    try {
      const slotEnd = currentSlotEndMs()

      // Slot rollover: settle the expired candle, arm the next one, and enter
      // the ROLLING_OVER barrier — no decision runs until the new market's
      // full pipeline (discovery → tokens → WS → first validated quote pair)
      // is proven end-to-end by tryExitRollover().
      if (slotEnd !== this.slotEndMs) {
        this.rolloverState = "ROLLING_OVER"
        this.rolloverStartedAtMs = Date.now()
        await this.settleSlot()
        this.slotEndMs = slotEnd
        this.strike = null
        this.market = this.discovery.peek(slotEnd)
        this.armMarket(slotEnd)
        // LIVE_V2: purge any stray resting orders left on the old market book,
        // then refresh the on-chain balance for the new slot. Both are
        // fire-and-forget so the 50ms loop never stalls on network I/O.
        if (this.executor) {
          // NOTE: no account-wide cancelAll at rollover. The Standing Limit
          // Order manages its own targeted cancels, so cancelAll would be pure
          // race-risk (it would purge a fresh SLO placed at the boundary of the
          // new window) with zero benefit.
          void this.syncLiveBalance()
          // New 5-minute window: re-sync the read-only account mirror so the
          // dashboard reflects the live account at the slot boundary.
          void this.accountSync?.refresh("rollover")
          // Re-point the User-channel subscription at the newly-armed market so
          // we only ever receive events for the markets we're monitoring.
          getOrderEventListener().setMarkets(this.activeConditionIds())
        }
      }

      recordPoint(traceId, "trigger-detect")

      // ROLLOVER BARRIER: attempt to re-enter LIVE; while still ROLLING_OVER,
      // skip every decision path (fill polling) for this tick.
      if (this.rolloverState === "ROLLING_OVER") {
        this.tryExitRollover()
        if (this.rolloverState === "ROLLING_OVER") {
          recordPoint(traceId, "tick-complete")
          completeTrace(traceId)
          return
        }
      }

      // Capture the strike from the first FRESH spot tick of the candle;
      // a stale tick from a dropped WS must never define the strike.
      if (this.strike === null) {
        const fresh = this.freshSpot()
        if (fresh !== null) this.strike = fresh
      }

      const phase = phaseFor(tMinusMs(), this.cfg)
      recordPoint(traceId, "phase-detect")
      // Current token prices — display + settlement modelling.
      const spotForPrices = this.spotFeed.latest
      const prices =
        spotForPrices && this.strike !== null
          ? tokenPrices(spotForPrices.price, this.strike, tMinusMs())
          : spotForPrices
            ? tokenPrices(spotForPrices.price, spotForPrices.price, tMinusMs())
            : { up: 0.5, down: 0.5 }
      
      // Poll resting order for a maker fill.
      if (this.openOrder && !this.position) {
        recordPoint(traceId, "fill-check-start")
        const fill = await this.executor.checkFill(this.openOrder)
        recordPoint(traceId, "fill-check-end")
        if (fill) this.onFill(fill.order, fill.filledPrice, traceId)
      }

      // NOTE: The Standing Limit Order is intentionally NOT handled here.
      // It runs on its own independent loop (StandingOrderManager),
      // decoupled from this tick loop and the Time Window / phase machine.
      recordPoint(traceId, "tick-complete")
      completeTrace(traceId)
    } catch (e) {
      // Throttle identical repeating errors: the 50ms loop would
      // otherwise flood the event log 20x/second during an outage.
      const msg = e instanceof Error ? e.message : String(e)
      const now = Date.now()
      if (msg !== this.lastTickErrorMsg || now - this.lastTickErrorAtMs > 10_000) {
        this.lastTickErrorMsg = msg
        this.lastTickErrorAtMs = now
        logEvent("error", `tick error: ${msg}`)
        insertOrderLog({
          mode: this.mode,
          event: "ERROR",
          marketId: this.market?.slug ?? marketIdForSlot(this.slotEndMs),
          detail: msg.slice(0, 300),
        })
      }
    } finally {
      this.busy = false
    }
  }

  private async quote(side: TradeSide, price: number, phase: EnginePhase, tif: TIF, expireAtMs: number | null) {
    if (!this.executor) return
    let sizing = this.bankroll.size(price, this.cfg.minShares)
    if (!sizing) {
      // Dynamic 5-share protocol guard: auto-scale paper capital upward.
      const pool = this.bankroll.balance + this.bankroll.dustReserve
      const validation = validateOrderSize(pool, price, this.cfg.minShares)
      if (this.mode === "PAPER_V1" && validation.scaled && pool > 0) {
        logEvent("warn", `${validation.reason} (auto-scaling paper pool)`)
        this.bankroll.reset(validation.requiredCapital)
        sizing = this.bankroll.size(price, this.cfg.minShares)
      }
      if (!sizing) {
        logEvent("warn", `Skipping quote: capital pool cannot clear the ${this.cfg.minShares}-share minimum @ $${price.toFixed(2)}`)
        return
      }
    }
    const ids = this.orderIds(side)
    if (!ids) {
      logEvent("warn", "Skipping quote: live market ids not yet resolved from Gamma")
      return
    }
    // MANDATORY RISK GATE — kill switch, daily loss breaker, caps, sanity.
    const verdict = this.risk.checkOrder({ price, shares: sizing.shares, slotEndMs: this.slotEndMs })
    if (!verdict.ok) {
      logEvent("warn", `Quote VETOED by risk gate: ${verdict.reason}`)
      return
    }
    this.openOrder = await this.executor.placeOrder({
      marketId: ids.marketId,
      tokenId: ids.tokenId,
      side,
      price,
      shares: sizing.shares,
      phase,
      tif,
      expireAtMs,
    })
    insertOrderLog({
      mode: this.mode,
      event: "SUBMITTED",
      marketId: ids.marketId,
      tokenId: ids.tokenId,
      exchangeOrderId: this.openOrder.exchangeOrderId,
      side,
      price,
      shares: sizing.shares,
      phase,
    })
  }

  private async reprice(side: TradeSide, price: number, phase: EnginePhase, reason: string, tif: TIF, expireAtMs: number | null) {
    if (!this.executor || !this.openOrder) return
    const sizing = this.bankroll.size(price, this.cfg.minShares)
    if (!sizing) return
    const ids = this.orderIds(side)
    if (!ids) return
    // RISK GATE on the replacement leg. A kill-switch veto here also cancels
    // the existing resting order — an engaged kill switch means FLAT, not
    // "keep the old quote resting".
    const verdict = this.risk.checkOrder({ price, shares: sizing.shares, slotEndMs: this.slotEndMs })
    if (!verdict.ok) {
      logEvent("warn", `Reprice VETOED by risk gate: ${verdict.reason}`)
      if (this.risk.killSwitch.engaged) {
        const stale = this.openOrder
        this.openOrder = null
        try {
          await this.executor.cancelOrder(stale)
          logEvent("warn", "Kill switch: resting order cancelled — engine is flat")
        } catch (e) {
          logEvent("error", `Kill switch cancel failed: ${(e as Error).message} — order may still rest`)
        }
      }
      return
    }
    const { order, latencyMs } = await this.executor.cancelReplace(this.openOrder, {
      marketId: ids.marketId,
      tokenId: ids.tokenId,
      side,
      price,
      shares: sizing.shares,
      phase,
      tif,
      expireAtMs,
    })
    this.openOrder = order
    this.lastCancelReplaceMs = latencyMs
    insertOrderLog({
      mode: this.mode,
      event: "REPLACED",
      marketId: ids.marketId,
      tokenId: ids.tokenId,
      exchangeOrderId: order.exchangeOrderId,
      side,
      price,
      shares: sizing.shares,
      phase,
      detail: `${latencyMs}ms — ${reason}`,
    })
    const latency = classifyCancelReplace(latencyMs, this.cfg.cancelReplaceBudgetMs)
    logEvent(latency.withinBudget ? "info" : "warn", `${latency.reason} — ${reason}`)
  }

  private onFill(order: OpenOrder, filledPrice: number, traceId?: string) {
    if (traceId) recordPoint(traceId, "onFill-start")
    const sizing = this.bankroll.size(filledPrice, this.cfg.minShares)
    const shares = order.shares
    const cost = Math.round(shares * filledPrice * 10000) / 10000
    const pool = this.bankroll.balance + this.bankroll.dustReserve
    const dust = Math.round((pool - cost) * 10000) / 10000
    void sizing
    // Phase 1 · Stage 1A · P-3 fix — open a ledger row (status OPEN) the
    // instant we take the position, so a crash between fill and settlement
    // is refunded via scratchOrphanedOpenRows() at boot. This mirrors the
    // SLO path exactly (standing-order.ts:1928-1966).
    const tradeUid = randomUUID()
    let tradeId: number | null = null
    try {
      tradeId = openTrade({
        marketId: order.marketId,
        slotEndMs: this.slotEndMs,
        side: order.side,
        price: filledPrice,
        shares,
        cost,
        // Balance after debit — SLO uses pool-post-debitFixed, engine's
        // equivalent is (dust) since commitFill zeros balance. Display-only.
        balanceAfter: Math.max(dust, 0),
        mode: this.mode,
        orderId: order.exchangeOrderId,
        tradeUid,
        explanation: JSON.stringify({
          entry: `strategy engine: ${order.side} filled at $${filledPrice.toFixed(4)} (${shares} shares, cost $${cost.toFixed(4)})`,
          costCalc: `${shares} × $${filledPrice.toFixed(4)} = $${cost.toFixed(4)} debited via commitFill (balance→0, dust=$${Math.max(dust, 0).toFixed(4)})`,
        }),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logEvent("warn", `strategy engine: failed to open ledger row on fill: ${msg}`)
    }
    this.position = {
      side: order.side,
      price: filledPrice,
      shares,
      cost,
      dust: Math.max(dust, 0),
      marketId: order.marketId,
      slotEndMs: this.slotEndMs,
      tradeId,
      tradeUid,
    }
    this.bankroll.commitFill({ shares, cost, dust: Math.max(dust, 0), capitalPool: pool })
    this.openOrder = null
    // Phase 1 · Stage 1A instrumentation (dtrace) — direction correlation.
    dtrace.trace(tradeUid, "engine-fill", {
      marketId: order.marketId,
      slotEndMs: this.slotEndMs,
      orderSide: order.side,
      orderTokenId: order.tokenId,
      positionSide: order.side,
      shares,
      filledPrice,
      cost,
      poolBefore: pool,
      dustAfter: Math.max(dust, 0),
      poolShortfall: dust < 0 ? Math.abs(dust) : 0,
      tradeId,
    })
    // Phase 1 · Stage 1A · P-1 defensive log — if cost > pool the max(0)
    // clamp masked a shortfall. Surface it loudly so it can be root-caused.
    if (dust < 0) {
      logEvent(
        "error",
        `strategy engine: FILL COST > POOL — cost $${cost.toFixed(4)} pool $${pool.toFixed(4)} shortfall $${Math.abs(dust).toFixed(4)} (dust clamped to $0)`,
      )
      insertOrderLog({
        mode: this.mode,
        event: "ERROR",
        marketId: order.marketId,
        tokenId: order.tokenId,
        exchangeOrderId: order.exchangeOrderId,
        side: order.side,
        price: filledPrice,
        shares,
        phase: order.phase,
        detail: `FILL_OVERSPEND cost=$${cost.toFixed(4)} pool=$${pool.toFixed(4)} shortfall=$${Math.abs(dust).toFixed(4)}`,
      })
    }
    logEvent("trade", `FILLED ${order.side} ${shares} shares @ $${filledPrice.toFixed(2)} (dust swept $${Math.max(dust, 0).toFixed(4)})`)
    // Fire-and-forget audit logging — never blocks execution
    void insertOrderLog({
      mode: this.mode,
      event: "FILLED",
      marketId: order.marketId,
      tokenId: order.tokenId,
      exchangeOrderId: order.exchangeOrderId,
      side: order.side,
      price: filledPrice,
      shares,
      phase: order.phase,
      detail: `cost $${cost.toFixed(4)}, dust $${Math.max(dust, 0).toFixed(4)}, trade ${tradeUid.slice(0, 8)}`,
    })
    if (traceId) recordPoint(traceId, "onFill-complete")
  }

  private async settleSlot() {
    const pos = this.position
    this.position = null
    const order = this.openOrder
    this.openOrder = null

    // Open-exposure orphan cleaner: a leg filled (position held) while a
    // second leg was still resting unhedged at slot close. Flatten it with
    // an immediate market-priced FOK counter before the candle resolves.
    if (order && pos && detectOrphan("FILLED", "PENDING") && this.executor) {
      const counter = buildOrphanCounter(pos.side, order.shares, this.fairFor(pos.side === "UP" ? "DOWN" : "UP"))
      logEvent("warn", counter.reason)
      await this.executor.cancelOrder(order).catch(() => {})
    } else if (order && this.executor) {
      await this.executor.cancelOrder(order).catch(() => {})
    }
    if (!pos) return

    // Official Polymarket resolution is the SINGLE source of truth in BOTH
    // paper and live modes. Phase 2: the spot-fallback heuristic has been
    // removed from the primary path — if the official resolution has not
    // been published by the time our patience window elapses we settle
    // SCRATCH (cost refunded, zero PnL), and the settlement-verifier
    // sweep upgrades that row to the true WIN/LOSS the moment Chainlink
    // publishes. Nothing on the hot path ever guesses the winner.
    void this.settleOfficial(pos)
  }

  /**
   * Resolve and settle a position against the OFFICIAL Polymarket outcome
   * (Chainlink-resolved), in BOTH paper and live modes. Never fabricates a
   * win/loss: official resolution or SCRATCH-pending — the settlement
   * verifier is the ONLY path allowed to upgrade a SCRATCH to WIN/LOSS,
   * and it does so exclusively from official evidence.
   */
  private async settleOfficial(pos: FilledPosition) {
    this.pendingResolutions++
    try {
      let winner: TradeSide | null = null
      for (let attempt = 0; attempt < RESOLUTION_ATTEMPTS && winner === null; attempt++) {
        winner = await this.discovery.fetchResolution(pos.slotEndMs)
        if (winner === null) await new Promise((r) => setTimeout(r, RESOLUTION_POLL_MS))
      }
      if (winner !== null) {
        this.recordSettlement(pos, winner, "official")
      } else {
        logEvent(
          "warn",
          `[settlement] official resolution unavailable for ${pos.marketId} after ${RESOLUTION_ATTEMPTS} × ${RESOLUTION_POLL_MS}ms — settling SCRATCH-pending (cost refunded); settlement-verifier will upgrade to WIN/LOSS when Chainlink publishes`,
        )
        this.recordSettlement(pos, null, "pending-official")
      }
    } catch (e) {
      // Never fabricate a loss on error: settle SCRATCH so the trade is not
      // recorded against the account on unverified data.
      logEvent(
        "error",
        `[settlement] resolution poll crashed for ${pos.marketId}: ${e instanceof Error ? e.message : String(e)} — settling SCRATCH-pending`,
      )
      this.recordSettlement(pos, null, "pending-official")
    } finally {
      this.pendingResolutions--
    }
  }


  /**
   * Strict, fail-safe spot winner for use ONLY when the official resolution is
   * unavailable. Returns null (→ SCRATCH) unless there is a FRESH Chainlink
   * tick, a captured strike, and a decisive move — never guesses a near-the-
   * money candle or settles off a stale/zero price.
   */
  private computeSpotFallback(): TradeSide | null {
    const price = this.freshSpot()
    if (price === null || !Number.isFinite(price) || price <= 0) return null
    if (this.strike === null) return null
    const margin = price - this.strike
    if (Math.abs(margin) < FALLBACK_MIN_MARGIN_USD) return null
    return margin >= 0 ? "UP" : "DOWN"
  }

  private recordSettlement(pos: FilledPosition, winner: TradeSide | null, source: string) {
    // Phase 2 — per-uid idempotent settlement lock. Belt-and-suspenders on
    // top of settleTrade's `AND status='OPEN'` row-level guard: even if a
    // future code path bypasses that gate (retry, replay, out-of-order
    // callback), we refuse to credit the bankroll twice for the same trade.
    // A "pending" marker written by an earlier SCRATCH-pending settle is
    // treated as unlocked so the settlement-verifier can still upgrade the
    // row to WIN/LOSS via settlement-repair — repair carries its own
    // dedicated `repair:settle:*` idempotency key.
    const settleLockKey = pos.tradeUid ? `settle:lock:${pos.tradeUid}` : null
    if (settleLockKey) {
      const existing = kvGet(settleLockKey)
      if (existing && !existing.startsWith("pending")) {
        logEvent(
          "warn",
          `[settlement] duplicate settle blocked for trade_uid=${pos.tradeUid} (existing lock=${existing}) — bankroll/ledger untouched`,
        )
        return
      }
    }
    const isScratch = winner === null

    const won = !isScratch && pos.side === winner
    const result: "WIN" | "LOSS" | "SCRATCH" = isScratch ? "SCRATCH" : won ? "WIN" : "LOSS"
    // Pool was debited `cost` on fill. WIN pays $1/share; LOSS pays 0; SCRATCH
    // refunds the cost so the slot nets exactly zero.
    const payout = isScratch ? pos.cost : won ? pos.shares : 0
    const pnl = isScratch ? 0 : Math.round((payout - pos.cost) * 10000) / 10000
    const markPrice = isScratch ? pos.price : won ? 1 : 0

    // Phase 1 · Stage 1A instrumentation — capture the winner/tokenId inputs
    // to the direction decision BEFORE the ledger write. A mismatch between
    // pos.side and the winning-token→direction mapping would prove a
    // mid-pipeline direction swap.
    const mkt = this.discovery.peek(pos.slotEndMs)
    const winningTokenId = isScratch || !mkt ? null : winner === "UP" ? mkt.upTokenId : mkt.downTokenId
    dtrace.trace(pos.tradeUid, "engine-settlement-input", {
      marketId: pos.marketId,
      slotEndMs: pos.slotEndMs,
      betSide: pos.side,
      winner,
      winningTokenId,
      upTokenId: mkt?.upTokenId ?? null,
      downTokenId: mkt?.downTokenId ?? null,
      source,
    })

    // Phase 1 · Stage 1A · P-2 fix — capture pool total BEFORE bankroll.settle
    // so the accounting invariant (closing = opening + payout) can be checked
    // AFTER the credit. Previously only the SLO path had this check; a double-
    // credit or missed credit on the engine path would slowly drift the pool.
    const openingTotal = this.bankroll.balance + this.bankroll.dustReserve

    // Phase 1 · Stage 1A · P-3 fix — settle the ledger row that was opened on
    // fill (read-your-writes). settleTrade guards `AND status='OPEN'` so a
    // second settle attempt (e.g. after boot-time orphan sweep) can never
    // double-credit. Only credit the bankroll when the row was actually the
    // one we transitioned.
    let credited = false
    const settleExplanation = JSON.stringify({
      settlement: isScratch
        ? `SCRATCH — no reliable market resolution (source: ${source}); entry cost refunded so the slot nets exactly zero`
        : won
          ? `WIN — bet ${pos.side}, official winner ${winner} (source: ${source}); each share paid out $1.00`
          : `LOSS — bet ${pos.side}, official winner ${winner} (source: ${source}); shares expired worthless`,
      resolvedWinner: winner,
      resolutionSource: source,
      pnlCalc: isScratch
        ? `cost $${pos.cost.toFixed(4)} refunded; realized PnL $0.0000`
        : `payout $${payout.toFixed(4)} − cost $${pos.cost.toFixed(4)} = ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)}`,
    })

    if (pos.tradeId !== null) {
      const updated = settleTrade({ id: pos.tradeId, result, pnl, balanceAfter: 0, markPrice, explanation: settleExplanation })
      if (updated === 0) {
        logEvent("warn", `[settlement] engine: ledger row #${pos.tradeId} already settled — bankroll credit skipped (no double-pay)`)
      } else {
        this.bankroll.settle(payout)
        credited = true
        try {
          updateSettledBalance(pos.tradeId, this.bankroll.balance + this.bankroll.dustReserve)
        } catch {
          /* display-only field — never crash settlement */
        }
      }
    } else {
      // Fallback path: DB failed at fill time, no OPEN row exists.
      this.bankroll.settle(payout)
      credited = true
      insertTrade({
        marketId: pos.marketId,
        slotEndMs: pos.slotEndMs,
        side: pos.side,
        price: pos.price,
        shares: pos.shares,
        cost: pos.cost,
        result,
        pnl,
        balanceAfter: this.bankroll.balance + this.bankroll.dustReserve,
        dustSaved: pos.dust,
        mode: this.mode,
        explanation: JSON.stringify({
          entry: `strategy engine: ${pos.side} filled at $${pos.price.toFixed(4)} (${pos.shares} shares, cost $${pos.cost.toFixed(4)})`,
          settlement: settleExplanation,
        }),
      })
    }
    const balanceAfter = this.bankroll.balance + this.bankroll.dustReserve

    // Phase 1 · Stage 1A · P-2 fix — accounting invariant check.
    if (credited) {
      const violation = checkAccountingInvariant({ opening: openingTotal, payout, closing: balanceAfter })
      if (violation) {
        const detail =
          `ACCOUNTING_INVARIANT_VIOLATION (engine) trade_uid=${pos.tradeUid} opening $${openingTotal.toFixed(4)} + payout $${payout.toFixed(4)} ` +
          `= expected $${violation.expectedClosing.toFixed(4)} but closing is $${balanceAfter.toFixed(4)} (drift $${violation.drift.toFixed(4)})`
        logEvent("error", `[settlement] CRITICAL: ${detail}`)
        insertOrderLog({
          mode: this.mode,
          event: "ERROR",
          marketId: pos.marketId,
          side: pos.side,
          price: pos.price,
          shares: pos.shares,
          detail,
        })
      }
    }

    // PAPER_V1: mirror the payout into the simulated wallet (debited on fill).
    // Without this credit the sim wallet drains monotonically over a long
    // session until orders are rejected for "not enough balance".
    if (credited && payout > 0) {
      try {
        this.executor?.creditSettlement?.(payout)
      } catch {
        /* wallet mirror must never crash settlement */
      }
    }

    dtrace.trace(pos.tradeUid, "engine-settlement-result", {
      marketId: pos.marketId,
      slotEndMs: pos.slotEndMs,
      betSide: pos.side,
      result,
      winner,
      payout,
      pnl,
      openingTotal,
      balanceAfter,
      credited,
    })

    // (winningTokenId + mkt captured earlier at the settlement-input trace.)

    // Structured per-trade settlement audit line — the single place to debug a
    // win/loss classification. Contains every input to the decision.
    logEvent(
      "trade",
      `[settlement] ${JSON.stringify({
        marketId: pos.marketId,
        slotEndMs: pos.slotEndMs,
        betSide: pos.side,
        entryPrice: pos.price,
        shares: pos.shares,
        cost: Math.round(pos.cost * 10000) / 10000,
        resolvedWinner: winner,
        winningTokenId,
        result,
        source,
        settledAtMs: Date.now(),
        pnl,
        balanceAfter: Math.round(balanceAfter * 10000) / 10000,
        reason: isScratch
          ? "no reliable resolution — cost refunded, zero PnL"
          : won
            ? `bet ${pos.side} == winner ${winner}`
            : `bet ${pos.side} != winner ${winner}`,
      })}`,
    )
    logEvent(
      "trade",
      `SETTLED ${pos.marketId}: ${pos.side} ${result} — PnL ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}, bankroll $${balanceAfter.toFixed(2)} [${source}]`,
    )
    insertOrderLog({
      mode: this.mode,
      event: "SETTLED",
      marketId: pos.marketId,
      side: pos.side,
      price: pos.price,
      shares: pos.shares,
      detail: `${result} winner=${winner ?? "none"} src=${source} pnl=$${pnl.toFixed(4)} balance=$${balanceAfter.toFixed(4)}`,
    })

    // Telegram cards represent realized outcomes; a SCRATCH (no PnL) is not
    // broadcast as a win/loss.
    if (!isScratch) {
      getTelegram(this)?.broadcastSettlement({
        marketId: pos.marketId,
        side: pos.side,
        filledPrice: pos.price,
        result: won ? "WIN" : "LOSS",
        pnl,
        bankroll: balanceAfter,
        dust: this.bankroll.dustReserve,
      })
    } else {
      // SCRATCH goes through the category-gated notifier instead (the
      // interactive bot's PnL card is reserved for realized outcomes).
      notify("trades", "TRADE SCRATCH", `Market: ${pos.marketId}\nEntry cost refunded — no realized PnL\nBankroll: $${balanceAfter.toFixed(2)}`)
    }

    // Phase 2 — stamp the per-uid settlement lock. A "pending" marker for
    // SCRATCH-from-pending-official leaves the row eligible for the
    // verifier's official-evidence upgrade; a WIN/LOSS/final-SCRATCH mark
    // is terminal on this path (only settlement-repair may rewrite it, and
    // it owns its own idempotency key).
    if (settleLockKey && credited) {
      const marker = isScratch && source === "pending-official" ? "pending" : `final:${result}`
      try { kvSet(settleLockKey, marker) } catch { /* lock is best-effort */ }
    }
  }


  // ---------- dashboard snapshot ----------

  snapshot(): EngineSnapshot {
    const spot = this.spotFeed.latest
    const strike = this.strike
    const tm = tMinusMs()

    // Contract prices come EXCLUSIVELY from the live Polymarket CLOB, read
    // through ONE atomic validated snapshot (generation + identity + freshness
    // gated) — the same choke point the engines trade through. When no valid
    // snapshot exists the prices are null and the UI shows NO DATA. The
    // canonical UP/DOWN value is the best ask (BUY) — the exact number on
    // Polymarket's buy buttons.
    const feedSnap = this.clobPriceFeed.validatedQuotes()
    const clobFresh = feedSnap !== null
    let upTokenPrice: number | null = null
    let downTokenPrice: number | null = null
    let clobQuote: EngineSnapshot["clobQuote"] = null
    if (feedSnap) {
      const { up, down } = feedSnap
      upTokenPrice = up.price
      downTokenPrice = down.price
      clobQuote = {
        up: { ask: up.ask, bid: up.bid, mid: up.mid, last: up.last, lastSide: up.lastSide },
        down: { ask: down.ask, bid: down.bid, mid: down.mid, last: down.last, lastSide: down.lastSide },
      }
    }

    const stats = tradeStats(this.mode)
    const phase: EnginePhase = this.running ? phaseFor(tm, this.cfg) : "OFFLINE"
    const direction =
      spot && strike !== null
        ? evaluateOracleGuard(spot.price, strike, this.cfg.driftPaddingUsd, spot.tsMs).side
        : null

    return {
      running: this.running,
      mode: this.mode,
      phase,
      slotEndMs: currentSlotEndMs(),
      tMinusMs: tm,
      clockOffsetMs: clockOffsetMs(),
      clockSynced: clockSynced(),
      spot,
      strike,
      direction,
      driftGuardClear: direction !== null,
      upTokenPrice,
      downTokenPrice,
      clobQuote,
      clobBook: this.clobPriceFeed.bookDepth,
      clobPriceChange: this.clobPriceFeed.priceChange(),
      clobPricesFresh: clobFresh,
      balance: this.bankroll.balance,
      dustReserve: this.bankroll.dustReserve,
      startingBalance: this.bankroll.startingBalance,
      totalPnl: stats.totalPnl,
      wins: stats.wins,
      losses: stats.losses,
      openOrder: this.openOrder,
      lastCancelReplaceMs: this.lastCancelReplaceMs,
      config: this.cfg,
      events: recentEvents(),
      telegramConnected: getTelegram(this)?.connected ?? false,
      liveKeysLoaded: Boolean(env.POLY_PRIVATE_KEY && env.POLY_API_KEY),
      liveMarket:
        this.market && this.market.slotEndMs === this.slotEndMs
          ? {
              slug: this.market.slug,
              question: this.market.question,
              conditionId: this.market.conditionId,
              // Always coerce to boolean — Gamma can return null for these
              // fields on freshly-listed markets that haven't opened yet.
              active: Boolean(this.market.active),
              closed: Boolean(this.market.closed),
              upTokenId: this.market.upTokenId,
              downTokenId: this.market.downTokenId,
              volumeUsd: this.market.volumeUsd,
              liquidityUsd: this.market.liquidityUsd,
              endDateIso: this.market.endDateIso,
            }
          : null,
      marketDiscovery: this.market ? "ready" : "waiting",
      awaitingResolution: this.pendingResolutions > 0,
      standingLimitOrder: this.standingOrders.snapshot(),
      risk: this.risk.snapshot(),
      reconcile: this.reconciler.latest,
      watchdog: this.watchdog.snapshot(),
      feedStats: feedStats(this.mode),
      lastAccountingAudit: getLastAccountingAudit(),
      clobDiagnostics: this.clobPriceFeed.diagnostics(),
      rolloverState: this.running ? this.rolloverState : "LIVE",
      feedSnapshotInfo: feedSnap
        ? {
            generation: feedSnap.generation,
            sequence: feedSnap.sequence,
            timestampMs: feedSnap.timestampMs,
            upAgeMs: feedSnap.upAgeMs,
            downAgeMs: feedSnap.downAgeMs,
            wsFreshMs: feedSnap.wsFreshMs,
            restFreshMs: feedSnap.restFreshMs,
            confidence: feedSnap.confidence,
            upSource: feedSnap.up.source,
            downSource: feedSnap.down.source,
          }
        : null,
      liveAccount: this.accountSync?.get() ?? null,
      startup: this.getStartupState(),
    }
  }
}

// ---------- HMR-safe process singleton ----------

// Keep a VERSION token that matches the current module build. When HMR hot-
// patches this file the module re-executes, bumping the in-memory version
// string. If the cached singleton was built with an older version its class
// instances (ClobPriceFeed, StandingOrderManager, …) won't have the new
// methods, so we discard and rebuild.
const ENGINE_VERSION = "2026-07-14-feed-integrity-v20"

// V2 singleton lives under its OWN global key so it runs fully independently
// from the V1 (paper) engine in the same persistent Node process.
const globalRef = globalThis as unknown as {
  __botEngineV2?: Edge5Engine
  __botEngineV2Version?: string
  __botProcessGuards?: boolean
}

/**
 * Process-level crash guards. Without these, ONE stray promise rejection in a
 * timer/WS callback hard-crashes the entire Node process (Node's default).
 * PM2 would restart + auto-resume, but a repeating rejection becomes a crash
 * loop that churns sessions and WS connections. Policy:
 *  • unhandledRejection → log loudly, keep the process alive (the watchdog
 *    and reconciler recover subsystem state on their next cycle).
 *  • uncaughtException  → log, then exit(1) so PM2 restarts from a clean
 *    slate — a sync throw means memory state can no longer be trusted.
 *
 * ARC Phase 2 (R-2): these are a FALLBACK only. instrumentation-node.ts
 * installs the richer handlers (full stack + pid/uptime/memory diagnostics, a
 * 2s log-flush grace period before exit, and SIGTERM/SIGINT graceful dispose)
 * at process boot. When both sets were registered, this handler's immediate
 * process.exit(1) won the race and truncated those crash diagnostics — the
 * exact forensics needed to explain an unattended stop. If the instrumentation
 * handlers exist, do not register a second, more aggressive pair.
 */
function installProcessGuards(): void {
  if (globalRef.__botProcessGuards) return
  globalRef.__botProcessGuards = true
  if ((globalThis as { __edge5CrashHandlersInstalled?: boolean }).__edge5CrashHandlersInstalled) return
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    try { logEvent("error", `[PROCESS] Unhandled promise rejection (kept alive): ${msg.slice(0, 400)}`) } catch { /* ignore */ }
  })
  process.on("uncaughtException", (err) => {
    try { logEvent("error", `[PROCESS] Uncaught exception — exiting for clean PM2 restart: ${(err.stack ?? err.message).slice(0, 400)}`) } catch { /* ignore */ }
    process.exit(1)
  })
}

export function getEngine(): Edge5Engine {
  installProcessGuards()
  if (!globalRef.__botEngineV2 || globalRef.__botEngineV2Version !== ENGINE_VERSION) {
    // If there was an engine from a previous version, fully DISPOSE it (main
    // loop + SLO loop + price-feed timer) so no orphaned interval leaks and
    // races the new instance, then discard the stale reference.
    if (globalRef.__botEngineV2 && globalRef.__botEngineV2Version !== ENGINE_VERSION) {
      try { globalRef.__botEngineV2.dispose() } catch { /* ignore */ }
    }
    globalRef.__botEngineV2 = new Edge5Engine()
    globalRef.__botEngineV2Version = ENGINE_VERSION
  }
  return globalRef.__botEngineV2
}
