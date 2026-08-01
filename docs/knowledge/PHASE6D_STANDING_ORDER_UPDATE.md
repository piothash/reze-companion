# Phase 6D — Standing Limit Order Majority-Side Update

## Objective

Change the Standing Limit Order (SLO) execution so the BUY side is chosen
from the **live majority** at the instant the trigger fires, instead of
from whichever side crossed the trigger first.

The trigger detection, order placement, settlement, accounting,
reconciliation, risk-engine, duplicate-protection, and restart-recovery
paths are unchanged.

## Required flow (implemented)

```text
execution window opens
        ↓
continuously monitor live market (WS + fast REST fallback)
        ↓
trigger price reached                              ← unchanged
        ↓
read latest atomic snapshot (this.tickSnapshot)    ← unchanged
        ↓
determine majority side (max of up/down)           ← Phase 6D
        ↓
place LIMIT BUY on majority side @ target          ← Phase 6D redirect
        ↓
existing pipeline (risk gate → placeOrder → fill → settlement …)
```

## Code change

Single insertion in
`reference/p4/lib/v2/engine/standing-order.ts` inside the trigger-fire
branch of `tick()`, immediately before the market-id lookup:

```ts
// Phase 6D — MAJORITY-SIDE EXECUTION.
if (this.lockedDirection === null) {
  const majority = this.computeMajority(this.tickSnapshot)
  if (majority.side !== null && majority.side !== side) {
    logEvent("info", `Standing limit MAJORITY OVERRIDE: …`)
    side = majority.side
    sidePrice = majority.price
  }
}
```

The corresponding `DIRECTION LOCKED` log now records the side as the
majority selection rather than the "race winner".

## Why this is safe

- `this.tickSnapshot` is the **same atomic snapshot** the trigger evaluated,
  captured at the top of the current tick. A torn read between UP and
  DOWN is structurally impossible, so trigger and majority are always
  computed from the same instant.
- `computeMajority()` already exists and is used pre-lock; the fix reuses
  it verbatim.
- The override only runs when `lockedDirection === null` (before the
  direction is committed). Post-lock behaviour is untouched.
- If majority side is null (no snapshot) the override is skipped and the
  pre-Phase-6D fallback side is used — no regression.
- The redirected `side` variable is passed through to the identical order
  ID lookup, risk gate, placement call, ledger persistence, and lock
  recording.

## Guarantees preserved

- One order per window (`readyForTrigger` gate + `restingOrder` guard).
- Direction lock (`triggerLock` frozen on placement, cleared only on
  fill / cancel / slot rollover / market-identity change).
- Persistence & restart recovery (`persistState()` is called after the
  redirect, before network I/O).
- Risk engine, executor, settlement, ledger, and reconciler all receive
  the same `{ side, price, shares }` shape they always did.

## Interaction with the "trigger race" concept

The pre-Phase-6D docs and inline comments describe a "race": the first
side to cross the trigger wins. With the majority override in place, the
race is now:

1. The trigger detection still requires **some** side to cross.
2. Once crossed, the execution side is the majority side from the same
   snapshot.

In practice (`trigger ≈ 0.97`, binary market where `UP + DOWN ≈ $1`) the
crossing side IS the majority, and the override never fires. The
override matters for lower triggers where multiple sides can straddle
the threshold: e.g. `trigger = 0.50`, `UP = 0.55`, `DOWN = 0.45` — old
code could have bought UP purely because it crossed the trigger first;
new code buys the majority, which is also UP but only because it is the
larger side, not because it "won" a race. If the market flipped to
`UP = 0.45`, `DOWN = 0.55` at the exact trigger instant, the old code
could have executed on UP; the new code executes on DOWN.

## Example

Configuration:

```
Trigger:       0.97
Limit target:  0.99
Window:        last 45 s
```

Scenario A: `UP = 0.97, DOWN = 0.03` → majority = UP → **BUY UP @ 0.99**.

Scenario B: `DOWN = 0.97, UP = 0.03` → majority = DOWN → **BUY DOWN @ 0.99**.

Both scenarios were already correct under the pre-Phase-6D race logic
(the crossing side matched the majority). The override guarantees they
remain correct under any lower trigger too.

## What was not modified

- Order placement path
- Risk engine
- Settlement / accounting
- Reconciliation
- Duplicate-protection (`readyForTrigger`, `restingOrder`, `triggerLock`
  generation guard)
- Restart recovery (persisted `lockedDirection`, `restingOrder`,
  `triggerLock`)
- Standing-order snapshot / dashboard shape

## Regression coverage

See `docs/knowledge/REGRESSION_REPORT.md` — the majority-override branch
is exercised by new cases:

- `majority side matches trigger side` → override is a no-op.
- `majority side differs from trigger side` → override redirects.
- `no snapshot at trigger time` → fallback path preserved.
- `pre-lock majority flips` → resting order cancelled on flip
  (existing behaviour, re-verified).
- `post-lock behaviour unchanged` → majority override does not fire
  after direction lock.
