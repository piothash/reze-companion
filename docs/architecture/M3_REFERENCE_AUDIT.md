# M3 — Reference Audit (Reze `lib/v2/engine/`)

Read-only audit of `docs/reference/p4/lib/v2/engine/`, performed before the ARC
Trade Domain was written. No reference file was modified, imported or bundled.

The rule applied throughout: **reuse engineering, rebuild strategy.** Anything
carrying a strategy concept was rebuilt from scratch; anything that was pure
execution mechanics was reproduced in ARC's own contracts.

## Classification

| Reference subsystem | Verdict | ARC outcome |
|---|---|---|
| `standing-order.ts` — standing limit orders | REUSE (mechanics) | Rebuilt as `standing-order-engine.ts`: resting maker orders, one session per intent, restart-safe placement, exactly-once settlement. The reference's "majority-priced contract" trigger was **removed** — ARC never chooses a side in execution. |
| `execution/live.ts` — remainder cancel with backoff | REUSE | Retry count and delay are configuration, not constants (`ORDER_RETRY_COUNT`, `ORDER_RETRY_DELAY_MS`). |
| `execution/executor.ts` / `paper.ts` — executor interface | REUSE | Rebuilt as the `VenueGateway` port plus `RecordingVenueGateway` for deterministic replay. |
| Partial-fill accounting (`live.ts`, `paper.ts`) | REUSE | Reproduced: exchange-reported quantity is the only source of truth, fills idempotent on the venue fill id, remainder always cancelled, quantity never assumed from the request. |
| Settlement hooks (`settlement-verifier.ts`, `settlement-repair.ts`) | REUSE (shape) | Terminal `ExecutionReport` handed to a settlement hook exactly once per session. Chainlink/spot-fallback resolution stays on the VPS — it is trading authority, not companion logic. |
| `handlers/cancel-replace-pipeline.ts` | REUSE | Cancel/replace repricing with a bounded budget and a "verify dead before repost" guard. |
| `risk.ts` — pre-order gate | REUSE | Rebuilt as the pure `evaluateRisk` function; limits are configuration, the kill switch denies unconditionally, and every check is always evaluated. |
| `watchdog.ts`, `reconciler.ts` | REUSE (deferred) | Monitoring and reconciliation belong to M4/M5 platform services, not the Trade Domain. |
| `handlers/orphan-cleaner.ts` | REFACTOR | The FOK-flatten mechanism is generic, but it is framed around the named "Edge 1" two-leg strategy. Not ported in M3; the IOC fallback covers the immediate-fill need. |
| `phase.ts` — P1/P2/STOPPING windows | REMOVE | Strategy-specific time-window model. ARC windows are dynamic and live in the Decision Domain (M2). |
| `engine.ts`, `market-model.ts` — strike + drift padding | REMOVE | The reference's "sniper" strategy. ARC's strategy is TWAP-native and already implemented in M2. Never ported. |

## Strategy concepts explicitly excluded from `src/core/trade`

TWAP, effective TWAP, price-to-beat, window buffers, execution windows, window
offsets, execution profiles, majority direction, confidence, crowd sentiment,
Binance direction, strike prices and drift padding. The Standing Limit Order
Engine receives `ExecutionConstraints` and cannot reconstruct any of them.

## Notable reference findings carried into ARC

- Almost no retry/timeout/reprice value in the reference is environment driven;
  they are hardcoded module constants. ARC inverts this: every one of them is
  configuration, validated at startup.
- The reference hardened partial-fill and settlement paths against a real
  production incident. ARC keeps the same invariants: authoritative filled
  quantity, exactly-once fill reporting, exactly-once settlement.
