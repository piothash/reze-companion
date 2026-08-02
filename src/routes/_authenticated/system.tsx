import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, KeyValue, Panel, fmtTime } from "@/components/arc/primitives";
import { getSystemInfo } from "@/lib/operations.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/system")({
  head: () => ({
    meta: [
      { title: "System — ARC Operator Platform" },
      {
        name: "description",
        content:
          "ARC system information: platform version, engine versions, configuration versions, event schema version, replay version and build details.",
      },
      { property: "og:title", content: "System — ARC Operator Platform" },
      { property: "og:description", content: "Platform, engine, schema and replay versions." },
    ],
  }),
  component: SystemPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function SystemPage() {
  const fetchSystem = useServerFn(getSystemInfo);
  const { data, isPending } = useQuery({
    queryKey: ["arc", "system"],
    queryFn: () => fetchSystem(),
  });

  return (
    <OperatorShell title="System" subtitle="Version registry and build information">
      {isPending ? (
        <EmptyState message="Loading system information…" />
      ) : (
        <div className="space-y-4">
          <Panel title="Build">
            <KeyValue
              rows={[
                ["Environment", data?.environment ?? "—"],
                ["Network", data?.network ?? "—"],
                ["Runtime", data?.runtime ?? "—"],
                ["Observed", fmtTime(data?.buildIso ?? null)],
              ]}
            />
          </Panel>
          <Panel title="Version Registry" className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Compatible</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.versions ?? []).map((spec) => (
                  <TableRow key={spec.id}>
                    <TableCell className="font-mono text-xs">{spec.id}</TableCell>
                    <TableCell className="font-mono text-xs">{spec.version}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {spec.compatible.join(", ")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {spec.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </div>
      )}
    </OperatorShell>
  );
}
