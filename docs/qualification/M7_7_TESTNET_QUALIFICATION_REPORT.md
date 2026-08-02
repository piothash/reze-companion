# ARC — M7.7 Testnet Qualification Report

Status: **Companion-side qualification complete — live gates pending VPS evidence**
Scope: validation only. No strategy logic was added and no frozen contract changed.

## 1. Qualification environment

| Item | Value |
| --- | --- |
| Environment | `testnet` |
| Feed provider | V1 testnet TWAP feed (ADR-0005 environment-only switch) |
| Trading authority | VPS (sole authority; the companion never executes) |
| Control plane | ARC Companion + Lovable Cloud backend |
| Deterministic harness | `src/core/qualification/scenario.ts` |
| Gate catalogue | `src/core/qualification/gates.ts` |
| Evidence tests | `tests/unit/m77-testnet-qualification.test.ts` |
| Operator console | `/qualification` |

The harness is driven by a `FixedClock` and an in-memory feed series, so every
run is reproducible byte-for-byte. It wires the frozen domains only:
Market State → Decision → Trade.

## 2. Startup qualification sequence

1. Environment validated (startup validator gates, M6.5).
2. Market metadata parsed from official discovery output; PTB taken from
   metadata only.
3. Feed ingests observations; TWAP basket fills; signal conditioning produces
   an effective TWAP.
4. Execution profile loaded; one window instance created per enabled
   definition, ordered by descending offset.
5. Authority registration and telemetry heartbeat confirmed (live evidence).

## 3. Full trading lifecycle

Observed in order, exactly once per intent:

`market.state.updated` → `decision.window.activated` → `decision.intent.created`
→ `trade.risk.approved` → `trade.exposure.reserved` → `trade.order.submitted`
→ `trade.order.filled` → `trade.execution.completed`

Settlement releases every reservation: reserved exposure returns to `0`.

## 4. Multi-window validation

- Windows activate at T-15s, T-10s, T-7s, T-5s, T-3s — priority derived from
  the offset, never configured.
- The trade quota is enforced before the Decision Engine is invoked; once the
  quota is exhausted later windows complete with `QUOTA_EXHAUSTED`.
- `SINGLE_TRADE` yields exactly one execution intent per market instance.

## 5. Replay qualification

- Two identical runs produce an identical event stream, identical intents and
  identical settled notional.
- `replayEvents` reconstructs the recorded stream with `deterministic: true`
  and zero mismatches across all six validations.

## 6. Recovery qualification

- Re-submitting a recorded execution intent after a restart is suppressed as
  `DUPLICATE`; no second order reaches the venue gateway.
- Settlement hooks fire exactly once per execution intent.

## 7. Risk qualification

- Kill switch engaged → every intent denied with `KILL_SWITCH`, no orders, no
  settlements.
- Spread above the risk profile → denial before exposure reservation.

## 8. Observability validation

The `/qualification` console renders the gate checklist with live evidence:

- authority registration and telemetry freshness (`getRuntimeTelemetry`),
- active runtime configuration status (`getConfigurationRuntimeView`),
- deterministic evidence from the local qualification run.

## 9. Production gate checklist

| Gate | Source | Result |
| --- | --- | --- |
| Startup sequence completes | live | pending VPS run |
| Full trading lifecycle observed | deterministic | PASS |
| Settlement releases exposure | deterministic | PASS |
| Windows activate by descending offset | deterministic | PASS |
| Trade quota enforced | deterministic | PASS |
| Replay byte-identical | deterministic | PASS |
| Restart never double-executes | deterministic | PASS |
| Configuration reaches the authority | live | pending VPS run |
| Telemetry and events visible | live | pending VPS run |

## 10. Acceptance criteria

Companion-side acceptance criteria are met. The overall verdict stays
`PENDING` until the live VPS authority supplies startup, configuration and
telemetry evidence; the console flips to `PASS` automatically once every gate
reports positive evidence, and to `FAIL` on any negative one.
