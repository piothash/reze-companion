# ADR-0005 — Feed provider abstraction (V1 testnet → V2 mainnet)

- Status: Accepted
- Date: 2026-08-02
- Milestone: M7.0 — Testnet Qualification & Live Engine Integration
- Supersedes: none
- Related: ADR-0001 (hybrid control plane), ADR-0004 (authority handshake)

## Context

ARC qualifies on the official Polymarket testnet using the configured testnet
TWAP feed. Chainlink Mainnet Data Streams become available on 4 August, after
which the same engine must consume a mainnet feed.

The frozen architecture forbids strategy, execution or dashboard changes when
the feed source changes. Without an abstraction, the provider choice would leak
into the feed engine, the TWAP engine, the decision engine and the dashboard.

## Decision

The feed source is resolved once, at process boot, from environment variables
only:

| Variable             | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `TWAP_FEED_PROVIDER` | Semantic provider id (`testnet`, `chainlink-datastreams`, …) |
| `TWAP_FEED_ID`       | Provider-scoped feed identifier                       |
| `TWAP_FEED_ENDPOINT` | Transport endpoint template                           |
| `NETWORK`            | `testnet` or `mainnet`                                |

`src/core/market/feed-provider.ts` owns a static registry of provider profiles.
Each profile declares its generation (`V1`/`V2`), transport (`http-json`,
`in-memory`), permitted networks, and the response paths for value and
observation timestamp. `resolveFeedProvider(env)` returns a
`ResolvedFeedProvider`; every downstream consumer reads only that struct.

Guarantees enforced in code and covered by tests:

1. A `V2` provider cannot run on `testnet`, and a `V1` provider cannot run on
   `mainnet`. Mismatch is a boot failure (`FeedProviderError`), never a silent
   downgrade.
2. Missing `TWAP_FEED_ID` or `TWAP_FEED_ENDPOINT` is a boot failure.
3. Unknown provider ids are rejected — no implicit fallback provider.
4. `loadMarketConfig` differs between a V1 and a V2 deployment in the `feed`
   section only. PTB remains sourced from official market metadata in both.
5. `describeFeedMigration(fromEnv, toEnv)` reports
   `codeChangeRequired: false` and `restartRequired: true`.

## Consequences

- The V1 → V2 migration is: edit `.env`, `pm2 restart arc-engine`, re-run the
  startup validator. No deploy of companion or engine code is required.
- Adding a future provider means adding one profile entry plus its transport;
  no consumer changes.
- The provider registry is the single place where feed semantics live, so drift
  between the engine and the dashboard is structurally impossible — the
  dashboard reads the resolved provider through `/authority/telemetry`.

## Compliance

The dashboard never contacts a feed provider directly. Feed values reach the
companion only as telemetry mirrored from the VPS trading authority, preserving
the charter rule that the VPS is the sole trading authority.
