import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, KeyValue, Metric, Panel, StatusPill, fmt, fmtInt, fmtTime } from "@/components/arc/primitives";
import { getOperationsSnapshot } from "@/lib/operations.functions";

export const Route = createFileRoute("/_authenticated/signal-tank")({
  head: () => ({
    meta: [
      { title: "Signal Tank — ARC Operator Platform" },
      {
        name: "description",
        content:
          "ARC signal tank: authoritative market state, effective TWAP against price-to-beat, applied buffer and BUY UP / BUY DOWN / NO SIGNAL decisions.",
      },
      { property: "og:title", content: "Signal Tank — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Effective TWAP vs PTB, applied buffer and decision outcomes.",
      },
    ],
  }),
  component: SignalTankPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function outcomeTone(outcome: string) {
  return outcome === "NO_SIGNAL" ? "neutral" : "healthy";
}

function SignalTankPage() {
  const fetchSnapshot = useServerFn(getOperationsSnapshot);
  const { data, isPending } = useQuery({
    queryKey: ["arc", "operations", "snapshot"],
    queryFn: () => fetchSnapshot({ data: { limit: 400 } }),
    refetchInterval: 10_000,
  });

  const projection = data?.projection;
  const market = projection?.activeMarket ?? null;
  const signals = projection?.signals ?? [];
  const latest = signals[0] ?? null;

  return (
    <OperatorShell
      title="Signal Tank"
      subtitle="TWAP-native decision surface — display only"
      actions={
        <StatusPill
          tone={latest ? outcomeTone(latest.outcome) : "neutral"}
          label={latest?.outcome ?? "NO DECISION"}
        />
      }
    >
      {isPending ? (
        <EmptyState message="Loading decision telemetry…" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Effective TWAP" value={fmt(latest?.effectiveTwap ?? market?.effectiveTwap ?? null)} />
            <Metric label="Price To Beat" value={fmt(latest?.ptb ?? market?.ptb ?? null)} />
            <Metric label="Applied Buffer" value={fmt(latest?.appliedBuffer ?? null)} />
            <Metric
              label="Market State Version"
              value={fmtInt(latest?.marketStateVersion ?? market?.marketStateVersion ?? null)}
            />
          </div>

          <Panel title="Latest Decision">
            {latest === null ? (
              <EmptyState message="No decision has been evaluated yet." />
            ) : (
              <>
                <KeyValue
                  rows={[
                    ["Decision", latest.outcome],
                    ["Window", latest.windowInstanceId ?? "—"],
                    ["Delta (TWAP − PTB)", fmt(latest.delta)],
                    ["Rejection Reason", latest.rejectionReason ?? "—"],
                    ["Decision Timestamp", fmtTime(latest.decidedAtIso)],
                  ]}
                />
                {latest.appliedSteps.length > 0 ? (
                  <ol className="mt-4 space-y-1 font-mono text-xs text-muted-foreground">
                    {latest.appliedSteps.map((step, index) => (
                      <li key={`${step}-${index}`}>{step}</li>
                    ))}
                  </ol>
                ) : null}
              </>
            )}
          </Panel>

          <Panel title="Decision History">
            {signals.length === 0 ? (
              <EmptyState message="No evaluations recorded." />
            ) : (
              <ul className="space-y-1.5 font-mono text-xs">
                {signals.map((signal, index) => (
                  <li
                    key={`${signal.decidedAtIso}-${index}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/60 pb-1.5"
                  >
                    <span className="truncate">
                      {signal.outcome} · twap {fmt(signal.effectiveTwap)} · ptb {fmt(signal.ptb)}
                    </span>
                    <span className="text-muted-foreground">{fmtTime(signal.decidedAtIso)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </OperatorShell>
  );
}
