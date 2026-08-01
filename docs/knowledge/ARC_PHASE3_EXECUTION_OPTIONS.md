# ARC Phase 3 — Execution Options (Feature Addition)

Status: IMPLEMENTED · Scope: additive only · Default behaviour: UNCHANGED

## Summary

Three operator toggles and an expanded execution-window list were added to the
Standing Limit Order engine. Every toggle defaults to ON, and ON reproduces the
previously certified production behaviour byte-for-byte. No settlement,
bankroll, ledger, PnL, risk or reconciliation logic was modified.

## Task 1 — Execution window expansion

`SLO_WINDOW_OPTIONS_SEC` (`lib/v2/engine/standing-order.ts`) now offers
`3, 5, 7, 10, 15, 30, 45, 60, 90, 120` seconds. The UI `WINDOW_CHOICES` mirrors
the list (plus `0` = disabled). Window activation logic is untouched: the
window still measures backwards from settlement and never remembers a
pre-window price touch.

## Task 2 — Compounding toggle

- ON (default): PERCENT / FIXED_USD sizing reads the live pool at fire time.
- OFF: the sizing basis is frozen at arm time into `params.sizingBasisUsd`;
  `computeOrderShares()` uses that frozen basis instead of the live pool.
- Bankroll, settlement, ledger and PnL continue to update normally in both
  modes — only the *sizing input* is frozen.
- FIXED_SHARES is unaffected (it never compounded).

## Task 3 — Trigger price toggle

- ON (default): the configured trigger gates entry timing.
- OFF: the trigger is ignored; the guardrail floor becomes the gate, so any
  in-band price inside the (optional) entry window is eligible and the resting
  order takes the lowest obtainable price.
- Invariant preserved: **direction is never derived from the trigger**. With the
  toggle OFF the side is still `computeMajority(freshSnapshot)` evaluated once,
  immediately before submission.
- Guardrail min/max band remains enforced.

## Task 4 — Limit price toggle

- ON (default): submits at the configured target price.
- OFF: submits at the current best available price on the chosen majority side
  (`execPrice = round2(sidePrice)`).
- Same order, same executor, same risk gate, same lifecycle — only the price
  input differs. No second execution path was introduced.

## Task 5 — UI

`components/v2/limit-order-panel.tsx` gained an `EXECUTION OPTIONS` fieldset
with three ON/OFF switches (`role="switch"`, `aria-checked`) and a live
plain-language summary of the active combination. State hydrates from the
snapshot, and the toggles are included in the `set_limit_order` payload and in
the guardrail re-arm payload so settings survive re-arms.

## Wiring

| Layer | Change |
| --- | --- |
| `standing-order.ts` | `Params` fields, arm/restore defaults, effective trigger, `execPrice`, snapshot exposure |
| `types.ts` | `StandingLimitOrder.compounding / useTriggerPrice / useLimitPrice` |
| `engine.ts` | `setLimitOrder` opts passthrough |
| `app/api/v2/bot/control/route.ts` | accepts and forwards the three flags |
| `limit-order-panel.tsx` | toggle UI + payload |

## Task 6 — Backward compatibility

Omitted flag == `true` == verified behaviour, enforced with `!== false` checks
in `arm()`, `restoreFromKv()` and `snapshot()`. Orders armed before this change
and restored from KV therefore come back with all toggles ON.

## Verification

New suite `tests/integration/arc-phase3-toggles.test.ts` — 17/17 pass:

- defaults ON when omitted; explicit ON behaves identically
- 3/7/10s accepted, legacy windows retained, unsupported duration rejected
- compounding ON tracks the pool; OFF freezes the basis across pool moves
- trigger OFF enters in-band without the trigger; majority still selects side;
  guardrail band still enforced
- limit OFF fills at best majority price; single order, single position
- all three OFF combined

Existing SLO suites (`standing-order`, `sizing-and-window`,
`slo-majority-at-trigger`) pass unchanged, with one test updated because `7`
became a valid window (now uses `8` as the invalid value).

`tsc --noEmit`: only the two pre-existing test-file errors. Full suite: the two
pre-existing `accounting-integrity` failures remain, unrelated to this change.
