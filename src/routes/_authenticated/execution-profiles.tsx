import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, Panel, StatusPill } from "@/components/arc/primitives";
import { fmtTime } from "@/lib/format";
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
import { WINDOW_OFFSET_UNITS } from "@/core/decision/types";
import { getExecutionProfileConfig, saveExecutionProfileConfig } from "@/lib/operations.functions";

export const Route = createFileRoute("/_authenticated/execution-profiles")({
  head: () => ({
    meta: [
      { title: "Execution Profiles — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Configure ARC execution profiles: execution mode, trade limits, TWAP buffers, dynamic offset windows, tick policy and repricing behaviour.",
      },
      { property: "og:title", content: "Execution Profiles — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Execution mode, buffers, dynamic windows, tick policy and repricing.",
      },
    ],
  }),
  component: ExecutionProfilesPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

interface WindowDraft {
  offset: number;
  unit: string;
  enabled: boolean;
  twapBuffer: number;
  positionSizeOverride: number | null;
  retryCountOverride: number | null;
}

interface ProfileDraft {
  executionProfileId: string;
  executionMode: string;
  maxTrades: number;
  triggerMode: string;
  limitMode: string;
  compounding: boolean;
  positionSize: number;
  retryCount: number;
  minLiquidity: number;
  maxSpread: number;
  repricingEnabled: boolean;
  repricingIntervalMillis: number;
  repricingMaxAttempts: number;
  timeoutMillis: number;
  tickPolicy: string;
  tickSize: number;
  bufferMode: string;
  windowActiveMillis: number;
  precision: number;
  windows: WindowDraft[];
}

const NUMBER_FIELDS: [keyof ProfileDraft, string][] = [
  ["maxTrades", "Max Trades"],
  ["positionSize", "Position Size"],
  ["retryCount", "Retry Count"],
  ["minLiquidity", "Min Liquidity"],
  ["maxSpread", "Max Spread"],
  ["repricingIntervalMillis", "Repricing Interval (ms)"],
  ["repricingMaxAttempts", "Repricing Max Attempts"],
  ["timeoutMillis", "Order Timeout (ms)"],
  ["tickSize", "Tick Size"],
  ["windowActiveMillis", "Window Active (ms)"],
  ["precision", "Price Precision"],
];

function toDraft(profile: Record<string, unknown>): ProfileDraft {
  const windows = (profile["windows"] as Record<string, unknown>[] | undefined) ?? [];
  return {
    executionProfileId: String(profile["executionProfileId"] ?? "default"),
    executionMode: String(profile["executionMode"] ?? "MULTI_TRADE"),
    maxTrades: Number(profile["maxTrades"] ?? 1),
    triggerMode: String(profile["triggerMode"] ?? "TWAP_CROSS"),
    limitMode: String(profile["limitMode"] ?? "MAKER"),
    compounding: Boolean(profile["compounding"] ?? false),
    positionSize: Number(profile["positionSize"] ?? 1),
    retryCount: Number(profile["retryCount"] ?? 0),
    minLiquidity: Number(profile["minLiquidity"] ?? 0),
    maxSpread: Number(profile["maxSpread"] ?? 0),
    repricingEnabled: Boolean(profile["repricingEnabled"] ?? false),
    repricingIntervalMillis: Number(profile["repricingIntervalMillis"] ?? 1000),
    repricingMaxAttempts: Number(profile["repricingMaxAttempts"] ?? 0),
    timeoutMillis: Number(profile["timeoutMillis"] ?? 30000),
    tickPolicy: String(profile["tickPolicy"] ?? "NEAREST"),
    tickSize: Number(profile["tickSize"] ?? 0.01),
    bufferMode: String(profile["bufferMode"] ?? "ABSOLUTE"),
    windowActiveMillis: Number(profile["windowActiveMillis"] ?? 60000),
    precision: Number(profile["precision"] ?? 4),
    windows: windows.map((window) => ({
      offset: Number(window["offset"] ?? 1),
      unit: String(window["unit"] ?? "MINUTES"),
      enabled: Boolean(window["enabled"] ?? true),
      twapBuffer: Number(window["twapBuffer"] ?? 0),
      positionSizeOverride:
        window["positionSizeOverride"] === null || window["positionSizeOverride"] === undefined
          ? null
          : Number(window["positionSizeOverride"]),
      retryCountOverride:
        window["retryCountOverride"] === null || window["retryCountOverride"] === undefined
          ? null
          : Number(window["retryCountOverride"]),
    })),
  };
}

function ExecutionProfilesPage() {
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getExecutionProfileConfig);
  const saveProfile = useServerFn(saveExecutionProfileConfig);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ["arc", "execution-profile"],
    queryFn: () => fetchProfile(),
  });

  useEffect(() => {
    if (data?.profile) setDraft(toDraft(data.profile as unknown as Record<string, unknown>));
  }, [data]);

  const mutation = useMutation({
    mutationFn: (payload: ProfileDraft) => saveProfile({ data: payload as never }),
    onSuccess: () => {
      toast.success("Execution profile saved");
      queryClient.invalidateQueries({ queryKey: ["arc", "execution-profile"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patch = (partial: Partial<ProfileDraft>) =>
    setDraft((current) => (current ? { ...current, ...partial } : current));

  const patchWindow = (index: number, partial: Partial<WindowDraft>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            windows: current.windows.map((window, i) =>
              i === index ? { ...window, ...partial } : window,
            ),
          }
        : current,
    );

  return (
    <OperatorShell
      title="Execution Profiles"
      subtitle={
        data
          ? `Source ${data.source} · digest ${data.digest} · ${fmtTime(data.updatedAtIso)}`
          : "Loading profile"
      }
      actions={
        <div className="flex items-center gap-2">
          <StatusPill tone="neutral" label={draft?.executionMode ?? "—"} />
          <Button
            size="sm"
            disabled={!draft || mutation.isPending}
            onClick={() => draft && mutation.mutate(draft)}
          >
            {mutation.isPending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      }
    >
      {error ? (
        <Panel title="Execution Profile Unavailable">
          <p className="font-mono text-sm text-destructive">{(error as Error).message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            No execution profile is stored and the environment does not define one. Window offsets,
            buffers and quotas are never hardcoded — provision them on the VPS environment or store
            a configuration profile, then reload this page.
          </p>
        </Panel>
      ) : isPending || !draft ? (
        <EmptyState message="Loading execution profile…" />
      ) : (
        <div className="space-y-4">
          <Panel title="Profile">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Profile ID">
                <Input
                  value={draft.executionProfileId}
                  onChange={(event) => patch({ executionProfileId: event.target.value })}
                />
              </Field>
              <Field label="Execution Mode">
                <Select
                  value={draft.executionMode}
                  onValueChange={(value) => patch({ executionMode: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SINGLE_TRADE">SINGLE_TRADE</SelectItem>
                    <SelectItem value="MULTI_TRADE">MULTI_TRADE</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Trigger Mode">
                <Input
                  value={draft.triggerMode}
                  onChange={(event) => patch({ triggerMode: event.target.value })}
                />
              </Field>
              <Field label="Limit Mode">
                <Input
                  value={draft.limitMode}
                  onChange={(event) => patch({ limitMode: event.target.value })}
                />
              </Field>
              <Field label="Tick Policy">
                <Input
                  value={draft.tickPolicy}
                  onChange={(event) => patch({ tickPolicy: event.target.value })}
                />
              </Field>
              <Field label="Buffer Mode">
                <Input
                  value={draft.bufferMode}
                  onChange={(event) => patch({ bufferMode: event.target.value })}
                />
              </Field>
              {NUMBER_FIELDS.map(([key, label]) => (
                <Field key={String(key)} label={label}>
                  <Input
                    type="number"
                    value={String(draft[key] as number)}
                    onChange={(event) =>
                      patch({ [key]: Number(event.target.value) } as Partial<ProfileDraft>)
                    }
                  />
                </Field>
              ))}
              <ToggleField
                label="Compounding"
                checked={draft.compounding}
                onChange={(checked) => patch({ compounding: checked })}
              />
              <ToggleField
                label="Repricing Enabled"
                checked={draft.repricingEnabled}
                onChange={(checked) => patch({ repricingEnabled: checked })}
              />
            </div>
          </Panel>

          <Panel
            title="Multi-Window Execution Table"
            className="overflow-x-auto"
            actions={
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  cfg {data?.digest ?? "—"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={draft.executionMode === "SINGLE_TRADE"}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      windows: [
                        ...draft.windows,
                        {
                          offset: (draft.windows[draft.windows.length - 1]?.offset ?? 0) + 1,
                          unit: draft.windows[0]?.unit ?? WINDOW_OFFSET_UNITS[2],
                          enabled: true,
                          twapBuffer: draft.windows[draft.windows.length - 1]?.twapBuffer ?? 0,
                          positionSizeOverride: null,
                          retryCountOverride: null,
                        },
                      ],
                    })
                  }
                >
                  Add window
                </Button>
              </div>
            }
          >
            {draft.executionMode === "SINGLE_TRADE" ? (
              <p className="py-4 text-sm text-muted-foreground">
                Execution mode is <span className="font-mono">SINGLE_TRADE</span>. Only the first
                enabled window is armed per market. Switch to{" "}
                <span className="font-mono">MULTI_TRADE</span> to operate the full window table.
              </p>
            ) : null}

            {draft.windows.length === 0 ? (
              <EmptyState message="No windows configured." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Offset</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>TWAP Buffer</TableHead>
                    <TableHead>Position Size</TableHead>
                    <TableHead>Retry Count</TableHead>
                    <TableHead>Timeout</TableHead>
                    <TableHead>Override Status</TableHead>
                    <TableHead>Config Version</TableHead>
                    <TableHead className="sr-only">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.windows.map((window, index) => {
                    const overrides = [
                      window.positionSizeOverride === null ? null : "SIZE",
                      window.retryCountOverride === null ? null : "RETRY",
                    ].filter(Boolean) as string[];
                    return (
                      <TableRow key={index}>
                        <TableCell>
                          <Switch
                            checked={window.enabled}
                            aria-label={`Window ${index + 1} enabled`}
                            onCheckedChange={(checked) => patchWindow(index, { enabled: checked })}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{index + 1}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="w-24"
                            aria-label={`Window ${index + 1} offset`}
                            value={String(window.offset)}
                            onChange={(event) =>
                              patchWindow(index, { offset: Number(event.target.value) })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={window.unit}
                            onValueChange={(value) => patchWindow(index, { unit: value })}
                          >
                            <SelectTrigger className="w-20" aria-label={`Window ${index + 1} unit`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {WINDOW_OFFSET_UNITS.map((unit) => (
                                <SelectItem key={unit} value={unit}>
                                  {unit}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="w-24"
                            aria-label={`Window ${index + 1} TWAP buffer`}
                            value={String(window.twapBuffer)}
                            onChange={(event) =>
                              patchWindow(index, { twapBuffer: Number(event.target.value) })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="w-28"
                            placeholder={`${draft.positionSize}`}
                            aria-label={`Window ${index + 1} position size override`}
                            value={
                              window.positionSizeOverride === null
                                ? ""
                                : String(window.positionSizeOverride)
                            }
                            onChange={(event) =>
                              patchWindow(index, {
                                positionSizeOverride:
                                  event.target.value === "" ? null : Number(event.target.value),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="w-24"
                            placeholder={`${draft.retryCount}`}
                            aria-label={`Window ${index + 1} retry override`}
                            value={
                              window.retryCountOverride === null
                                ? ""
                                : String(window.retryCountOverride)
                            }
                            onChange={(event) =>
                              patchWindow(index, {
                                retryCountOverride:
                                  event.target.value === "" ? null : Number(event.target.value),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {draft.timeoutMillis} ms
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {overrides.length === 0 ? "INHERITED" : overrides.join(" + ")}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {data?.digest ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                windows: draft.windows.filter((_, i) => i !== index),
                              })
                            }
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>
      )}
    </OperatorShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="label-caps">{label}</Label>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <Label className="label-caps">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
