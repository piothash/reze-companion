import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { Countdown, EmptyState, LoadingState, Metric, Panel, StatusPill } from "@/components/arc/primitives";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { getHealthReport, getOperationsSnapshot, getSystemInfo } from "@/lib/operations.functions";
import { listReplayRuns } from "@/lib/platform.functions";
import {
  LiveFeedPanel,
  LiveRuntimePanel,
  LiveWindowsPanel,
  TelemetrySourcePill,
  useRuntimeTelemetry,
} from "@/components/arc/runtime-telemetry";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Operations Dashboard — ARC" },
      {
        name: "description",
        content:
          "Global ARC operations dashboard: feed health, market state, active windows, trade quota, exposure and recent canonical events.",
      },
      { property: "og:title", content: "Operations Dashboard — ARC" },
      {
        property: "og:description",
        content: "Feed health, market state, active windows, quota, exposure and events.",
      },
    ],
  }),
  component: DashboardPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function DashboardPage() {
  const fetchSnapshot = useServerFn(getOperationsSnapshot);
  const fetchHealth = useServerFn(getHealthReport);
  const fetchSystem = useServerFn(getSystemInfo);
  const fetchReplay = useServerFn(listReplayRuns);
  const telemetry = useRuntimeTelemetry();



  const { data, isPending } = useQuery({
    queryKey: ["arc", "operations", "snapshot"],
    queryFn: () => fetchSnapshot({ data: { limit: 400 } }),
    refetchInterval: 15_000,
  });
  const health = useQuery({
    queryKey: ["arc", "health"],
    queryFn: () => fetchHealth(),
    refetchInterval: 30_000,
  });
  const system = useQuery({ queryKey: ["arc", "system"], queryFn: () => fetchSystem() });
  const replay = useQuery({
    queryKey: ["arc", "replay-runs"],
    queryFn: () => fetchReplay(),
    refetchInterval: 60_000,
  });

  const projection = data?.projection;
  const market = projection?.activeMarket ?? null;
  const activeWindow = projection?.activeWindows[0] ?? null;
  const latestReplay = replay.data?.runs?.[0] ?? null;
  const notifications = (data?.notifications ?? []) as unknown as {
    read_at: string | null;
    severity: string;
  }[];
  const unread = notifications.filter((item) => item.read_at === null).length;
  const criticalUnread = notifications.filter(
    (item) => item.read_at === null && item.severity.toUpperCase() !== "INFO",
  ).length;

  const worst = (health.data?.components ?? []).some((c) => c.status === "unavailable")
    ? "unavailable"
    : (health.data?.components ?? []).some((c) => c.status === "degraded")
      ? "degraded"
      : "healthy";

  return (
    <OperatorShell
      title="Operations Dashboard"
      subtitle={data ? `Observed ${fmtTime(data.observedAtIso)} UTC` : "Loading telemetry"}
      actions={
        <div className="flex items-center gap-2">
          <StatusPill tone="neutral" label={(system.data?.environment ?? "—").toUpperCase()} />
          <StatusPill
            tone={market?.feedFresh ? "healthy" : market ? "degraded" : "neutral"}
            label={market?.feedFresh ? "FEED LIVE" : market ? "FEED STALE" : "NO FEED"}
          />
        </div>
      }
    >
      {isPending ? (
        <LoadingState label="Reading operational telemetry" />
      ) : (
        <div className="space-y-4">
          <LiveFeedPanel view={telemetry.data} />
          <LiveWindowsPanel view={telemetry.data} />
          <LiveRuntimePanel view={telemetry.data} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

            <Metric
              label="System Status"
              value={worst.toUpperCase()}
              hint={`${health.data?.components.length ?? 0} subsystems · ${health.data?.latencyMillis ?? "—"} ms`}
            />
            <Metric
              label="Environment"
              value={(system.data?.environment ?? "—").toUpperCase()}
              hint={`network ${system.data?.network ?? "—"}`}
            />
            <Metric
              label="Platform Version"
              value={system.data?.platformVersion ?? "—"}
              hint={`engine ${system.data?.engineVersion ?? "—"} · schema ${system.data?.eventSchemaVersion ?? "—"}`}
            />
            <Metric
              label="Resolution Countdown"
              value={<Countdown toIso={market?.resolutionIso ?? null} />}
              hint={market?.resolutionIso ? fmtTime(market.resolutionIso) : "no resolution time"}
            />

            <Metric
              label="Current Market"
              value={
                <span className="truncate text-sm">{market?.marketInstanceId ?? "no market"}</span>
              }
              hint={`${fmtInt(projection?.markets.length ?? 0)} tracked · ${market?.venue ?? "—"}`}
            />
            <Metric
              label="Market Lifecycle"
              value={market?.lifecycle ?? "—"}
              hint={`state version ${fmtInt(market?.marketStateVersion)}`}
            />
            <Metric
              label="Feed Health"
              value={market ? (market.feedFresh ? "FRESH" : "STALE") : "—"}
              hint={
                market?.feedAgeMillis === null || market?.feedAgeMillis === undefined
                  ? "no observations"
                  : `age ${market.feedAgeMillis} ms`
              }
            />
            <Metric
              label="TWAP Feed Status"
              value={market?.twap === null || market === null ? "NO DATA" : "STREAMING"}
              hint={`current twap ${fmt(market?.twap ?? null)}`}
            />

            <Metric label="Current TWAP" value={fmt(market?.twap ?? null)} hint="raw window TWAP" />
            <Metric
              label="Effective TWAP"
              value={fmt(market?.effectiveTwap ?? null)}
              hint="buffer applied downstream"
            />
            <Metric
              label="Price To Beat"
              value={fmt(market?.ptb ?? null)}
              hint={market?.ptbValid === false ? "ptb invalid" : "ptb valid"}
            />
            <Metric
              label="Market State Version"
              value={fmtInt(market?.marketStateVersion)}
              hint={`profile ${market?.executionProfileVersion ?? "—"}`}
            />

            <Metric
              label="Current Active Window"
              value={
                <span className="truncate text-sm">
                  {activeWindow?.windowInstanceId ?? "none active"}
                </span>
              }
              hint={
                activeWindow
                  ? `${activeWindow.state} · offset ${activeWindow.offset ?? "—"}${activeWindow.unit ?? ""}`
                  : `${projection?.activeWindows.length ?? 0} of ${projection?.windows.length ?? 0} instances`
              }
            />
            <Metric
              label="Trade Quota"
              value={`${fmtInt(projection?.quota?.remaining)} / ${fmtInt(projection?.quota?.initial)}`}
              hint={`${fmtInt(projection?.quota?.consumed)} consumed`}
            />
            <Metric
              label="Exposure"
              value={fmt(projection?.exposure?.live ?? null, 2)}
              hint={`reserved ${fmt(projection?.exposure?.reserved ?? null, 2)} · limit ${fmt(projection?.exposure?.limit ?? null, 2)}`}
            />
            <Metric
              label="Open Orders"
              value={fmtInt(projection?.openOrders ?? 0)}
              hint={`${projection?.executions.length ?? 0} execution intents`}
            />

            <Metric
              label="Replay Status"
              value={latestReplay?.status ?? "NO RUNS"}
              hint={
                latestReplay
                  ? `${latestReplay.deterministic ? "deterministic" : "divergent"} · ${fmtInt(latestReplay.eventCount)} events`
                  : "replay never executed"
              }
            />
            <Metric
              label="Notifications"
              value={fmtInt(unread)}
              hint={`${criticalUnread} above INFO · ${notifications.length} recent`}
            />
            <Metric
              label="Scheduler Status"
              value={(projection?.counts.total ?? 0) > 0 ? "OBSERVING" : "IDLE"}
              hint={`${fmtInt(projection?.counts.business)} business · ${fmtInt(projection?.counts.operational)} operational`}
            />
            <Metric
              label="VPS Status"
              value={
                (data?.endpoints ?? []).length > 0
                  ? `${(data?.endpoints ?? []).length} ENDPOINT(S)`
                  : "UNREGISTERED"
              }
              hint="trading authority remains on the VPS"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Subsystem Health"
              actions={
                <Link to="/health" className="font-mono text-xs text-primary">
                  detail
                </Link>
              }
            >
              {health.isPending ? (
                <LoadingState label="Running health probes" />
              ) : (
                <ul className="space-y-2 text-sm">
                  {(health.data?.components ?? []).map((component) => (
                    <li
                      key={component.name}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
                    >
                      <span className="truncate">{component.name}</span>
                      <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                        <span className="hidden truncate sm:inline">{component.detail}</span>
                        <StatusPill
                          tone={component.status}
                          label={component.status.toUpperCase()}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Recent Events"
              actions={
                <Link to="/audit" className="font-mono text-xs text-primary">
                  audit
                </Link>
              }
            >
              {(projection?.recentEvents.length ?? 0) === 0 ? (
                <EmptyState message="No canonical events mirrored." hint="Waiting for VPS connection." />
              ) : (
                <ul className="space-y-1.5 font-mono text-xs">
                  {projection?.recentEvents.slice(0, 14).map((event) => (
                    <li
                      key={event.eventId}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/60 pb-1.5"
                    >
                      <span className="truncate">{event.type}</span>
                      <span className="text-muted-foreground">{fmtTime(event.occurredAtIso)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </OperatorShell>
  );
}
