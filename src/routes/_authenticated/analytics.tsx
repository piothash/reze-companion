import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, Metric, Panel, StatusPill, fmt, fmtInt, fmtPct, fmtTime } from "@/components/arc/primitives";
import { getAnalyticsSummary, getLedgerSummary } from "@/lib/platform.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — ARC Operator Platform" },
      {
        name: "description",
        content:
          "ARC analytics: fill rate, slippage, buffer efficiency, quota utilization, window performance, exposure peaks and realized PnL from canonical events.",
      },
      { property: "og:title", content: "Analytics — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Fill rate, slippage, buffer efficiency, quota utilization and PnL.",
      },
    ],
  }),
  component: AnalyticsPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function AnalyticsPage() {
  const fetchAnalytics = useServerFn(getAnalyticsSummary);
  const fetchLedger = useServerFn(getLedgerSummary);

  const analytics = useQuery({
    queryKey: ["arc", "analytics"],
    queryFn: () => fetchAnalytics(),
  });
  const ledger = useQuery({ queryKey: ["arc", "ledger"], queryFn: () => fetchLedger() });

  const summary = analytics.data?.summary;
  const metrics = summary?.metrics;

  return (
    <OperatorShell
      title="Analytics"
      subtitle={
        summary
          ? `${summary.eventCount} events · ${fmtTime(summary.periodStartIso)} → ${fmtTime(summary.periodEndIso)}`
          : "Derived entirely from canonical events"
      }
      actions={<StatusPill tone="neutral" label={analytics.data?.source ?? "—"} />}
    >
      {analytics.isPending ? (
        <EmptyState message="Computing analytics…" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Fill Rate" value={fmtPct(metrics?.fillRate ?? null)} />
            <Metric label="Partial Fill Rate" value={fmtPct(metrics?.partialFillRate ?? null)} />
            <Metric label="Retry Rate" value={fmtPct(metrics?.retryRate ?? null)} />
            <Metric label="Buffer Efficiency" value={fmtPct(metrics?.bufferEfficiency ?? null)} />
            <Metric label="Average Slippage" value={fmt(metrics?.averageSlippage ?? null)} />
            <Metric
              label="Avg Fill Latency"
              value={
                metrics?.averageFillLatencyMillis === null ||
                metrics?.averageFillLatencyMillis === undefined
                  ? "—"
                  : `${Math.round(metrics.averageFillLatencyMillis)} ms`
              }
            />
            <Metric label="Quota Utilization" value={fmtPct(metrics?.tradeQuotaUtilization ?? null)} />
            <Metric label="Window Utilization" value={fmtPct(metrics?.windowUtilization ?? null)} />
            <Metric label="Peak Reserved Exposure" value={fmt(metrics?.peakReservedExposure ?? null, 2)} />
            <Metric label="Peak Live Exposure" value={fmt(metrics?.peakLiveExposure ?? null, 2)} />
            <Metric label="Realized PnL" value={fmt(metrics?.realizedPnl ?? null, 2)} />
            <Metric
              label="Notional / Fees"
              value={`${fmt(metrics?.totalNotional ?? null, 2)} / ${fmt(metrics?.totalFees ?? null, 2)}`}
            />
          </div>

          <Panel title="Per Window" className="overflow-x-auto">
            {(summary?.perWindow.length ?? 0) === 0 ? (
              <EmptyState message="No window statistics available." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Window</TableHead>
                    <TableHead>Evaluations</TableHead>
                    <TableHead>Signals</TableHead>
                    <TableHead>Intents</TableHead>
                    <TableHead>Fills</TableHead>
                    <TableHead>Completion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary?.perWindow.map((row) => (
                    <TableRow key={row.windowInstanceId}>
                      <TableCell className="font-mono text-xs">{row.windowInstanceId}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtInt(row.evaluations)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtInt(row.signals)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtInt(row.intents)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtInt(row.fills)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.completionReason ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>

          <Panel title="Per Execution Profile" className="overflow-x-auto">
            {(summary?.perProfile.length ?? 0) === 0 ? (
              <EmptyState message="No profile statistics available." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profile Version</TableHead>
                    <TableHead>Intents</TableHead>
                    <TableHead>Fills</TableHead>
                    <TableHead>Avg Slippage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary?.perProfile.map((row) => (
                    <TableRow key={row.executionProfileVersion}>
                      <TableCell className="font-mono text-xs">
                        {row.executionProfileVersion}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{fmtInt(row.intents)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtInt(row.fills)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {fmt(row.averageSlippage)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>

          <Panel title="Ledger">
            {ledger.isPending ? (
              <EmptyState message="Loading ledger…" />
            ) : (
              <pre className="overflow-x-auto font-mono text-xs text-muted-foreground">
                {JSON.stringify(ledger.data?.summary ?? {}, null, 2)}
              </pre>
            )}
          </Panel>
        </div>
      )}
    </OperatorShell>
  );
}
