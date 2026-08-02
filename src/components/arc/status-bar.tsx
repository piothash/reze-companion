import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Countdown, StatusDot, type StatusTone } from "./primitives";
import { getOperatorStatusBar } from "@/lib/operations.functions";

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: StatusTone;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-r border-border px-3 py-1.5 last:border-r-0">
      <span className="label-caps">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
        {tone ? <StatusDot tone={tone} /> : null}
        {value}
      </span>
    </div>
  );
}

function age(millis: number | null): string {
  if (millis === null) return "—";
  const seconds = Math.max(0, Math.round(millis / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Global operator status strip. Read-only mirror of VPS-owned state — the
 * companion asserts no market or feed authority (ADR-0001).
 */
export function StatusBar() {
  const fetchStatus = useServerFn(getOperatorStatusBar);
  const { data } = useQuery({
    queryKey: ["arc", "status-bar"],
    queryFn: () => fetchStatus(),
    refetchInterval: 15_000,
    retry: false,
  });
  const runtime = useAuthorityRuntime().data;

  const vps = data?.vps;
  const vpsTone: StatusTone = runtimeTone(runtime?.connection.state);
  const feedTone: StatusTone = !data
    ? "neutral"
    : data.feed.fresh === true
      ? "healthy"
      : data.feed.fresh === false
        ? "unavailable"
        : "neutral";
  const marketTone: StatusTone = !data?.market
    ? "neutral"
    : data.market.lifecycle === "RESOLVED"
      ? "unavailable"
      : "healthy";

  return (
    <div className="flex flex-wrap items-center border-b border-border bg-card/40">
      <Cell label="ARC" value={data?.network ?? "—"} />
      <Cell label="Env" value={data?.environment ?? "—"} />
      <Cell
        label="Market"
        tone={marketTone}
        value={data?.market ? (data.market.lifecycle ?? "UNKNOWN") : "NO MARKET"}
      />
      <Cell
        label="Closes"
        value={
          data?.market?.resolutionIso ? <Countdown toIso={data.market.resolutionIso} /> : "—"
        }
      />
      <Cell
        label="Feed"
        tone={feedTone}
        value={
          data?.feed.fresh === null || data?.feed.fresh === undefined
            ? "NO DATA"
            : data.feed.fresh
              ? `FRESH ${data.feed.ageMillis ?? "—"} ms`
              : "STALE"
        }
      />
      <Cell
        label="VPS"
        tone={vpsTone}
        value={
          !vps?.registered
            ? "UNREGISTERED"
            : `${vps.connected ? "CONNECTED" : "NO HEARTBEAT"} · ${vps.latencyMillis} ms · ${age(vps.lastSeenAgeMillis)}`
        }
      />
      <Cell label="Profile" value={data?.executionProfileId ?? "—"} />
    </div>
  );
}
