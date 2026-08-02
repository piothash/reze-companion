import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, KeyValue, LoadingState, Panel, StatusPill } from "@/components/arc/primitives";
import { fmtTime } from "@/lib/format";
import { getSystemInfo } from "@/lib/operations.functions";
import { getAuthoritySigningStatus } from "@/lib/security.functions";
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
  const fetchSigning = useServerFn(getAuthoritySigningStatus);
  const signing = useQuery({
    queryKey: ["arc", "authority-signing"],
    queryFn: () => fetchSigning(),
    refetchInterval: 60_000,
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
          <Panel title="Backend Connection">
            <KeyValue
              rows={[
                ["Provider", (data?.backend.provider ?? "supabase").toUpperCase()],
                ["Project", data?.backend.projectRef ?? "—"],
                ["URL", data?.backend.maskedUrl ?? "—"],
                ["Expected Backend", data?.backend.expectedMaskedUrl ?? "—"],
                [
                  "Match",
                  data?.backend.deploymentTargetEnforced
                    ? data.backend.matchesDeploymentTarget
                      ? "PASS"
                      : "FAIL"
                    : "NOT ENFORCED",
                ],
                ["Configuration", data?.backend.configured ? "COMPLETE" : "INCOMPLETE"],
                ["Database", data?.backend.databaseConnected ? "HEALTHY" : "UNREACHABLE"],
                ["Auth", data?.backend.authReachable ? "HEALTHY" : "UNREACHABLE"],
                ["Privileged Key", data?.backend.serviceRoleConfigured ? "CONFIGURED" : "ABSENT"],
                [
                  "Ownership",
                  data?.authentication.ownershipFinalized ? "FINALIZED" : "BOOTSTRAP AVAILABLE",
                ],
                [
                  "Registration",
                  data?.authentication.mode === "BOOTSTRAP_OPEN" ? "ENABLED" : "DISABLED",
                ],
                ["Environment", `${data?.environment ?? "—"} / ${data?.network ?? "—"}`],
              ]}
            />
            {data &&
            data.backend.deploymentTargetEnforced &&
            !data.backend.matchesDeploymentTarget ? (
              <p className="mt-3 border border-destructive/50 bg-destructive/10 p-3 font-mono text-xs uppercase text-destructive">
                Cutover guard failed — sign-in, ownership changes, configuration publishing and
                authority registration are disabled.
              </p>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Backend selection is environment-driven only. The project URL is masked and no
              service-role material is ever sent to the browser.
            </p>
          </Panel>
          <Panel title="Control Plane Migration" className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Required Table</TableHead>
                  <TableHead>Implemented By</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.migration.rows ?? []).map((row) => (
                  <TableRow key={row.logicalName}>
                    <TableCell className="font-mono text-xs">{row.logicalName}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.physicalName}
                    </TableCell>
                    <TableCell
                      className={
                        row.readiness === "MISSING"
                          ? "font-mono text-xs text-destructive"
                          : "font-mono text-xs"
                      }
                    >
                      {row.readiness}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">{data?.migration.detail}</p>
          </Panel>

          <Panel
            title="Authority Signing"
            actions={
              <StatusPill
                tone={
                  signing.data?.securityStatus === "ENFORCED"
                    ? "healthy"
                    : signing.data?.securityStatus === "WEAK"
                      ? "degraded"
                      : "unavailable"
                }
                label={signing.data?.securityStatus ?? "UNKNOWN"}
              />
            }
          >
            <KeyValue
              rows={[
                [
                  "Status",
                  signing.data === undefined
                    ? "—"
                    : signing.data.configured
                      ? "Configured"
                      : "Not Configured",
                ],
                ["Source", "Server Environment"],
                ["Signing Key Configured", signing.data?.configured ? "YES" : "NO"],

                [
                  "Meets Minimum Strength",
                  signing.data === undefined
                    ? "—"
                    : signing.data.configured
                      ? signing.data.meetsMinimumLength
                        ? "YES"
                        : "NO"
                      : "N/A",
                ],
                [
                  "Recommended Strength",
                  signing.data === undefined
                    ? "—"
                    : signing.data.meetsRecommendedLength
                      ? "YES"
                      : `${signing.data.recommendedLength}+ chars recommended`,
                ],
                [
                  "Signature Verification",
                  signing.data?.securityStatus === "ENFORCED" ? "ENFORCED" : "FAIL-CLOSED",
                ],
                [
                  "Last Verified Authority Message",
                  fmtTime(signing.data?.lastVerificationIso ?? null),
                ],
                ["Last Verified Action", signing.data?.lastVerificationAction ?? "—"],
                ["Ownership", signing.data?.ownershipFinalized ? "FINALIZED" : "OPEN"],
                ["Registration", signing.data?.registrationOpen ? "ENABLED" : "DISABLED"],
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              {signing.data?.detail ?? "Reading signing configuration."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Metadata only. The shared signing key is never displayed, stored in the database,
              logged or sent to the browser.
            </p>
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
