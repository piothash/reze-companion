import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { Countdown, EmptyState, KeyValue, LoadingState, Panel, StatusPill } from "@/components/arc/primitives";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { getOperationsSnapshot } from "@/lib/operations.functions";
import {
  LiveWindowsPanel,
  TelemetrySourcePill,
  useRuntimeTelemetry,
} from "@/components/arc/runtime-telemetry";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/windows")({
  head: () => ({
    meta: [
      { title: "Active Windows — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Live ARC execution window instances: state, offset, buffer, configuration snapshot, market state version, quota and correlation IDs.",
      },
      { property: "og:title", content: "Active Windows — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Window lifecycle, buffers, quota and execution intent traceability.",
      },
    ],
  }),
  component: WindowsPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function WindowsPage() {
  const fetchSnapshot = useServerFn(getOperationsSnapshot);
  const telemetry = useRuntimeTelemetry();
  const { data, isPending } = useQuery({
    queryKey: ["arc", "operations", "snapshot"],
    queryFn: () => fetchSnapshot({ data: { limit: 400 } }),
    refetchInterval: 10_000,
  });

  const windows = data?.projection.windows ?? [];

  return (
    <OperatorShell
      title="Active Windows"
      subtitle="Live window debugger — countdowns from the trading authority"
      actions={
        <div className="flex items-center gap-2">
          <TelemetrySourcePill view={telemetry.data} />
          <StatusPill
            tone={windows.length > 0 ? "healthy" : "neutral"}
            label={`${windows.length} INSTANCES`}
          />
        </div>
      }
    >
      <div className="mb-4">
        <LiveWindowsPanel view={telemetry.data} />
      </div>
      {isPending ? (
        <LoadingState label="Reading window instances" />
      ) : windows.length === 0 ? (
        <Panel title="Window Instances">
          <EmptyState
            message="No execution windows have been mirrored yet."
            hint="Mirrored window instances are rebuilt from canonical decision events."
          />
        </Panel>
      ) : (

        <div className="space-y-4">
          <Panel title="Lifecycle Overview" className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Window</TableHead>
                  <TableHead>Seq</TableHead>
                  <TableHead>Offset</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Buffer</TableHead>
                  <TableHead>Quota</TableHead>
                  <TableHead>Timer</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead>Completion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {windows.map((window) => (
                  <TableRow key={window.windowInstanceId}>
                    <TableCell className="font-mono text-xs">{window.windowInstanceId}</TableCell>
                    <TableCell className="font-mono text-xs">{fmtInt(window.sequence)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {window.offset === null ? "—" : `${window.offset}${window.unit ?? ""}`}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{window.state}</TableCell>
                    <TableCell className="font-mono text-xs">{fmt(window.twapBuffer)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {fmtInt(window.tradeQuotaAtCreation)} →{" "}
                      {fmtInt(window.tradeQuotaAtCompletion)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Countdown toIso={window.expiresAtIso} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {window.executionIntentId ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {window.completionReason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          {windows.map((window) => (
            <Panel key={`detail-${window.windowInstanceId}`} title={window.windowInstanceId}>
              <KeyValue
                rows={[
                  ["Window ID", window.windowInstanceId],
                  ["Definition", window.windowDefinitionId ?? "—"],
                  ["Sequence", fmtInt(window.sequence)],
                  ["Priority", fmtInt(window.priority)],
                  ["Offset", window.offset === null ? "—" : `${window.offset}${window.unit ?? ""}`],
                  ["State", window.state],
                  ["Completion Reason", window.completionReason ?? "—"],
                  ["TWAP Buffer", fmt(window.twapBuffer)],
                  ["Position Size", fmt(window.positionSize, 2)],
                  ["Retry Count", fmtInt(window.retryCount)],
                  ["Configuration Snapshot", window.configurationSnapshotId ?? "—"],
                  ["Market State Version", fmtInt(window.marketStateVersion)],
                  ["Execution Intent", window.executionIntentId ?? "—"],
                  [
                    "Trade Quota",
                    `${fmtInt(window.tradeQuotaAtCreation)} → ${fmtInt(window.tradeQuotaAtCompletion)}`,
                  ],
                  ["Activates", fmtTime(window.activatesAtIso)],
                  ["Expires", fmtTime(window.expiresAtIso)],
                  ["Created", fmtTime(window.createdAtIso)],
                  ["Completed", fmtTime(window.completedAtIso)],
                  ["Evaluations", fmtInt(window.evaluationCount)],
                  ["Correlation ID", window.correlationId],
                  ["Timer — Activates In", <Countdown key="act" toIso={window.activatesAtIso} />],
                  ["Timer — Expires In", <Countdown key="exp" toIso={window.expiresAtIso} />],
                ]}
              />
            </Panel>
          ))}
        </div>
      )}
    </OperatorShell>
  );
}
