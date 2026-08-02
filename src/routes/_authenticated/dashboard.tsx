import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import {
  EmptyState,
  Metric,
  Panel,
  StatusPill,
  fmt,
  fmtInt,
  fmtTime,
} from "@/components/arc/primitives";
import { getOperationsSnapshot } from "@/lib/operations.functions";

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
  const { data, isPending } = useQuery({
    queryKey: ["arc", "operations", "snapshot"],
    queryFn: () => fetchSnapshot({ data: { limit: 400 } }),
    refetchInterval: 30_000,
  });

  const projection = data?.projection;
  const market = projection?.activeMarket ?? null;
  const unread = (data?.notifications ?? []).filter(
    (item) => (item as { read_at: string | null }).read_at === null,
  ).length;

  return (
    <OperatorShell
      title="Operations Dashboard"
      subtitle={data ? `Observed ${fmtTime(data.observedAtIso)} UTC` : "Loading telemetry"}
      actions={
        <StatusPill
          tone={market?.feedFresh ? "healthy" : market ? "degraded" : "neutral"}
          label={market?.feedFresh ? "FEED LIVE" : market ? "FEED STALE" : "NO FEED"}
        />
      }
    >
      {isPending ? (
        <EmptyState message="Loading operational telemetry…" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Market Count"
              value={fmtInt(projection?.markets.length ?? 0)}
              hint={market?.marketInstanceId ?? "no active market"}
            />
            <Metric
              label="Market State Version"
              value={fmtInt(market?.marketStateVersion)}
              hint={market?.lifecycle ?? "—"}
            />
            <Metric
              label="Active Windows"
              value={fmtInt(projection?.activeWindows.length ?? 0)}
              hint={`${projection?.windows.length ?? 0} total instances`}
            />
            <Metric
              label="Open Orders"
              value={fmtInt(projection?.openOrders ?? 0)}
              hint={`${projection?.executions.length ?? 0} execution intents`}
            />
            <Metric
              label="Trade Quota"
              value={`${fmtInt(projection?.quota?.remaining)} / ${fmtInt(projection?.quota?.initial)}`}
              hint={`${fmtInt(projection?.quota?.consumed)} consumed`}
            />
            <Metric
              label="Exposure"
              value={fmt(projection?.exposure?.live ?? null, 2)}
              hint={`reserved ${fmt(projection?.exposure?.reserved ?? null, 2)}`}
            />
            <Metric
              label="Effective TWAP"
              value={fmt(market?.effectiveTwap ?? null)}
              hint={`PTB ${fmt(market?.ptb ?? null)}`}
            />
            <Metric label="Notifications" value={fmtInt(unread)} hint="unacknowledged" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Component Health"
              actions={
                <Link to="/health" className="font-mono text-xs text-primary">
                  detail
                </Link>
              }
            >
              <ul className="space-y-2 text-sm">
                <HealthRow
                  label="TWAP Feed"
                  ok={market?.twap !== null && market !== null}
                  detail={fmt(market?.twap ?? null)}
                />
                <HealthRow
                  label="PTB"
                  ok={market?.ptbValid === true}
                  detail={fmt(market?.ptb ?? null)}
                />
                <HealthRow
                  label="Scheduler"
                  ok={(projection?.counts.total ?? 0) > 0}
                  detail={`${projection?.counts.total ?? 0} events`}
                />
                <HealthRow label="Lovable Cloud" ok detail="reachable" />
                <HealthRow
                  label="VPS Endpoints"
                  ok={(data?.endpoints ?? []).length > 0}
                  detail={`${(data?.endpoints ?? []).length} registered`}
                />
                <HealthRow
                  label="Replay"
                  ok={(projection?.counts.business ?? 0) > 0}
                  detail={`${projection?.counts.business ?? 0} business events`}
                />
              </ul>
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
                <EmptyState message="No canonical events mirrored yet." />
              ) : (
                <ul className="space-y-1.5 font-mono text-xs">
                  {projection?.recentEvents.slice(0, 12).map((event) => (
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

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <span className="truncate">{label}</span>
      <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        {detail}
        <StatusPill tone={ok ? "healthy" : "degraded"} label={ok ? "OK" : "WAIT"} />
      </span>
    </li>
  );
}
