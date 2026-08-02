import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, KeyValue, LoadingState, Panel, StatusPill } from "@/components/arc/primitives";
import { fmt, fmtInt, fmtTime } from "@/lib/format";
import { getOperationsSnapshot } from "@/lib/operations.functions";
import { getLedgerSummary } from "@/lib/platform.functions";

export const Route = createFileRoute("/_authenticated/trade-monitor")({
  head: () => ({
    meta: [
      { title: "Trade Monitor — ARC Operator Platform" },
      {
        name: "description",
        content:
          "ARC trade monitor: execution intents, risk verdicts, standing order state, retries, repricing, partial fills, settlement and correlation IDs.",
      },
      { property: "og:title", content: "Trade Monitor — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Intents, risk verdicts, order FSM, retries, fills and settlement timeline.",
      },
    ],
  }),
  component: TradeMonitorPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function TradeMonitorPage() {
  const fetchSnapshot = useServerFn(getOperationsSnapshot);
  const { data, isPending } = useQuery({
    queryKey: ["arc", "operations", "snapshot"],
    queryFn: () => fetchSnapshot({ data: { limit: 400 } }),
    refetchInterval: 15_000,
  });

  const fetchLedger = useServerFn(getLedgerSummary);
  const ledger = useQuery({
    queryKey: ["arc", "ledger"],
    queryFn: () => fetchLedger(),
    refetchInterval: 60_000,
  });

  const executions = data?.projection.executions ?? [];
  const ledgerRecords = ledger.data?.records ?? [];

  return (
    <OperatorShell
      title="Trade Monitor"
      subtitle="Execution intent traceability from decision to settlement"
      actions={
        <StatusPill
          tone={(data?.projection.openOrders ?? 0) > 0 ? "degraded" : "healthy"}
          label={`${data?.projection.openOrders ?? 0} OPEN`}
        />
      }
    >
      {isPending ? (
        <LoadingState label="Reading execution telemetry" />
      ) : executions.length === 0 ? (
        <Panel title="Executions">
          <EmptyState
            message="No execution intents recorded."
            hint="Waiting for VPS connection — the intent → risk → order → fill → settlement timeline appears here."
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {executions.map((execution) => (
            <Panel
              key={execution.executionIntentId}
              title={execution.executionIntentId}
              actions={
                <StatusPill
                  tone={
                    execution.failureReason
                      ? "unavailable"
                      : execution.settled
                        ? "healthy"
                        : "degraded"
                  }
                  label={execution.orderState ?? "PENDING"}
                />
              }
            >
              <KeyValue
                rows={[
                  ["Side", execution.side ?? "—"],
                  ["Position Size", fmt(execution.positionSize, 2)],
                  ["Reference Effective TWAP", fmt(execution.referenceEffectiveTwap)],
                  ["Reference PTB", fmt(execution.referencePtb)],
                  ["Applied Buffer", fmt(execution.appliedBuffer)],
                  ["Risk Result", execution.riskVerdict ?? "—"],
                  ["Risk Reason", execution.riskReason ?? "—"],
                  ["Standing Order", execution.orderId ?? "—"],
                  ["Order FSM", execution.orderState ?? "—"],
                  ["Retries", fmtInt(execution.retries)],
                  ["Repricings", fmtInt(execution.repricings)],
                  ["Filled Quantity", fmt(execution.filledQuantity, 4)],
                  ["Partial Fill", execution.partiallyFilled ? "yes" : "no"],
                  ["Average Price", fmt(execution.averagePrice)],
                  ["Settlement", execution.settled ? "settled" : "pending"],
                  ["Failure Reason", execution.failureReason ?? "—"],
                  ["Window", execution.windowInstanceId ?? "—"],
                  ["Correlation ID", execution.correlationId],
                  ["Created", fmtTime(execution.createdAtIso)],
                ]}
              />

              <h3 className="label-caps mt-4">Ledger Entries</h3>
              {ledgerRecords.filter(
                (record) => record.executionIntentId === execution.executionIntentId,
              ).length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No ledger records reconstructed for this intent.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  {ledgerRecords
                    .filter((record) => record.executionIntentId === execution.executionIntentId)
                    .map((record) => (
                      <li
                        key={record.recordId}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/60 pb-1"
                      >
                        <span className="truncate">
                          {record.kind} · qty {fmt(record.quantity, 4)} @ {fmt(record.price)} · fees{" "}
                          {fmt(record.fees, 2)} · pnl {fmt(record.realizedPnl, 2)}
                        </span>
                        <span className="text-muted-foreground">
                          {fmtTime(record.occurredAtIso)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}

              <h3 className="label-caps mt-4">Execution Timeline</h3>
              <ol className="mt-2 space-y-1 font-mono text-xs">
                {execution.timeline.map((entry) => (
                  <li
                    key={entry.eventId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/60 pb-1"
                  >
                    <span className="truncate">
                      {entry.type} · {entry.reasonCode}
                    </span>
                    <span className="text-muted-foreground">{fmtTime(entry.occurredAtIso)}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          ))}
        </div>
      )}
    </OperatorShell>
  );
}
