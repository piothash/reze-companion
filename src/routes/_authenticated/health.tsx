import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, LoadingState, Panel, StatusPill } from "@/components/arc/primitives";
import { fmtTime } from "@/lib/format";
import { getHealthReport } from "@/lib/operations.functions";
import {
  LiveRuntimePanel,
  TelemetrySourcePill,
  useRuntimeTelemetry,
} from "@/components/arc/runtime-telemetry";

export const Route = createFileRoute("/_authenticated/health")({
  head: () => ({
    meta: [
      { title: "Health — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Component health for ARC: feed, TWAP, PTB, scheduler, decision, risk, execution, settlement, replay, backend, API, VPS and notifications.",
      },
      { property: "og:title", content: "Health — ARC Operator Platform" },
      { property: "og:description", content: "Per-component ARC health with reasons and latency." },
    ],
  }),
  component: HealthPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function HealthPage() {
  const fetchHealth = useServerFn(getHealthReport);
  const telemetry = useRuntimeTelemetry();
  const { data, isPending } = useQuery({
    queryKey: ["arc", "health"],
    queryFn: () => fetchHealth(),
    refetchInterval: 30_000,
  });

  const components = data?.components ?? [];
  const worst = components.some((c) => c.status === "unavailable")
    ? "unavailable"
    : components.some((c) => c.status === "degraded")
      ? "degraded"
      : "healthy";

  return (
    <OperatorShell
      title="Health"
      subtitle={
        data ? `Observed ${fmtTime(data.observedAtIso)} · ${data.latencyMillis} ms` : "Probing"
      }
      actions={
        <div className="flex items-center gap-2">
          <TelemetrySourcePill view={telemetry.data} />
          <StatusPill tone={worst} label={worst.toUpperCase()} />
        </div>
      }
    >
      <div className="mb-4">
        <LiveRuntimePanel view={telemetry.data} />
      </div>
      {isPending ? (
        <LoadingState label="Running health probes" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {components.map((component) => (
            <Panel key={component.name} title={component.name}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <p className="truncate text-sm text-muted-foreground">{component.detail}</p>
                <StatusPill tone={component.status} label={component.status.toUpperCase()} />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </OperatorShell>
  );
}
