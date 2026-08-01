"use client"

import { memo, useCallback, useRef, useState } from "react"
import { Activity, BarChart3, Gauge, ScrollText, Wrench } from "lucide-react"
import { AnalyticsPanel } from "@/components/v2/analytics-panel"
import { CommandDeck } from "@/components/v2/command-deck"
import { SystemPanel } from "@/components/v2/system-panel"
import { IntelFeed } from "@/components/v2/intel-feed"
import { Ledger } from "@/components/v2/ledger"
import { LimitOrderPanel } from "@/components/v2/limit-order-panel"
import { LiveAccount } from "@/components/v2/live-account"
import { MarketMonitor } from "@/components/v2/market-monitor"
import { ProfilesPanel } from "@/components/v2/profiles-panel"
import { TopNav } from "@/components/v2/top-nav"
import { sendControl, useBotStatus } from "@/components/v2/use-bot"
import type { EngineSnapshot, PipelineMode } from "@/lib/v2/engine/types"

/**
 * RENDER ISOLATION — the status poll produces a new snapshot object every
 * second. Without memoization every panel re-renders every second, including
 * panels on hidden tabs. Each panel is memoized here, and hidden tabs receive
 * a FROZEN snapshot (the last one they saw while visible), so React skips
 * their entire subtree until the operator switches back — at which point the
 * live snapshot is handed over and the panel catches up instantly.
 */
const MemoCommandDeck = memo(CommandDeck)
const MemoLimitOrderPanel = memo(LimitOrderPanel)
const MemoLiveAccount = memo(LiveAccount)
const MemoProfilesPanel = memo(ProfilesPanel)
const MemoLedger = memo(Ledger)

type TabId = "ops" | "signal" | "ledger" | "analytics" | "system"

const TABS: { id: TabId; label: string; icon: typeof Gauge }[] = [
  { id: "ops", label: "OPS DECK", icon: Gauge },
  { id: "signal", label: "SIGNAL TANK", icon: Activity },
  { id: "ledger", label: "LEDGER", icon: ScrollText },
  { id: "analytics", label: "ANALYTICS", icon: BarChart3 },
  { id: "system", label: "SYSTEM", icon: Wrench },
]

/**
 * The one shared terminal, parameterized by route:
 *   /v1 → pipeline PAPER_V1 (simulated execution, live CLOB data)
 *   /v2 → pipeline LIVE_V2  (real money)
 *
 * DASHBOARD ISOLATION (ARC Phase 2, D-1): viewing a page NEVER writes to the
 * engine. Previously this component auto-issued `set_mode` whenever the route's
 * pipeline differed from the engine's — so merely opening/refreshing /v1 (or
 * having /v1 and /v2 open in two tabs) hot-swapped the engine pipeline, which
 * rebuilds the Bankroll, re-persists `v2:pipeline-mode`, and rebuilds the SLO
 * executor. Pipeline switching is now an EXPLICIT operator action via the
 * banner button below; navigation alone is inert.
 */
