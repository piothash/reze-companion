// ============================================================================
// P4 · DIRECTION & PNL RUNTIME TRACER (Phase 1 — Stage 1A)
// ============================================================================
// Additive, env-gated instrumentation used to prove/disprove direction and
// PnL divergence in the running bot without touching trading behavior.
//
// ENABLE:   set env `P4_DIAG_DIRECTION=1` before starting the process.
// DISABLE:  unset the variable (default). Every call becomes a cheap no-op:
//           `enabled()` returns false and no allocation/logging happens.
//
// REMOVAL:
//   1. Remove imports of this file from:
//        - lib/v2/engine/standing-order.ts
//        - lib/v2/engine/engine.ts
//        - lib/v2/engine/execution/live.ts
//   2. Remove the trace() call sites (search for `dtrace.` in those files).
//   3. Delete this file and its neighbouring test.
// The whole module is self-contained: no other production code depends on it.
//
// GUARANTEES:
//   • Never throws — every call is wrapped in try/catch inside the module.
//   • Never blocks — writes to an in-process ring buffer, logs one JSON line.
//   • Never allocates when disabled — the fast path is `if (!ENABLED) return`.
// ============================================================================
import { logEvent } from "../events"

const ENABLED = process.env.P4_DIAG_DIRECTION === "1"
const RING_MAX = 1024

export type TraceHop =
  | "signal"
  | "slo-trigger"
  | "slo-direction-lock"
  | "slo-order-construct"
  | "slo-risk"
  | "slo-fill"
  | "slo-settlement-input"
  | "slo-settlement-result"
  | "engine-order-ids"
  | "engine-fill"
  | "engine-settlement-input"
  | "engine-settlement-result"
  | "live-place-order-request"
  | "live-place-order-ack"
  | "live-check-fill"
  | "live-token-mismatch"
  | "recovery"

export interface TraceRecord {
  ts: number
  traceId: string
  hop: TraceHop
  payload: Record<string, unknown>
}

// Simple in-memory ring buffer, safe under Node single-thread semantics.
const ring: TraceRecord[] = []

/** Cheap enable check. Callers can gate expensive payload construction with this. */
export function enabled(): boolean {
  return ENABLED
}

/** Generate a correlation id for one trade's lifecycle. */
export function newTraceId(): string {
  // Cheap, human-readable; not a security-critical id.
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Record a hop. No-op when disabled. Never throws. Never blocks.
 * @param traceId  correlation id for this trade lifecycle
 * @param hop      lifecycle stage (see TraceHop)
 * @param payload  structured JSON-safe fields; do NOT include secrets
 */
export function trace(traceId: string | null | undefined, hop: TraceHop, payload: Record<string, unknown>): void {
  if (!ENABLED) return
  try {
    const rec: TraceRecord = { ts: Date.now(), traceId: traceId ?? "-", hop, payload }
    ring.push(rec)
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
    // One structured line per hop — greppable from the process log.
    logEvent("info", `[dtrace] ${hop} ${JSON.stringify({ traceId: rec.traceId, ...payload })}`)
  } catch {
    /* diagnostics must never crash a trading loop */
  }
}

/** Snapshot the most recent N entries for dashboard/API consumers. */
export function getRecentTraces(limit = 200): TraceRecord[] {
  if (!ENABLED) return []
  const n = Math.max(0, Math.min(limit, ring.length))
  return ring.slice(ring.length - n)
}

/** Test/administrative reset. Safe to call at any time. */
export function _resetForTests(): void {
  ring.length = 0
}
