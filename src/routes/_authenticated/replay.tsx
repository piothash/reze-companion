import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, Panel, StatusPill, fmtInt, fmtTime } from "@/components/arc/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listReplayRuns, runReplay } from "@/lib/platform.functions";

export const Route = createFileRoute("/_authenticated/replay")({
  head: () => ({
    meta: [
      { title: "Replay — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Deterministic ARC replay: rerun a correlation stream, inspect reconstructed state and review divergence reports. Read-only, never re-executes trades.",
      },
      { property: "og:title", content: "Replay — ARC Operator Platform" },
      { property: "og:description", content: "Deterministic replay runs and divergence reports." },
    ],
  }),
  component: ReplayPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function ReplayPage() {
  const queryClient = useQueryClient();
  const fetchRuns = useServerFn(listReplayRuns);
  const startReplay = useServerFn(runReplay);
  const [correlationId, setCorrelationId] = useState("");

  const { data, isPending } = useQuery({
    queryKey: ["arc", "replay-runs"],
    queryFn: () => fetchRuns(),
  });

  const mutation = useMutation({
    mutationFn: (id: string) => startReplay({ data: { correlationId: id } }),
    onSuccess: () => {
      toast.success("Replay complete");
      queryClient.invalidateQueries({ queryKey: ["arc", "replay-runs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runs = data?.runs ?? [];

  return (
    <OperatorShell
      title="Replay"
      subtitle="Deterministic reconstruction — never re-executes trading"
      actions={<StatusPill tone="neutral" label={`${runs.length} RUNS`} />}
    >
      <div className="space-y-4">
        <Panel title="Run Replay">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,28rem)_auto]">
            <Input
              value={correlationId}
              onChange={(event) => setCorrelationId(event.target.value)}
              placeholder="Correlation ID"
              aria-label="Correlation ID"
            />
            <Button
              disabled={correlationId.trim() === "" || mutation.isPending}
              onClick={() => mutation.mutate(correlationId.trim())}
            >
              {mutation.isPending ? "Replaying…" : "Replay stream"}
            </Button>
          </div>
        </Panel>

        <Panel title="Replay Runs">
          {isPending ? (
            <EmptyState message="Loading replay runs…" />
          ) : runs.length === 0 ? (
            <EmptyState message="No replay runs recorded." />
          ) : (
            <ul className="space-y-3">
              {runs.map((run) => {
                const record = run as unknown as {
                  id: string;
                  correlationId?: string;
                  correlation_id?: string;
                  eventCount?: number;
                  event_count?: number;
                  deterministic?: boolean;
                  createdAtIso?: string;
                  created_at?: string;
                  mismatches: unknown[];
                };
                const deterministic = record.deterministic ?? record.mismatches.length === 0;
                return (
                  <li key={record.id} className="border-b border-border/60 pb-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <p className="truncate font-mono text-sm">
                        {record.correlationId ?? record.correlation_id ?? record.id}
                      </p>
                      <StatusPill
                        tone={deterministic ? "healthy" : "unavailable"}
                        label={deterministic ? "DETERMINISTIC" : "DIVERGENT"}
                      />
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {fmtInt(record.eventCount ?? record.event_count ?? null)} events ·{" "}
                      {fmtTime(record.createdAtIso ?? record.created_at ?? null)}
                    </p>
                    {record.mismatches.length > 0 ? (
                      <pre className="mt-2 overflow-x-auto rounded-md border border-border p-2 font-mono text-[0.7rem] text-muted-foreground">
                        {JSON.stringify(record.mismatches, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </OperatorShell>
  );
}
