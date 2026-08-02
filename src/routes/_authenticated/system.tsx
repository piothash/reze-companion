import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, KeyValue, LoadingState, Panel } from "@/components/arc/primitives";
import { fmtTime } from "@/lib/format";
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
        <LoadingState label="Reading system information" />
      ) : (
        <div className="space-y-4">
          <Panel title="Platform Identity">
            <KeyValue
              rows={[
                ["Platform Version", data?.platformVersion ?? "—"],
                ["Engine Versions", data?.engineVersion ?? "—"],
                ["Configuration Version", data?.configurationVersion ?? "—"],
                ["Replay Version", data?.replayVersion ?? "—"],
                ["Event Schema Version", data?.eventSchemaVersion ?? "—"],
                ["Environment", data?.environment ?? "—"],
              ]}
            />
          </Panel>
          <Panel title="Build Information">
            <KeyValue
              rows={[
                ["Network", data?.network ?? "—"],
                ["Runtime", data?.runtime ?? "—"],
                ["Git Commit", data?.gitCommit ?? "not exposed by build"],
                ["Deployment Timestamp", fmtTime(data?.deployedAtIso ?? null)],
                ["Observed", fmtTime(data?.buildIso ?? null)],
              ]}
            />
          </Panel>
          <Panel title="Authentication Integration">
            <KeyValue
              rows={[
                ["State", data?.authentication.mode ?? "—"],
                [
                  "Production Backend",
                  data?.authentication.backendMatchesProduction ? "MATCH" : "MISMATCH",
                ],
                ["Owner Exists", data?.authentication.ownerExists ? "YES" : "NO"],
                ["Ownership Finalized", data?.authentication.ownershipFinalized ? "YES" : "NO"],
                ["Signup Enabled", data?.authentication.signupEnabled ? "YES" : "NO"],
                ["Session Service", data?.authentication.resolved ? "REACHABLE" : "UNAVAILABLE"],
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">{data?.authentication.detail}</p>
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