export function TerminalDashboard({ pipeline }: { pipeline: PipelineMode }) {
  const { data: snap, error: statusError, mutate } = useBotStatus()
  const [tab, setTab] = useState<TabId>("ops")
  const [switching, setSwitching] = useState(false)

  // Stable callback so memoized panels don't re-render from a new closure
  // identity on every poll tick.
  const onChanged = useCallback(() => void mutate(undefined, { revalidate: true }), [mutate])

  // Frozen snapshots for hidden tabs (see RENDER ISOLATION note above).
  // The active tab always tracks the live snapshot; hidden tabs keep the
  // last object they rendered, so their memoized subtrees are skipped.
  const heldOps = useRef<EngineSnapshot | undefined>(undefined)
  const heldLedger = useRef<EngineSnapshot | undefined>(undefined)
  if (snap) {
    heldOps.current = tab === "ops" ? snap : (heldOps.current ?? snap)
    heldLedger.current = tab === "ledger" ? snap : (heldLedger.current ?? snap)
  }

  const modeMismatch = Boolean(snap && snap.mode !== pipeline)
  const runningElsewhere = Boolean(snap && snap.running && snap.mode !== pipeline)

  const switchPipeline = useCallback(() => {
    setSwitching(true)
    void sendControl({ action: "set_mode", mode: pipeline })
      .then(() => mutate(undefined, { revalidate: true }))
      .finally(() => setSwitching(false))
  }, [pipeline, mutate])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className={`font-mono text-xl tracking-widest text-glow-neon ${pipeline === "PAPER_V1" ? "text-neon" : "text-crimson"}`}>
            BTC 5M
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            {pipeline === "PAPER_V1" ? "PAPER TERMINAL" : "LIVE TERMINAL"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {snap ? (
            <div className="hidden items-center gap-3 font-mono text-[11px] text-muted-foreground md:flex">
              <span>
                TG <span className={snap.telegramConnected ? "text-neon" : "text-muted-foreground"}>{snap.telegramConnected ? "LINKED" : "OFF"}</span>
              </span>
              <span>
                KEYS <span className={snap.liveKeysLoaded ? "text-neon" : "text-muted-foreground"}>{snap.liveKeysLoaded ? "VAULTED" : "NONE"}</span>
              </span>
            </div>
          ) : null}
          <TopNav engineMode={snap?.mode} />
        </div>
      </header>

      {modeMismatch && snap ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-caution bg-caution/10 px-3 py-2 font-mono text-xs text-caution" role="status">
          <span>
            ENGINE IS IN {snap.mode === "PAPER_V1" ? "V1 PAPER" : "V2 LIVE"}
            {runningElsewhere ? " AND RUNNING" : " (STOPPED)"} — this page shows{" "}
            {pipeline === "PAPER_V1" ? "V1 PAPER" : "V2 LIVE"}. Viewing never changes the engine.
            {runningElsewhere ? " Stop it from the command deck before switching." : ""}
          </span>
          {!runningElsewhere ? (
            <button
              type="button"
              onClick={switchPipeline}
              disabled={switching}
              className="rounded border border-caution px-2 py-1 tracking-widest transition-colors hover:bg-caution/20 disabled:opacity-50"
            >
              {switching ? "SWITCHING…" : `SWITCH ENGINE TO ${pipeline === "PAPER_V1" ? "V1 PAPER" : "V2 LIVE"}`}
            </button>
          ) : null}
        </div>
      ) : null}


      {!snap ? (
        <div className="flex flex-1 items-center justify-center">
          {statusError ? (
            <div className="flex max-w-xl flex-col items-center gap-2 px-4 text-center">
              <p className="font-mono text-sm text-crimson">engine failed to start</p>
              <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">
                {statusError instanceof Error ? statusError.message : String(statusError)}
              </p>
            </div>
          ) : (
            <p className="font-mono text-sm text-muted-foreground">booting engine…</p>
          )}
        </div>
      ) : (
        <>
          <nav className="flex gap-1 rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Terminal sections">
            {TABS.map((t) => {
              const Icon = t.icon
              const activeTab = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab}
                  aria-label={t.label}
                  title={t.label}
                  onClick={() => setTab(t.id)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 font-mono text-xs tracking-widest transition-colors ${
                    activeTab ? "bg-crimson/10 text-crimson text-glow-neon" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Form-bearing tabs stay MOUNTED (hidden) so in-progress operator
              edits survive tab switches; frozen snaps + memo keep hidden
              panels render-free. The signal tab is UNMOUNTED when hidden —
              it has no form state and runs a 1s countdown ticker that should
              not burn cycles in the background. */}
          <div role="tabpanel" hidden={tab !== "ops"} className="tab-fade-in">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <MemoCommandDeck snap={heldOps.current ?? snap} onChanged={onChanged} />
                <MemoLimitOrderPanel snap={heldOps.current ?? snap} onChanged={onChanged} />
              </div>
              <MemoLiveAccount snap={heldOps.current ?? snap} />
              <MemoProfilesPanel running={(heldOps.current ?? snap).running} onChanged={onChanged} />
            </div>
          </div>

          <div role="tabpanel" hidden={tab !== "signal"} className="tab-fade-in">
            {tab === "signal" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <MarketMonitor snap={snap} />
                <IntelFeed snap={snap} />
              </div>
            ) : null}
          </div>

          <div role="tabpanel" hidden={tab !== "ledger"} className="tab-fade-in">
            <MemoLedger snap={heldLedger.current ?? snap} active={tab === "ledger"} />
          </div>

          {/* Analytics + System have their own SWR polls gated on `active`
              (they don't consume the 1s snapshot at all). Stay mounted so
              cached data paints instantly on tab return; polling stops
              entirely while hidden. */}
          <div role="tabpanel" hidden={tab !== "analytics"} className="tab-fade-in">
            <AnalyticsPanel active={tab === "analytics"} />
          </div>

          <div role="tabpanel" hidden={tab !== "system"} className="tab-fade-in">
            <SystemPanel active={tab === "system"} />
          </div>
        </>
      )}
    </main>
  )
}
