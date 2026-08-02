# ARC — Authority API Contract

The VPS trading engine exposes these endpoints to the companion. All are
read-only from the companion's perspective except where explicitly noted.
Authentication is a bearer token (`Authorization: Bearer <AUTHORITY_TOKEN>`).

## `GET /authority/health`

Liveness probe. Returns `200` with subsystem status. Used by the registry to set
`last_seen_at`.

## `GET /authority/handshake` (ADR-0004)

Identity and capability exchange. Returns engine id, public identifier,
environment, network, engine/platform/API versions, active configuration version
and hash, snapshot id, subsystem health and capability flags.

The companion compares the returned configuration version and hash against
`runtime_configuration_state`. A mismatch raises configuration drift; the
companion never resolves drift on its own.

## `GET /authority/telemetry` (M7.0)

Live runtime telemetry. Polled by the dashboard. Validated against
`runtimeTelemetrySchema` in `src/core/platform/runtime-telemetry.ts`.

```jsonc
{
  "emittedAtIso": "2026-08-02T08:00:00.000Z",
  "syncIntervalMillis": 5000,
  "markets": [
    {
      "marketInstanceId": "...",
      "slug": "...",
      "venue": "polymarket",
      "lifecycleState": "ACTIVE",
      "priceToBeat": 61234.5,      // official metadata — never computed locally
      "priceToBeatSource": "market-metadata",
      "resolutionIso": "...",
      "outcomeTokens": [{ "outcomeKey": "UP", "tokenId": "..." }]
    }
  ],
  "feed": {
    "providerId": "testnet",
    "generation": "V1",
    "network": "testnet",
    "feedId": "...",
    "runningTwap": 61200.1,
    "effectiveTwap": 61205.4,
    "observationCount": 812,
    "lastObservationIso": "...",
    "ageMillis": 1200,
    "stalenessBudgetMillis": 10000
  },
  "windows": [
    {
      "windowInstanceId": "...",
      "offsetSeconds": 15,
      "state": "OPEN",
      "bufferPercent": 0.4,
      "activatesAtIso": "...",
      "expiresAtIso": "...",
      "decision": "BUY_UP",
      "reasonCode": "DEC_SIGNAL_CONFIRMED"
    }
  ],
  "scheduler": { "tickCount": 0, "lastTickIso": "...", "driftMillis": 0 },
  "execution": {
    "openOrders": 0,
    "tradesThisMarket": 0,
    "tradesQuota": 3,
    "exposureNotional": 0,
    "killSwitchEngaged": false
  },
  "process": { "startedAtIso": "...", "uptimeSeconds": 0, "restartCount": 0 }
}
```

Every field except `emittedAtIso` and `markets` is nullable. A partially
reporting engine renders as partial UI, never as fabricated zeros.

## Companion behaviour

| Engine state | Dashboard |
| --- | --- |
| Reachable, telemetry current | `LIVE` badge, values rendered |
| Reachable, telemetry older than 2 sync intervals | `LIVE` badge, `STALE` freshness |
| Unreachable, mirror exists | `MIRRORED` badge with mirror age |
| Unreachable, no mirror | `AWAITING AUTHORITY` empty state |

## Configuration endpoints (ADR-0003)

`POST /authority/configuration/activate` is the only companion-initiated write.
The companion publishes an immutable version to the database first; the engine
validates, activates and confirms. Activation without engine confirmation is
never recorded as active.
