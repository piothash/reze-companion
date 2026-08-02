import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { OperatorShell } from "@/components/arc/operator-shell";
import { AuthorityRegistryPanel } from "@/components/arc/authority-registry-panel";
import {
  AuthorityRuntimePanel,
  useAuthorityRuntime,
} from "@/components/arc/authority-runtime";
import { EmptyState, LoadingState, Panel, StatusPill } from "@/components/arc/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtTime } from "@/lib/format";
import {
  activateEngineRegistration,
  deleteEngineRegistration,
  listEngineRegistrations,
  probeEngineHandshake,
  saveEngineRegistration,
} from "@/lib/engine.functions";
import { ENGINE_ENVIRONMENTS } from "@/core/platform/authority-handshake";

export const Route = createFileRoute("/_authenticated/engine-registration")({
  head: () => ({
    meta: [
      { title: "Engine Registration — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Register the ARC VPS trading engine: base URL, environment, API version, handshake and health endpoints, public identifier and runtime sync interval.",
      },
      { property: "og:title", content: "Engine Registration — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Discover, register and handshake with the ARC VPS trading authority.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EngineRegistrationPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

interface FormState {
  id: string | null;
  name: string;
  environment: string;
  baseUrl: string;
  apiVersion: string;
  engineVersion: string;
  platformVersion: string;
  healthEndpoint: string;
  handshakeEndpoint: string;
  publicIdentifier: string;
  syncIntervalSeconds: number;
  isActive: boolean;
}

const BLANK: FormState = {
  id: null,
  name: "",
  environment: "production",
  baseUrl: "",
  apiVersion: "v1",
  engineVersion: "",
  platformVersion: "",
  healthEndpoint: "/health/details",
  handshakeEndpoint: "/authority/handshake",
  publicIdentifier: "",
  syncIntervalSeconds: 5,
  isActive: true,
};

function toPayload(form: FormState) {
  return {
    id: form.id,
    registration: {
      name: form.name.trim(),
      environment: form.environment,
      baseUrl: form.baseUrl.trim(),
      apiVersion: form.apiVersion.trim(),
      engineVersion: form.engineVersion.trim() || null,
      platformVersion: form.platformVersion.trim() || null,
      healthEndpoint: form.healthEndpoint.trim(),
      handshakeEndpoint: form.handshakeEndpoint.trim(),
      publicIdentifier: form.publicIdentifier.trim() || null,
      syncIntervalMillis: Math.round(form.syncIntervalSeconds * 1000),
      isActive: form.isActive,
    },
  };
}

function validate(form: FormState): string[] {
  const issues: string[] = [];
  if (!form.name.trim()) issues.push("Engine name is required.");
  try {
    const url = new URL(form.baseUrl.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      issues.push("Base URL must use http or https.");
    }
  } catch {
    issues.push("Base URL must be a valid absolute URL, e.g. https://engine.example.com.");
  }
  if (!form.apiVersion.trim()) issues.push("API version is required.");
  if (!form.handshakeEndpoint.startsWith("/")) issues.push("Handshake endpoint must start with /.");
  if (!form.healthEndpoint.startsWith("/")) issues.push("Health endpoint must start with /.");
  if (form.syncIntervalSeconds < 1 || form.syncIntervalSeconds > 120) {
    issues.push("Sync interval must be between 1 and 120 seconds.");
  }
  return issues;
}

function EngineRegistrationPage() {
  const queryClient = useQueryClient();
  const fetchRegistrations = useServerFn(listEngineRegistrations);
  const save = useServerFn(saveEngineRegistration);
  const activate = useServerFn(activateEngineRegistration);
  const remove = useServerFn(deleteEngineRegistration);
  const probe = useServerFn(probeEngineHandshake);

  const [form, setForm] = useState<FormState | null>(null);
  const runtimeQuery = useAuthorityRuntime();

  const { data, isPending, error } = useQuery({
    queryKey: ["arc", "engine-registrations"],
    queryFn: () => fetchRegistrations(),
    retry: false,
  });

  const canWrite = data?.capabilities.canWrite ?? false;
  const issues = form ? validate(form) : [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["arc", "engine-registrations"] });
    queryClient.invalidateQueries({ queryKey: ["arc", "authority-runtime"] });
    queryClient.invalidateQueries({ queryKey: ["arc", "status-bar"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: FormState) => save({ data: toPayload(payload) as never }),
    onSuccess: () => {
      toast.success("Engine registered");
      setForm(null);
      refresh();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const activation = useMutation({
    mutationFn: (id: string) => activate({ data: { id } as never }),
    onSuccess: () => {
      toast.success("Trading authority activated");
      refresh();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const removal = useMutation({
    mutationFn: (id: string) => remove({ data: { id } as never }),
    onSuccess: () => {
      toast.success("Registration removed");
      refresh();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const probing = useMutation({
    mutationFn: (payload: FormState) =>
      probe({
        data: {
          baseUrl: payload.baseUrl.trim(),
          handshakeEndpoint: payload.handshakeEndpoint.trim(),
        } as never,
      }),
    onSuccess: (result: Awaited<ReturnType<typeof probe>>) => {
      if (result.transport === "OK") {
        toast.success(`Handshake accepted · ${result.engineId ?? "engine"}`, {
          description: `${result.latencyMillis} ms · engine ${result.engineVersion ?? "—"} · platform ${result.platformVersion ?? "—"}`,
        });
        setForm((current) =>
          current
            ? {
                ...current,
                engineVersion: result.engineVersion ?? current.engineVersion,
                platformVersion: result.platformVersion ?? current.platformVersion,
                apiVersion: result.apiVersion ?? current.apiVersion,
                publicIdentifier: current.publicIdentifier,
              }
            : current,
        );
      } else {
        toast.error(`${result.reasonCode}`, { description: result.detail });
      }
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const endpoints = data?.endpoints ?? [];

  return (
    <OperatorShell
      title="Engine Registration"
      subtitle="Public identity of the VPS trading authority. Credentials are never stored here."
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setForm({ ...BLANK })} disabled={form !== null}>
            Register engine
          </Button>
        ) : (
          <StatusPill tone="neutral" label="VIEWER · READ-ONLY" />
        )
      }
    >
      <div className="space-y-4">
        <AuthorityRuntimePanel
          runtime={runtimeQuery.data}
          isPending={runtimeQuery.isPending}
          error={runtimeQuery.error as Error | null}
        />

        {form ? (
          <Panel
            title={form.id ? "Edit Engine Registration" : "New Engine Registration"}
            actions={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => probing.mutate(form)}
                  disabled={probing.isPending || issues.length > 0}
                >
                  {probing.isPending ? "Handshaking…" : "Test handshake"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate(form)}
                  disabled={issues.length > 0 || saveMutation.isPending}
                >
                  {saveMutation.isPending ? "Saving…" : "Save registration"}
                </Button>
              </div>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <FormField label="Engine name" help="Operator-facing label for this engine.">
                <Input
                  value={form.name}
                  placeholder="arc-engine-01"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </FormField>
              <FormField label="Environment" help="Runtime environment the engine reports.">
                <Select
                  value={form.environment}
                  onValueChange={(value) => setForm({ ...form, environment: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENGINE_ENVIRONMENTS.map((environment) => (
                      <SelectItem key={environment} value={environment}>
                        {environment}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Base URL" help="Root URL of the VPS trading engine API.">
                <Input
                  value={form.baseUrl}
                  placeholder="https://engine.example.com"
                  onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                />
              </FormField>
              <FormField label="API version" help="Contract version the console must speak.">
                <Input
                  value={form.apiVersion}
                  onChange={(event) => setForm({ ...form, apiVersion: event.target.value })}
                />
              </FormField>
              <FormField label="Engine version" help="Filled automatically by the handshake.">
                <Input
                  value={form.engineVersion}
                  onChange={(event) => setForm({ ...form, engineVersion: event.target.value })}
                />
              </FormField>
              <FormField label="Platform version" help="Filled automatically by the handshake.">
                <Input
                  value={form.platformVersion}
                  onChange={(event) => setForm({ ...form, platformVersion: event.target.value })}
                />
              </FormField>
              <FormField label="Handshake endpoint" help="Canonical runtime identity endpoint.">
                <Input
                  value={form.handshakeEndpoint}
                  onChange={(event) => setForm({ ...form, handshakeEndpoint: event.target.value })}
                />
              </FormField>
              <FormField label="Health endpoint" help="Per-subsystem health document.">
                <Input
                  value={form.healthEndpoint}
                  onChange={(event) => setForm({ ...form, healthEndpoint: event.target.value })}
                />
              </FormField>
              <FormField
                label="Public identifier"
                help="Public engine identity only — never a key, token or wallet."
              >
                <Input
                  value={form.publicIdentifier}
                  onChange={(event) => setForm({ ...form, publicIdentifier: event.target.value })}
                />
              </FormField>
              <FormField label="Sync interval (s)" help="How often the console re-handshakes.">
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={form.syncIntervalSeconds}
                  onChange={(event) =>
                    setForm({ ...form, syncIntervalSeconds: Number(event.target.value) })
                  }
                />
              </FormField>
              <FormField label="Active authority" help="Only one engine is the live authority.">
                <div className="flex h-9 items-center">
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
                  />
                </div>
              </FormField>
            </div>

            {issues.length > 0 ? (
              <ul className="mt-4 space-y-1 border-t border-border pt-3">
                {issues.map((issue) => (
                  <li key={issue} className="font-mono text-xs text-destructive">
                    {issue}
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
              Registration stores public metadata only. The companion authenticates to the engine
              with a server-side bearer credential held in the runtime environment — never in the
              database and never in browser state.
            </p>
          </Panel>
        ) : null}

        <Panel title="Registered Engines">
          {error ? (
            <p className="font-mono text-sm text-destructive">{(error as Error).message}</p>
          ) : isPending ? (
            <LoadingState label="Loading registrations" />
          ) : endpoints.length === 0 ? (
            <EmptyState
              message="No trading engine registered."
              hint="Register the VPS engine to begin the runtime handshake. Until then the dashboard reports UNREGISTERED and configuration versions stay PENDING."
              action={
                canWrite ? (
                  <Button size="sm" onClick={() => setForm({ ...BLANK })}>
                    Register engine
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Engine</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Base URL</TableHead>
                  <TableHead>API</TableHead>
                  <TableHead>Engine / Platform</TableHead>
                  <TableHead>Sync</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="text-right">Authority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((endpoint) => (
                  <TableRow key={endpoint.id}>
                    <TableCell className="font-mono text-xs">
                      {endpoint.name}
                      {endpoint.publicIdentifier ? (
                        <span className="block text-muted-foreground">
                          {endpoint.publicIdentifier}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{endpoint.environment}</TableCell>
                    <TableCell className="font-mono text-xs">{endpoint.baseUrl}</TableCell>
                    <TableCell className="font-mono text-xs">{endpoint.apiVersion ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {endpoint.engineVersion ?? "—"} / {endpoint.platformVersion ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Math.round(endpoint.syncIntervalMillis / 1000)}s
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {fmtTime(endpoint.lastSeenAtIso)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <StatusPill
                          tone={endpoint.isActive ? "healthy" : "neutral"}
                          label={endpoint.isActive ? "ACTIVE" : "STANDBY"}
                        />
                        {canWrite ? (
                          <>
                            {!endpoint.isActive ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => activation.mutate(endpoint.id)}
                                disabled={activation.isPending}
                              >
                                Activate
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setForm({
                                  id: endpoint.id,
                                  name: endpoint.name,
                                  environment: endpoint.environment,
                                  baseUrl: endpoint.baseUrl,
                                  apiVersion: endpoint.apiVersion ?? "v1",
                                  engineVersion: endpoint.engineVersion ?? "",
                                  platformVersion: endpoint.platformVersion ?? "",
                                  healthEndpoint: endpoint.healthEndpoint,
                                  handshakeEndpoint: endpoint.handshakeEndpoint,
                                  publicIdentifier: endpoint.publicIdentifier ?? "",
                                  syncIntervalSeconds: Math.round(
                                    endpoint.syncIntervalMillis / 1000,
                                  ),
                                  isActive: endpoint.isActive,
                                })
                              }
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removal.mutate(endpoint.id)}
                              disabled={removal.isPending}
                            >
                              Remove
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <AuthorityRegistryPanel />
      </div>

    </OperatorShell>
  );
}

function FormField({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="label-caps">{label}</Label>
      {children}
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}
