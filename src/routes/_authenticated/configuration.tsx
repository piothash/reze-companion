import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, KeyValue, Panel, StatusPill } from "@/components/arc/primitives";
import { fmtTime } from "@/lib/format";
import { getConfigurationView, getExecutionProfileConfig } from "@/lib/operations.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/configuration")({
  head: () => ({
    meta: [
      { title: "Configuration — ARC Operator Platform" },
      {
        name: "description",
        content:
          "ARC configuration surface: environment, network, feed provider, feature flags, engine endpoints, configuration profiles and profile versions.",
      },
      { property: "og:title", content: "Configuration — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Environment, feature flags, endpoints and versions.",
      },
    ],
  }),
  component: ConfigurationPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

interface FlagRow {
  key: string;
  enabled: boolean;
  description: string | null;
}
interface EndpointRow {
  id: string;
  name: string;
  base_url: string;
  environment: string;
  is_active: boolean;
  last_seen_at: string | null;
}
interface ProfileRow {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  updated_at: string;
}

interface ExecutionProfileSummary {
  executionProfileId: string;
  executionMode: string;
  maxTrades: number;
  positionSize: number;
  retryCount: number;
  timeoutMillis: number;
  windowActiveMillis: number;
  repricingIntervalMillis: number;
  bufferMode: string;
  minLiquidity: number;
  maxSpread: number;
  windows: {
    offset: number;
    unit: string;
    enabled: boolean;
    twapBuffer: number;
    positionSizeOverride: number | null;
    retryCountOverride: number | null;
  }[];
}

function ConfigurationPage() {
  const fetchConfig = useServerFn(getConfigurationView);
  const { data, isPending } = useQuery({
    queryKey: ["arc", "configuration"],
    queryFn: () => fetchConfig(),
  });

  const fetchProfile = useServerFn(getExecutionProfileConfig);
  const profileQuery = useQuery({
    queryKey: ["arc", "execution-profile"],
    queryFn: () => fetchProfile(),
  });
  const profile = profileQuery.data?.profile as unknown as ExecutionProfileSummary | undefined;

  const flags = (data?.featureFlags ?? []) as unknown as FlagRow[];
  const endpoints = (data?.endpoints ?? []) as unknown as EndpointRow[];
  const profiles = (data?.profiles ?? []) as unknown as ProfileRow[];

  return (
    <OperatorShell title="Configuration" subtitle="Companion-owned configuration only">
      {isPending ? (
        <EmptyState message="Loading configuration…" />
      ) : (
        <div className="space-y-4">
          <Panel title="Environment">
            <KeyValue
              rows={[
                ["Environment", data?.environment ?? "—"],
                ["Network", data?.network ?? "—"],
                ["TWAP Feed Provider", data?.feedProvider ?? "—"],
                ["Feed ID", data?.feedId ?? "—"],
                ["Execution Profile Version", data?.versions.executionProfile ?? "—"],
                ["Buffer Profile Version", data?.versions.bufferProfile ?? "—"],
                ["Risk Profile Version", data?.versions.riskProfile ?? "—"],
              ]}
            />
          </Panel>

          <Panel title="Execution Defaults" className="overflow-x-auto">
            {profileQuery.isPending || !profile ? (
              <EmptyState message="Loading execution profile…" />
            ) : (
              <>
                <KeyValue
                  rows={[
                    ["Execution Profile", profile.executionProfileId],
                    ["Execution Mode", profile.executionMode],
                    ["Trade Quota (max trades)", String(profile.maxTrades)],
                    ["Default Position Size", String(profile.positionSize)],
                    ["Default Retry Count", String(profile.retryCount)],
                    ["Order Timeout", `${profile.timeoutMillis} ms`],
                    ["Window Active", `${profile.windowActiveMillis} ms`],
                    ["Repricing Interval", `${profile.repricingIntervalMillis} ms`],
                    ["Buffer Profile Mode", profile.bufferMode],
                    ["Min Liquidity", String(profile.minLiquidity)],
                    ["Max Spread", String(profile.maxSpread)],
                    ["Configuration Digest", profileQuery.data?.digest ?? "—"],
                  ]}
                />
                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Window</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead>Offset</TableHead>
                      <TableHead>TWAP Buffer</TableHead>
                      <TableHead>Position Size</TableHead>
                      <TableHead>Retry</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profile.windows.map((window, index) => (
                      <TableRow key={`${window.offset}${window.unit}-${index}`}>
                        <TableCell className="font-mono text-xs">W{index + 1}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {window.enabled ? "yes" : "no"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {window.offset}
                          {window.unit}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{window.twapBuffer}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {window.positionSizeOverride ?? `${profile.positionSize} (inherited)`}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {window.retryCountOverride ?? `${profile.retryCount} (inherited)`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </Panel>

          <Panel title="Feature Flags">
            {flags.length === 0 ? (
              <EmptyState message="No feature flags defined." />
            ) : (
              <ul className="space-y-2">
                {flags.map((flag) => (
                  <li
                    key={flag.key}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 pb-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{flag.key}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {flag.description ?? "—"}
                      </p>
                    </div>
                    <StatusPill
                      tone={flag.enabled ? "healthy" : "neutral"}
                      label={flag.enabled ? "ON" : "OFF"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Engine Endpoints" className="overflow-x-auto">
            {endpoints.length === 0 ? (
              <EmptyState message="No VPS engine endpoints registered." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Base URL</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((endpoint) => (
                    <TableRow key={endpoint.id}>
                      <TableCell className="font-mono text-xs">{endpoint.name}</TableCell>
                      <TableCell className="font-mono text-xs">{endpoint.base_url}</TableCell>
                      <TableCell className="font-mono text-xs">{endpoint.environment}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {endpoint.is_active ? "yes" : "no"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {fmtTime(endpoint.last_seen_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>

          <Panel title="Configuration Profiles">
            {profiles.length === 0 ? (
              <EmptyState message="No stored configuration profiles." />
            ) : (
              <ul className="space-y-2">
                {profiles.map((profile) => (
                  <li
                    key={profile.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 pb-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{profile.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {profile.description ?? "—"}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {fmtTime(profile.updated_at)}
                    </span>
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
