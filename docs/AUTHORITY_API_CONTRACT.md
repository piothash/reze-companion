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

---

## Control-plane endpoints (M7.6)

The sections above describe endpoints the **engine exposes**. These are the
endpoints the **companion exposes** for the engine to call. They live under
`/api/public/authority/*` so the VPS can reach them without a browser session,
and each one authenticates the caller itself.

| Endpoint | Method | Initiated by | Purpose |
| --- | --- | --- | --- |
| `/api/public/authority/register` | POST | VPS | Announce the authority on boot |
| `/api/public/authority/heartbeat` | POST | VPS | Report liveness and runtime state |
| `/api/public/authority/configuration` | GET | VPS | Pull the version it should run |
| `/api/public/authority/configuration` | POST | VPS | Return `ACCEPTED` / `REJECTED` |

### Message authentication

Every request body is authenticated with three independent checks. All three
must pass; failing any one rejects the message.

1. **Signature** — `HMAC-SHA256(ARC_AUTHORITY_SIGNING_KEY, canonicalPayload)`,
   lowercase hex, sent as `signature`. The canonical payload is
   `JSON.stringify` over the body with keys sorted recursively, `undefined`
   dropped, and the `signature` field itself excluded
   (`canonicalAuthorityMessage` in `src/core/platform/authority-signature.ts`).
2. **Timestamp** — ISO-8601 `timestamp`, within ±60s of control-plane time.
3. **Nonce** — the SHA-256 digest of the signature is recorded in
   `authority_replay_guard` for 15 minutes; a repeat is a replay.

Comparison is constant-time. The key lives only in the server environment and
on the VPS: never in the database, never in a response, never in the browser
bundle. **If the key is not configured, every message is rejected with `503
KEY_UNCONFIGURED`** — the endpoints never fall back to accepting unsigned
traffic.

### Status codes

| Status | Meaning |
| --- | --- |
| `200` | Accepted |
| `400` | Malformed payload, or secret material offered as identity |
| `401` | `MISSING_SIGNATURE`, `SIGNATURE_INVALID`, `TIMESTAMP_EXPIRED`, `TIMESTAMP_FUTURE` |
| `403` | `AUTHORITY_REVOKED` — revoked authorities cannot re-register or heartbeat |
| `404` | `AUTHORITY_NOT_REGISTERED`, `CFG_VERSION_NOT_FOUND` |
| `409` | `SIGNATURE_REPLAYED`, `CFG_HASH_MISMATCH`, `OPERATOR_NOT_BOOTSTRAPPED` |
| `503` | `KEY_UNCONFIGURED` |

### Heartbeat body (M7.6 fields)

```jsonc
{
  "authorityId": "arc-vps-authority-01",
  "environment": "testnet",
  "engineVersion": "1.4.2",
  "platformVersion": "1.0.0",
  "status": "healthy",              // starting | healthy | degraded | halted
  "uptimeSeconds": 3600,
  "activeMarket": "BTC-UP-2026-06-01T12",
  "activeWindows": 5,
  "eventSequence": 4210,            // monotonic; a reset means a restart
  "configurationVersion": 7,
  "runtimeIdentity": "pm2-run-1",   // changes on every process start
  "heartbeatIntervalMillis": 15000,
  "timestamp": "2026-06-01T12:00:00.000Z",
  "signature": "<hex hmac>"
}
```

A changed `runtimeIdentity` is recorded as `authority.restarted` in the audit
log. A restart is never a rejection — it is evidence, surfaced to the operator.

The companion derives status from heartbeats it verified itself; the engine
cannot assert that it is `active`. The stale deadline is
`max(90s, 3 × heartbeatIntervalMillis)`.

### Configuration dispatch

```
operator publishes version  →  status PENDING (immutable, hashed)
engine GET  /configuration  →  { version, configHash, config }
engine validates against its own runtime
engine POST /configuration  →  { verdict: ACCEPTED | REJECTED, configHash }
        ACCEPTED → version ACTIVE, runtime_configuration_state = LIVE
        REJECTED → version REJECTED, nothing activated
```

The pull is engine-initiated so no inbound port is required on the VPS. The
verdict must echo the exact `configHash` of the published version; a mismatch
is refused with `CFG_HASH_MISMATCH` and the version stays `PENDING`. **No
configuration is ever marked active without a signed engine verdict.**
