# ARC — Testnet Qualification Procedure (M7.0)

Status: active · Scope: testnet only · Mainnet is out of scope until ADR-0005 V2
migration is executed.

The companion is the control plane. The VPS trading engine is the sole trading
authority. Nothing in this procedure asks the dashboard to trade, price, compute
TWAP, or derive PTB.

## 1. Runtime topology

```
Operator ─ Companion Dashboard (Cloudflare) ─┬─ Lovable Cloud (persistence, audit)
                                             └─ VPS Trading Engine (PM2)
                                                  ├─ Official testnet TWAP feed
                                                  ├─ Polymarket testnet metadata (PTB)
                                                  └─ Polymarket testnet CLOB
```

Direction of authority is one-way: the engine emits, the companion records and
displays. The companion never writes runtime state the engine did not confirm.

## 2. Engine environment (`.env` on the VPS)

| Variable | Testnet (V1) value |
| --- | --- |
| `ARC_ENVIRONMENT` | `testnet` |
| `NETWORK` | `testnet` |
| `TWAP_FEED_PROVIDER` | `testnet` |
| `TWAP_FEED_ID` | official testnet feed id |
| `TWAP_FEED_ENDPOINT` | official testnet feed endpoint template |
| `TWAP_WINDOW_SECONDS` | per execution profile |
| `MARKET_DISCOVERY_BASE_URL` | Polymarket testnet metadata base |
| `MARKET_SLUG_TEMPLATE` | hourly BTC slug template |
| `CLOB_BASE_URL` | Polymarket testnet CLOB |
| `AUTHORITY_TOKEN` | shared bearer for the companion |

Never place wallet keys, exchange credentials, or the authority token in the
companion repository. The companion stores only the endpoint URL and reads the
token from a backend secret.

## 3. Qualification gates

Each gate must be observed on the dashboard, not asserted from logs alone.

| # | Gate | Observed on |
| --- | --- | --- |
| 1 | Engine registered, handshake `CONNECTED` | Engine Registry / Health |
| 2 | Startup validator: 14/14 gates pass | Health |
| 3 | Feed live, freshness `FRESH`, observation count rising | Signal Tank |
| 4 | Running TWAP and effective TWAP both present | Signal Tank |
| 5 | Market discovered from official metadata, PTB present and engine-sourced | Markets |
| 6 | Market lifecycle advances `DISCOVERED → ACTIVE → RESOLVED` | Markets |
| 7 | Windows arm at 15/10/7/5/3s with live countdowns | Active Windows |
| 8 | Decision emitted per window with reason code | Signal Tank |
| 9 | Risk evaluation recorded, kill switch reachable | Trade Monitor |
| 10 | Order placed on testnet CLOB, reprice and cancel observed | Trade Monitor |
| 11 | Fill → settlement → ledger record traced end to end | Trade Monitor |
| 12 | Configuration publish → VPS activation → active version matches saved | Execution Profiles |
| 13 | PM2 restart: engine recovers, no duplicate intents | Health / Trade Monitor |
| 14 | Replay of the session is deterministic, zero mismatches | Replay |

A gate that cannot be observed is a failed gate. Do not proceed to mainnet with
an unobserved gate.

## 4. Telemetry contract

The dashboard polls `GET /authority/telemetry` on the registered endpoint. The
payload is validated against `runtimeTelemetrySchema`. Behaviour when the engine
is unreachable:

- Last mirrored payload is displayed, badged `MIRRORED` with its age.
- With no mirror at all, panels show `AWAITING AUTHORITY` — never zeros, never
  fabricated values, never an indefinite spinner.

Freshness is classified against the engine's own staleness budget: `FRESH`,
`AGING`, `STALE`, `UNKNOWN`.

## 5. PM2 validation

```bash
pm2 start ecosystem.config.cjs --only arc-engine
pm2 logs arc-engine --lines 100
pm2 restart arc-engine     # gate 13
pm2 save
```

After each restart, confirm on Health that the startup validator re-ran and the
handshake returned to `CONNECTED`, and on Trade Monitor that no intent was
duplicated across the restart boundary.

## 6. Mainnet migration (V2, after 4 August)

Per ADR-0005 this is an environment change only:

```
TWAP_FEED_PROVIDER=chainlink-datastreams
TWAP_FEED_ID=<mainnet stream id>
TWAP_FEED_ENDPOINT=<data streams endpoint>
NETWORK=mainnet
```

Then `pm2 restart arc-engine`. No companion deploy, no strategy change, no
dashboard change. The provider guard rejects a V1 provider on mainnet and a V2
provider on testnet at boot, so a half-migrated `.env` fails fast instead of
trading against the wrong feed.
