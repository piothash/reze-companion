import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, KeyValue, LoadingState, Panel, StatusPill } from "@/components/arc/primitives";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { getOperationsSnapshot } from "@/lib/operations.functions";
import {
  LiveFeedPanel,
  LiveMarketPanel,
  TelemetrySourcePill,
  useRuntimeTelemetry,
} from "@/components/arc/runtime-telemetry";


export const Route = createFileRoute("/_authenticated/markets")({
  head: () => ({
    meta: [
      { title: "Markets — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Authoritative ARC market state: lifecycle, resolution time, PTB, TWAP, effective TWAP, feed freshness and state version.",
      },
      { property: "og:title", content: "Markets — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Lifecycle, resolution, PTB, TWAP, effective TWAP and feed freshness.",
      },
    ],
  }),
  component: MarketsPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function MarketsPage() {
  const fetchSnapshot = useServerFn(getOperationsSnapshot);
  const telemetry = useRuntimeTelemetry();
  const { data, isPending } = useQuery({
    queryKey: ["arc", "operations", "snapshot"],
    queryFn: () => fetchSnapshot({ data: { limit: 400 } }),
    refetchInterval: 30_000,
  });

  const projection = data?.projection;
  const markets = projection?.markets ?? [];
  const activeWindow = projection?.activeWindows[0] ?? null;

  return (
    <OperatorShell
      title="Markets"
      subtitle="Live authority metadata — no trading controls"
      actions={<TelemetrySourcePill view={telemetry.data} />}
    >
      <div className="space-y-4">
        <LiveMarketPanel view={telemetry.data} />
        <LiveFeedPanel view={telemetry.data} />
      </div>
      <div className="mt-4">
      {isPending ? (
        <LoadingState label="Reading market state" />
      ) : markets.length === 0 ? (
        <Panel title="Mirrored Market State">
          <EmptyState
            message="No market has been mirrored into the control plane yet."
            hint="Mirrored state is rebuilt from canonical engine events."
          />
        </Panel>
      ) : (

        <div className="space-y-4">
          {markets.map((market) => (
            <Panel
              key={market.marketInstanceId}
              title={market.question ?? market.marketInstanceId}
              actions={
                <StatusPill
                  tone={market.feedFresh ? "healthy" : "degraded"}
                  label={market.lifecycle ?? "UNKNOWN"}
                />
              }
            >
              <KeyValue
                rows={[
                  ["Market Instance", market.marketInstanceId],
                  ["Venue", market.venue ?? "—"],
                  ["Resolution Time", fmtTime(market.resolutionIso)],
                  ["Lifecycle", market.lifecycle ?? "—"],
                  ["PTB", fmt(market.ptb)],
                  ["Current TWAP", fmt(market.twap)],
                  ["Effective TWAP", fmt(market.effectiveTwap)],
                  ["Market State Version", fmtInt(market.marketStateVersion)],
                  [
                    "Feed Freshness",
                    market.feedAgeMillis === null
                      ? "—"
                      : `${market.feedAgeMillis} ms · ${market.feedFresh ? "fresh" : "stale"}`,
                  ],
                  ["Execution Profile", market.executionProfileId ?? "—"],
                  ["Profile Version", market.executionProfileVersion ?? "—"],
                  ["Current Window", activeWindow?.windowInstanceId ?? "none active"],
                  [
                    "Trade Quota",
                    `${fmtInt(projection?.quota?.remaining)} / ${fmtInt(projection?.quota?.initial)}`,
                  ],
                  ["Snapshot Time", fmtTime(market.timestampIso)],
                ]}
              />
            </Panel>
          ))}
        </div>
      )}
      </div>
    </OperatorShell>

  );
}
