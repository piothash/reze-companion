"use client"

import useSWR from "swr"
import type { EngineSnapshot } from "@/lib/v2/engine/types"

interface CredsResponse {
  ok: boolean
  liveReady: boolean
  items: { name: string; present: boolean; description: string }[]
  missing: string[]
  generatedAtMs: number
}

const credsFetcher = async (url: string): Promise<CredsResponse> => {
  const r = await fetch(url, { cache: "no-store" })
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
}

function fmtTs(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : "—"
}

/**
 * Phase 6C — Engine Status Panel.
 *
 * Read-only aggregation of engine mode + running + startup lifecycle +
 * kill-switch + account sync + market feed status + credential presence.
 * Everything is drawn from the same snapshot the trading loop uses, so the
 * dashboard state cannot drift from the backend state.
 */
export function EngineStatusPanel({ snap }: { snap: EngineSnapshot }) {
  const { data: creds } = useSWR<CredsResponse>(
    "/api/v2/bot/diagnostics/credentials",
    credsFetcher,
    { refreshInterval: 15_000, revalidateOnFocus: false },
  )

  const startup = snap.startup
  const runningLabel = snap.running ? "RUNNING" : "STOPPED"
  const runningTone = snap.running ? "text-neon" : "text-muted-foreground"
  const killTone = snap.risk?.killSwitch?.engaged ? "text-crimson" : "text-neon"
  const wsInfo = snap.feedSnapshotInfo
  const wsFreshMs = wsInfo?.wsFreshMs ?? null
  const wsTone = wsFreshMs !== null && wsFreshMs < 15_000 ? "text-neon" : "text-caution"
  const acct = snap.liveAccount
  const acctTone = !acct ? "text-muted-foreground" : acct.errors.length ? "text-caution" : "text-neon"

  return (
    <section
      aria-label="Engine Status"
      className="flex flex-col gap-3 rounded-md border border-border bg-secondary/40 p-3 font-mono text-xs"
    >
      <header className="flex items-center justify-between">
        <span className="tracking-widest text-muted-foreground">ENGINE STATUS</span>
        <span className={`rounded px-2 py-0.5 ${runningTone}`}>{runningLabel}</span>
      </header>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Row label="Mode" value={snap.mode} />
        <Row label="Phase" value={snap.phase} />
        <Row
          label="Startup blocked"
          value={startup?.blocked ? "YES" : "NO"}
          tone={startup?.blocked ? "text-crimson" : "text-neon"}
        />
        <Row label="Kill switch" value={snap.risk?.killSwitch?.engaged ? "ENGAGED" : "CLEAR"} tone={killTone} />
        <Row label="Last attempt" value={fmtTs(startup?.lastAttemptMs ?? null)} />
        <Row label="Last success" value={fmtTs(startup?.lastSuccessMs ?? null)} />
        <Row label="Last failure" value={fmtTs(startup?.lastFailureMs ?? null)} />
        <Row
          label="Account sync"
          value={!acct ? "PAPER / not started" : acct.errors.length ? `errors: ${acct.errors.length}` : "OK"}
          tone={acctTone}
        />
        <Row
          label="Market feed"
          value={wsFreshMs === null ? "no snapshot" : `${Math.round(wsFreshMs / 1000)}s fresh`}
          tone={wsTone}
        />
        <Row
          label="LIVE creds ready"
          value={creds ? (creds.liveReady ? "YES" : `MISSING ${creds.missing.length}`) : "…"}
          tone={creds && !creds.liveReady ? "text-crimson" : "text-neon"}
        />
      </dl>

      {startup?.lastError ? (
        <div className="rounded border border-crimson/40 bg-crimson/10 p-2">
          <div className="text-[10px] tracking-widest text-crimson">STARTUP FAILURE REASON</div>
          <div className="mt-1 text-foreground">{startup.lastError.reason}</div>
          {startup.lastError.missing.length > 0 ? (
            <div className="mt-1 text-[10px] text-crimson">
              Missing: {startup.lastError.missing.join(", ")}
            </div>
          ) : null}
        </div>
      ) : null}

      {creds && !creds.liveReady ? (
        <div className="rounded border border-caution/40 bg-caution/5 p-2">
          <div className="text-[10px] tracking-widest text-caution">CREDENTIAL DIAGNOSTICS</div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {creds.items.map((it) => (
              <li key={it.name} className="flex items-center justify-between">
                <span className="text-muted-foreground">{it.name}</span>
                <span className={it.present ? "text-neon" : "text-crimson"}>
                  {it.present ? "✓ present" : "✗ missing"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Presence only — secret values are never read or displayed.
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right ${tone ?? "text-foreground"}`}>{value}</dd>
    </>
  )
}
