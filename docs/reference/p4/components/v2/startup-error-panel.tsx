"use client"

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import type { StartupState } from "@/lib/v2/engine/types"

/**
 * Phase 6C — persistent startup error panel.
 *
 * Renders when the engine has a sticky `startup.lastError` and is not
 * running. Never displays secret values — only the names of missing
 * configuration items — and remains visible until the next successful
 * ignition clears the sticky failure server-side.
 */
export function StartupErrorPanel({ startup }: { startup: StartupState | undefined }) {
  if (!startup || !startup.blocked || !startup.lastError) return null
  const { code, reason, missing, action, atMs } = startup.lastError
  const when = new Date(atMs).toLocaleTimeString()
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col gap-2 rounded-md border border-crimson/60 bg-crimson/10 p-3 font-mono text-xs"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-crimson" aria-hidden />
        <span className="tracking-widest text-crimson">STARTUP REJECTED</span>
        <span className="ml-auto text-[10px] text-muted-foreground">at {when}</span>
      </div>
      <div className="text-foreground">{reason}</div>
      {missing.length > 0 ? (
        <>
          <div className="mt-1 text-[10px] tracking-widest text-muted-foreground">
            MISSING CONFIGURATION
          </div>
          <ul className="flex flex-col gap-0.5 pl-1">
            {missing.map((m) => (
              <li key={m} className="flex items-center gap-2">
                <XCircle className="size-3 text-crimson" aria-hidden />
                <span className="text-crimson">{m}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="mt-1 flex items-start gap-2 rounded border border-border bg-background/30 p-2">
        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-neon" aria-hidden />
        <span className="text-muted-foreground">{action}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Engine remains stopped. Code: <span className="text-foreground">{code}</span>
      </div>
    </div>
  )
}
