/**
 * ARC — live runtime telemetry surfaces (M7.0).
 *
 * Presentation only. Every value comes from the engine's telemetry document;
 * unreported fields read "—" and the source (LIVE / MIRRORED) is always shown,
 * so an operator can never mistake a stale mirror for a live reading.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { EmptyState, KeyValue, Metric, Panel, StatusPill, type StatusTone } from "./primitives";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { getRuntimeTelemetry } from "@/lib/engine.functions";
import {
  classifyFeedFreshness,
  orderWindowsByOffset,
  secondsUntil,
  selectActiveWindow,
  type FeedFreshnessClass,
  type TelemetrySource,
} from "@/core/platform/runtime-telemetry";

export type TelemetryView = Awaited<ReturnType<typeof getRuntimeTelemetry>>;

const SOURCE_TONE: Record<TelemetrySource, StatusTone> = {
  LIVE: "healthy",
  MIRRORED: "degraded",
  NONE: "unavailable",
};

const FRESHNESS_TONE: Record<FeedFreshnessClass, StatusTone> = {
  FRESH: "healthy",
  AGING: "degraded",
  STALE: "unavailable",
  UNKNOWN: "neutral",
};

/**
 * Continuous telemetry synchronization at the engine's registered interval,
 * with refetch on focus and reconnect so recovery needs no manual refresh.
 */
export function useRuntimeTelemetry() {
  const fetchTelemetry = useServerFn(getRuntimeTelemetry);
  return useQuery({
    queryKey: ["arc", "runtime-telemetry"],
    queryFn: () => fetchTelemetry(),
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query) =>
      (query.state.data as TelemetryView | undefined)?.syncIntervalMillis ?? 5_000,
  });
}

export function TelemetrySourcePill({ view }: { view: TelemetryView | undefined }) {
  const source = view?.source ?? "NONE";
  return <StatusPill tone={SOURCE_TONE[source]} label={source === "NONE" ? "NO AUTHORITY" : source} />;
}

