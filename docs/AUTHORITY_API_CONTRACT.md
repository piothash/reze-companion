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

## Authority registration endpoints (M7.5)

Registration is **engine-initiated**. The companion never fabricates an
authority and never holds credential material for one.

| Endpoint | Method | Initiated by | Purpose |
| --- | --- | --- | --- |
| `/authority/register` | POST | VPS | Announce a trading authority to the control plane |
| `/authority/heartbeat` | POST | VPS | Keep the registration live |
| `/authority/status` | GET | Companion | Read authority state |
| `/authority/telemetry` | GET | Companion | Read runtime telemetry |

### `POST /authority/register`

```json
{
  "authorityId": "arc-vps-authority-01",
  "name": "ARC VPS Authority",
  "environment": "testnet",
  "engineVersion": "0.1.0",
  "platformVersion": "0.1.0",
  "capabilities": ["decision", "risk", "execution"],
  "publicKey": "<optional public identity only>",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "signature": "<base64 signature over the payload>"
}
```

`timestamp` and `signature` are mandatory on both endpoints. The payload is
rejected — by the schema and again by a database trigger — if any field looks
like secret material (private keys, mnemonics, API secrets, `0x`-prefixed
32-byte hex). Only public identity is stored.

### `POST /authority/heartbeat`

```json
{
  "authorityId": "arc-vps-authority-01",
  "environment": "testnet",
  "engineVersion": "0.1.0",
  "platformVersion": "0.1.0",
  "timestamp": "2026-01-01T00:00:30.000Z",
  "signature": "<base64 signature over the payload>"
}
```

### Derived status

Status is derived from the last heartbeat, never asserted by the console:

| Condition | Status |
| --- | --- |
| Revoked by the operator | `revoked` |
| No heartbeat yet | `registered` |
| Last heartbeat within 90s | `active` |
| Last heartbeat older than 90s | `stale` |

The registry is visible read-only at **Engine Registry → Trading Authority
Registry**. Registration and revocation are refused when the deployment's
cutover guard does not match the active backend.
