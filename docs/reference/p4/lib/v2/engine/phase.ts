import { HOLD_MS, P1_OPEN_MS, P2_OPEN_MS } from "./config"
import type { EnginePhase, StrategyConfig } from "./types"

// ------------------------------------------------------------
// Candle phase machine — pure time-decay window classifier.
//
//  Priority 1  T-20s..T-11s
//  Priority 2  T-10s..T-3s
//  Priority 3  T-2s..T-0s : STOPPING hold state
//
// Pure and side-effect free so the live/paper pipelines share
// identical phase semantics and it stays unit-testable.
// ------------------------------------------------------------

export function phaseFor(tMinusMs: number, cfg?: StrategyConfig): EnginePhase {
  if (tMinusMs <= HOLD_MS) return "STOPPING"
  if (tMinusMs <= P2_OPEN_MS) return "PRIORITY_2"
  const p1Window = cfg?.p1WindowMs ?? P1_OPEN_MS
  if (p1Window > 0 && tMinusMs <= p1Window) return "PRIORITY_1"
  // If p1WindowMs is 0, time windows are disabled — everything outside
  // STOPPING/PRIORITY_2 is WAITING.
  return "WAITING"
}