/** Ticks once a second so countdowns are live without refetching. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function seconds(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "T−" : "T+"}${Math.abs(value)}s`;
}

/** Running TWAP, effective TWAP, observation count, freshness and latency. */
export function LiveFeedPanel({ view }: { view: TelemetryView | undefined }) {
  const feed = view?.telemetry?.feed ?? null;
  const freshness = classifyFeedFreshness(feed?.ageMillis ?? null, feed?.maxStalenessMillis ?? null);

  if (!feed) {
    return (
      <Panel title="Live TWAP Feed" actions={<TelemetrySourcePill view={view} />}>
        <EmptyState
          message="The trading authority is not publishing feed telemetry."
          hint={view?.detail ?? "Register and connect an engine to stream live observations."}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Live TWAP Feed"
      actions={
        <div className="flex items-center gap-2">
          <StatusPill tone={FRESHNESS_TONE[freshness]} label={freshness} />
          <TelemetrySourcePill view={view} />
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Running TWAP" value={fmt(feed.runningTwap)} hint="Engine rolling window" />
        <Metric label="Effective TWAP" value={fmt(feed.effectiveTwap)} hint="Conditioned signal" />
        <Metric label="Observations" value={fmtInt(feed.observationCount)} hint={`Window ${fmtInt(feed.windowSeconds)}s`} />
        <Metric
          label="Feed Latency"
          value={feed.latencyMillis === null ? "—" : `${feed.latencyMillis} ms`}
          hint={feed.ageMillis === null ? "Age not reported" : `Age ${feed.ageMillis} ms`}
        />
      </div>
      <div className="mt-4">
        <KeyValue
          rows={[
            ["Provider", feed.providerId ?? feed.provider ?? "—"],
            ["Generation", feed.generation ?? "—"],
            ["Network", feed.network ?? view?.telemetry?.network ?? "—"],
            ["Feed ID", feed.feedId ?? "—"],
            ["Status", feed.status ?? "—"],
            ["Connected", feed.connected === null ? "—" : feed.connected ? "yes" : "no"],
            ["Last Observation", fmtTime(feed.lastObservationIso)],
            ["Staleness Budget", feed.maxStalenessMillis === null ? "—" : `${feed.maxStalenessMillis} ms`],
            ["Missed Observations", fmtInt(feed.missedObservations)],
            ["Feed Reconnects", fmtInt(feed.reconnectCount)],
            ["Precision", fmtInt(feed.precision)],
          ]}
        />
      </div>
    </Panel>
  );
}

/** Configured windows with live countdowns and the current active window. */
export function LiveWindowsPanel({ view }: { view: TelemetryView | undefined }) {
  const now = useNow();
  const windows = orderWindowsByOffset(view?.telemetry?.windows ?? []);
  const active = selectActiveWindow(windows, now);

  return (
    <Panel
      title="Live Window Countdowns"
      actions={
        <div className="flex items-center gap-2">
          <StatusPill
            tone={active ? "healthy" : "neutral"}
            label={active ? `ACTIVE ${active.offsetSeconds ?? "?"}s` : "NO ACTIVE WINDOW"}
          />
          <TelemetrySourcePill view={view} />
        </div>
      }
    >
      {windows.length === 0 ? (
        <EmptyState
          message="The engine reports no window instances."
          hint="Windows appear as the scheduler opens them against a live market."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {windows.map((window) => {
            const untilOpen = secondsUntil(window.activatesAtIso, now);
            const untilClose = secondsUntil(window.expiresAtIso, now);
            const isActive = active?.windowInstanceId === window.windowInstanceId;
            return (
              <div
                key={window.windowInstanceId}
                className={`rounded-lg border px-3 py-2 ${
                  isActive ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <p className="label-caps">
                  {window.offsetSeconds === null ? window.windowInstanceId : `${window.offsetSeconds}s window`}
                </p>
                <p className="mt-1 font-mono text-lg leading-tight">
                  {seconds(untilClose ?? untilOpen)}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {window.state ?? "—"} · buffer {window.bufferPercent === null ? "—" : `${window.bufferPercent}%`}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {window.decision ?? "NO_SIGNAL"}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** Official market metadata as published by the authority (PTB included). */
export function LiveMarketPanel({ view }: { view: TelemetryView | undefined }) {
  const markets = view?.telemetry?.markets ?? [];
  if (markets.length === 0) {
    return (
      <Panel title="Live Market Metadata" actions={<TelemetrySourcePill view={view} />}>
        <EmptyState
          message="No live market is published by the trading authority."
          hint={view?.detail ?? "Market discovery runs on the engine; the console mirrors what it reports."}
        />
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      {markets.map((market) => (
        <Panel
          key={market.marketInstanceId}
          title={market.question ?? market.slug ?? market.marketInstanceId}
          actions={
            <div className="flex items-center gap-2">
              <StatusPill
                tone={market.tradingEnabled ? "healthy" : "degraded"}
                label={market.lifecycle ?? market.status ?? "UNKNOWN"}
              />
              <TelemetrySourcePill view={view} />
            </div>
          }
        >
          <KeyValue
            rows={[
              ["Market ID", market.marketId ?? market.marketInstanceId],
              ["Slug", market.slug ?? "—"],
              ["Venue", market.venue ?? "—"],
              ["Status", market.status ?? "—"],
              ["Trading Enabled", market.tradingEnabled === null ? "—" : market.tradingEnabled ? "yes" : "no"],
              ["End Time", fmtTime(market.endTimeIso)],
              ["Resolution Time", fmtTime(market.resolutionIso)],
              ["PTB (official metadata)", fmt(market.ptb)],
              ["PTB Source", market.ptbSource ?? "—"],
              ["Running TWAP", fmt(market.twap)],
              ["Effective TWAP", fmt(market.effectiveTwap)],
              ["Observations", fmtInt(market.observationCount)],
              [
                "Feed Freshness",
                market.feedAgeMillis === null
                  ? "—"
                  : `${market.feedAgeMillis} ms · ${market.feedFresh ? "fresh" : "stale"}`,
              ],
              ["Liquidity", fmt(market.liquidity, 2)],
              [
                "Outcome Tokens",
                market.outcomeTokens.length === 0
                  ? "—"
                  : market.outcomeTokens.map((token) => token.label ?? token.key).join(" · "),
              ],
              ["Market State Version", fmtInt(market.marketStateVersion)],
              ["Configuration Snapshot", market.configurationSnapshotId ?? "—"],
              ["Snapshot Time", fmtTime(market.snapshotIso)],
            ]}
          />
        </Panel>
      ))}
    </div>
  );
}

/** Scheduler, execution counters and PM2 process facts. */
export function LiveRuntimePanel({ view }: { view: TelemetryView | undefined }) {
  const telemetry = view?.telemetry ?? null;
  const scheduler = telemetry?.scheduler ?? null;
  const execution = telemetry?.execution ?? null;
  const process = telemetry?.process ?? null;

  return (
    <Panel title="Engine Runtime" actions={<TelemetrySourcePill view={view} />}>
      <div className="grid gap-4 lg:grid-cols-3">
        <KeyValue
          rows={[
            ["Scheduler", scheduler?.status ?? "—"],
            ["Tick Interval", scheduler?.tickIntervalMillis === null || scheduler === null ? "—" : `${scheduler.tickIntervalMillis} ms`],
            ["Last Tick", fmtTime(scheduler?.lastTickIso ?? null)],
            ["Tick Drift", scheduler?.driftMillis === null || scheduler === null ? "—" : `${scheduler.driftMillis} ms`],
          ]}
        />
        <KeyValue
          rows={[
            ["Standing Orders", fmtInt(execution?.standingOrders ?? null)],
            ["Open Orders", fmtInt(execution?.openOrders ?? null)],
            ["Repricings", fmtInt(execution?.repriceCount ?? null)],
            ["Partial Fills", fmtInt(execution?.partialFills ?? null)],
            ["Settlements", fmtInt(execution?.settlements ?? null)],
            [
              "Kill Switch",
              execution?.killSwitchEngaged === null || execution === undefined || execution === null
                ? "—"
                : execution.killSwitchEngaged
                  ? "ENGAGED"
                  : "clear",
            ],
            [
              "Quota",
              execution === null
                ? "—"
                : `${fmtInt(execution.quotaRemaining)} / ${fmtInt(execution.quotaInitial)}`,
            ],
            ["Exposure", fmt(execution?.exposureNotional ?? null, 2)],
          ]}
        />
        <KeyValue
          rows={[
            ["Process Manager", process?.processManager ?? "—"],
            ["Instance", process?.instanceId ?? "—"],
            ["Restarts", fmtInt(process?.restartCount ?? null)],
            ["Started", fmtTime(process?.startedAtIso ?? null)],
            [
              "Memory",
              process?.memoryBytes === null || process === null || process === undefined
                ? "—"
                : `${Math.round(process.memoryBytes / 1_048_576)} MB`,
            ],
            ["CPU", process?.cpuPercent === null || !process ? "—" : `${process.cpuPercent}%`],
            ["Event Sequence", fmtInt(process?.eventSequence ?? null)],
            ["Telemetry Emitted", fmtTime(telemetry?.emittedAtIso ?? null)],
          ]}
        />
      </div>
    </Panel>
  );
}
