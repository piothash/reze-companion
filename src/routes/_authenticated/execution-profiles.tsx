import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, LoadingState, Panel, StatusPill } from "@/components/arc/primitives";
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
import {
  DEFAULT_PROFILE_SEED,
  executionProfileSchema,
  offsetToMillis,
} from "@/core/decision/configuration";
import { WINDOW_OFFSET_UNITS, type WindowOffsetUnit } from "@/core/decision/types";
import { getExecutionProfileConfig } from "@/lib/operations.functions";
import {
  activateConfigurationVersion,
  archiveConfigurationVersion,
  getConfigurationRuntimeView,
  publishConfigurationVersion,
} from "@/lib/configuration.functions";

export const Route = createFileRoute("/_authenticated/execution-profiles")({
  head: () => ({
    meta: [
      { title: "Execution Profiles — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Configure the ARC execution profile: execution mode, trades per market, TWAP buffers, dynamic window definitions, inheritance and repricing behaviour.",
      },
      { property: "og:title", content: "Execution Profiles — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Global execution settings and window definitions for the ARC control plane.",
      },
    ],
  }),
  component: ExecutionProfilesPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

// ---------------------------------------------------------------------------
// Draft model — presentation shape only. Persisted document stays canonical.
// ---------------------------------------------------------------------------

interface WindowDraft {
  offset: number;
  unit: WindowOffsetUnit;
  enabled: boolean;
  twapBuffer: number;
  positionSizeOverride: number | null;
  retryCountOverride: number | null;
  timeoutMillisOverride: number | null;
  maxSpreadOverride: number | null;
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

const MODE_LABEL: Record<string, string> = {
  SINGLE_TRADE: "Single Trade",
  MULTI_TRADE: "Multi Window",
};

const UNIT_LABEL: Record<WindowOffsetUnit, string> = {
  ms: "milliseconds",
  s: "seconds",
  m: "minutes",
  h: "hours",
};

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toDraft(profile: Record<string, unknown>): ProfileDraft {
  const windows = (profile["windows"] as Record<string, unknown>[] | undefined) ?? [];
  return {
    executionProfileId: String(profile["executionProfileId"] ?? "default"),
    executionMode: String(profile["executionMode"] ?? "MULTI_TRADE"),
    maxTrades: num(profile["maxTrades"], 1),
    triggerMode: String(profile["triggerMode"] ?? ""),
    limitMode: String(profile["limitMode"] ?? ""),
    compounding: Boolean(profile["compounding"] ?? false),
    positionSize: num(profile["positionSize"], 1),
    retryCount: num(profile["retryCount"], 0),
    minLiquidity: num(profile["minLiquidity"], 0),
    maxSpread: num(profile["maxSpread"], 0),
    repricingEnabled: Boolean(profile["repricingEnabled"] ?? false),
    repricingIntervalMillis: num(profile["repricingIntervalMillis"], 1000),
    repricingMaxAttempts: num(profile["repricingMaxAttempts"], 0),
    timeoutMillis: num(profile["timeoutMillis"], 10_000),
    tickPolicy: String(profile["tickPolicy"] ?? ""),
    tickSize: num(profile["tickSize"], 0.01),
    bufferMode: String(profile["bufferMode"] ?? "PERCENT"),
    windowActiveMillis: num(profile["windowActiveMillis"], 30_000),
    precision: num(profile["precision"], 2),
    windows: windows.map((window) => ({
      offset: num(window["offset"], 1),
      unit: (WINDOW_OFFSET_UNITS as readonly string[]).includes(String(window["unit"]))
        ? (String(window["unit"]) as WindowOffsetUnit)
        : "s",
      enabled: Boolean(window["enabled"] ?? true),
      twapBuffer: num(window["twapBuffer"], 0),
      positionSizeOverride: nullableNum(window["positionSizeOverride"]),
      retryCountOverride: nullableNum(window["retryCountOverride"]),
      timeoutMillisOverride: nullableNum(window["timeoutMillisOverride"]),
      maxSpreadOverride: nullableNum(window["maxSpreadOverride"]),
    })),
  };
}

/** Windows ordered furthest-from-resolution first — the basis for priority. */
function orderWindows(windows: WindowDraft[]): WindowDraft[] {
  return [...windows].sort(
    (a, b) => offsetToMillis(b.offset, b.unit) - offsetToMillis(a.offset, a.unit),
  );
}

function bufferLabel(value: number, bufferMode: string): string {
  if (bufferMode === "PERCENT") {
    const percent = value * 100;
    return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
  }
  return value.toString();
}

function validate(draft: ProfileDraft): string[] {
  const issues: string[] = [];
  if (draft.executionProfileId.trim() === "") issues.push("Profile ID cannot be empty.");
  if (draft.windows.length === 0) {
    issues.push("A profile needs at least one window definition.");
  }
  const enabled = draft.windows.filter((window) => window.enabled);
  if (draft.windows.length > 0 && enabled.length === 0) {
    issues.push("At least one window must be enabled — all windows are currently disabled.");
  }
  const seen = new Set<number>();
  for (const window of draft.windows) {
    const millis = offsetToMillis(window.offset, window.unit);
    if (!(window.offset > 0)) issues.push("Window offsets must be greater than zero.");
    if (seen.has(millis)) {
      issues.push(`Duplicate window offset: ${window.offset} ${UNIT_LABEL[window.unit]}.`);
    }
    seen.add(millis);
    if (!(window.twapBuffer >= 0)) issues.push("TWAP buffers cannot be negative.");
    if (window.timeoutMillisOverride !== null && !(window.timeoutMillisOverride > 0)) {
      issues.push("Timeout overrides must be greater than zero.");
    }
    if (window.positionSizeOverride !== null && !(window.positionSizeOverride > 0)) {
      issues.push("Position overrides must be greater than zero.");
    }
    if (window.retryCountOverride !== null && !(window.retryCountOverride >= 0)) {
      issues.push("Retry overrides cannot be negative.");
    }
    if (window.maxSpreadOverride !== null && !(window.maxSpreadOverride >= 0)) {
      issues.push("Maximum spread overrides cannot be negative.");
    }
  }
  if (!(draft.timeoutMillis > 0)) issues.push("Global order timeout must be greater than zero.");
  if (!(draft.maxTrades > 0)) issues.push("Trades Per Market must be at least 1.");
  if (
    draft.executionMode === "MULTI_TRADE" &&
    enabled.length > 0 &&
    draft.maxTrades > enabled.length
  ) {
    issues.push(
      `Trades Per Market (${draft.maxTrades}) exceeds the enabled window quota (${enabled.length}) — the quota can never be reached.`,
    );
  }
  if (draft.executionMode === "SINGLE_TRADE" && draft.maxTrades !== 1) {
    issues.push("Single Trade mode allows exactly one execution per market.");
  }
  return [...new Set(issues)];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ExecutionProfilesPage() {
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getExecutionProfileConfig);
  const publishProfile = useServerFn(publishConfigurationVersion);
  const activateVersion = useServerFn(activateConfigurationVersion);
  const archiveVersionFn = useServerFn(archiveConfigurationVersion);
  const fetchRuntime = useServerFn(getConfigurationRuntimeView);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [manualPriority, setManualPriority] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ["arc", "execution-profile"],
    queryFn: () => fetchProfile(),
    retry: false,
  });

  const runtimeQuery = useQuery({
    queryKey: ["arc", "configuration-runtime"],
    queryFn: () => fetchRuntime(),
    retry: false,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (data?.profile) setDraft(toDraft(data.profile as unknown as Record<string, unknown>));
  }, [data]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["arc", "execution-profile"] });
    queryClient.invalidateQueries({ queryKey: ["arc", "configuration-runtime"] });
  };

  /** The console never claims success on its own — it reports the authority verdict. */
  const reportOutcome = (result: {
    outcome: string;
    version: number | null;
    reasonCode: string;
    detail: string;
  }) => {
    const suffix = result.version ? ` · v${result.version}` : "";
    if (result.outcome === "APPLIED") {
      toast.success(`Configuration active on the trading authority${suffix}`, {
        description: result.detail,
      });
    } else if (result.outcome === "PENDING") {
      toast.warning(`Version stored, not yet running${suffix}`, { description: result.detail });
    } else {
      toast.error(`Rejected — ${result.reasonCode}`, { description: result.detail });
    }
    refreshAll();
  };

  const mutation = useMutation({
    mutationFn: (payload: ProfileDraft) =>
      publishProfile({ data: { profile: payload, origin: "SAVE" } as never }),
    onSuccess: (result) => reportOutcome(result as never),
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const activation = useMutation({
    mutationFn: (version: number) =>
      activateVersion({ data: { version, origin: "ROLLBACK" } as never }),
    onSuccess: (result) => reportOutcome(result as never),
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const archival = useMutation({
    mutationFn: (version: number) => archiveVersionFn({ data: { version } as never }),
    onSuccess: () => {
      toast.success("Version archived");
      refreshAll();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
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

  const startNewProfile = () => {
    const base = executionProfileSchema.omit({ windows: true }).parse({
      executionMode: "MULTI_TRADE",
      bufferMode: DEFAULT_PROFILE_SEED.bufferMode,
      maxTrades: DEFAULT_PROFILE_SEED.windows.length,
    });
    const windows = DEFAULT_PROFILE_SEED.windows.map((window) =>
      executionProfileSchema.shape.windows.element.parse(window),
    );
    setDraft(toDraft({ ...base, windows } as unknown as Record<string, unknown>));
  };

  const windows = useMemo(
    () => (draft ? (manualPriority ? draft.windows : orderWindows(draft.windows)) : []),
    [draft, manualPriority],
  );

  const issues = draft ? validate(draft) : [];
  const saveDisabled = !draft || issues.length > 0 || mutation.isPending;

  const submit = () => {
    if (!draft) return;
    mutation.mutate({
      ...draft,
      windows: manualPriority ? draft.windows : orderWindows(draft.windows),
    });
  };

  return (
    <OperatorShell
      title="Execution Profiles"
      subtitle={
        data?.profile
          ? `Source ${data.source} · digest ${data.digest} · ${fmtTime(data.updatedAtIso)}`
          : "No execution profile configured"
      }
      actions={
        <div className="flex items-center gap-2">
          <StatusPill
            tone="neutral"
            label={draft ? (MODE_LABEL[draft.executionMode] ?? draft.executionMode) : "—"}
          />
          <Button size="sm" disabled={saveDisabled} onClick={submit}>
            {mutation.isPending ? "Publishing…" : "Publish to authority"}
          </Button>

        </div>
      }
    >
      {error ? (
        <Panel title="Execution Profile Unavailable">
          <p className="font-mono text-sm text-destructive">{(error as Error).message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            The stored profile could not be read. Window offsets, buffers and quotas are never
            hardcoded — correct the stored configuration or the VPS environment, then reload.
          </p>
        </Panel>
      ) : isPending ? (
        <Panel title="Execution Profile">
          <LoadingState label="Reading execution profile" />
        </Panel>
      ) : !draft ? (
        <Panel title="Execution Profile">
          <EmptyState
            message="No execution profile configured."
            hint={
              data?.invalidReason
                ? `Stored profile rejected: ${data.invalidReason}. Create a new profile to begin.`
                : "Create one to begin. The default profile arms windows at 15s, 10s, 7s, 5s and 3s before resolution — every value stays editable."
            }
            action={
              <Button size="sm" onClick={startNewProfile}>
                Create execution profile
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <RuntimePanel
              view={runtimeQuery.data as RuntimeView | undefined}
              loading={runtimeQuery.isPending}
              error={runtimeQuery.error as Error | null}
            />

            {issues.length > 0 ? (
              <Panel title="Validation">
                <ul className="space-y-1">
                  {issues.map((issue) => (
                    <li key={issue} className="font-mono text-xs text-destructive">
                      {issue}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Saving is blocked until every item above is resolved.
                </p>
              </Panel>
            ) : null}

            <Panel title="Global Execution Profile">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field
                  label="Profile ID"
                  help="Identifier stamped onto every configuration snapshot and intent."
                >
                  <Input
                    value={draft.executionProfileId}
                    onChange={(event) => patch({ executionProfileId: event.target.value })}
                  />
                </Field>
                <Field
                  label="Execution Mode"
                  help="Single Trade arms one window per market. Multi Window arms the full window table."
                >
                  <Select
                    value={draft.executionMode}
                    onValueChange={(value) =>
                      patch({
                        executionMode: value,
                        maxTrades: value === "SINGLE_TRADE" ? 1 : draft.maxTrades,
                      })
                    }
                  >
                    <SelectTrigger aria-label="Execution mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SINGLE_TRADE">Single Trade</SelectItem>
                      <SelectItem value="MULTI_TRADE">Multi Window</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Trades Per Market"
                  help="Maximum successful executions allowed for a market instance."
                >
                  <Input
                    type="number"
                    aria-label="Trades per market"
                    disabled={draft.executionMode === "SINGLE_TRADE"}
                    value={String(draft.maxTrades)}
                    onChange={(event) => patch({ maxTrades: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Position Size" help="Default order size used by every window.">
                  <Input
                    type="number"
                    value={String(draft.positionSize)}
                    onChange={(event) => patch({ positionSize: Number(event.target.value) })}
                  />
                </Field>
                <Field
                  label="Retry Count"
                  help="Retries allowed after a rejected order before the window completes."
                >
                  <Input
                    type="number"
                    value={String(draft.retryCount)}
                    onChange={(event) => patch({ retryCount: Number(event.target.value) })}
                  />
                </Field>
                <Field
                  label="Maximum Spread"
                  help="Widest book spread accepted before execution is refused."
                >
                  <Input
                    type="number"
                    value={String(draft.maxSpread)}
                    onChange={(event) => patch({ maxSpread: Number(event.target.value) })}
                  />
                </Field>
                <Field
                  label="Order Timeout"
                  help="How long a standing order may rest before it is withdrawn."
                >
                  <SecondsInput
                    label="Global order timeout"
                    millis={draft.timeoutMillis}
                    onChange={(millis) => patch({ timeoutMillis: millis })}
                  />
                </Field>
                <Field
                  label="Window Active Duration"
                  help="How long a window stays armed before it expires unfilled."
                >
                  <SecondsInput
                    label="Window active duration"
                    millis={draft.windowActiveMillis}
                    onChange={(millis) => patch({ windowActiveMillis: millis })}
                  />
                </Field>
                <Field
                  label="Minimum Liquidity"
                  help="Book depth required before a window may create an execution intent."
                >
                  <Input
                    type="number"
                    value={String(draft.minLiquidity)}
                    onChange={(event) => patch({ minLiquidity: Number(event.target.value) })}
                  />
                </Field>
                <Field
                  label="Repricing Interval"
                  help="Delay between cancel/replace attempts while repricing is enabled."
                >
                  <SecondsInput
                    label="Repricing interval"
                    millis={draft.repricingIntervalMillis}
                    onChange={(millis) => patch({ repricingIntervalMillis: millis })}
                  />
                </Field>
                <Field
                  label="Repricing Attempts"
                  help="Maximum cancel/replace cycles allowed for one standing order."
                >
                  <Input
                    type="number"
                    value={String(draft.repricingMaxAttempts)}
                    onChange={(event) =>
                      patch({ repricingMaxAttempts: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field
                  label="Tick Policy"
                  help="Rounding applied when snapping a price to the tick grid."
                >
                  <Select
                    value={draft.tickPolicy}
                    onValueChange={(value) => patch({ tickPolicy: value })}
                  >
                    <SelectTrigger aria-label="Tick policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ROUND_NEAREST">Round nearest</SelectItem>
                      <SelectItem value="ROUND_DOWN">Round down</SelectItem>
                      <SelectItem value="ROUND_UP">Round up</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tick Size" help="Smallest price increment accepted by the venue.">
                  <Input
                    type="number"
                    value={String(draft.tickSize)}
                    onChange={(event) => patch({ tickSize: Number(event.target.value) })}
                  />
                </Field>
                <Field
                  label="Buffer Mode"
                  help="Percentage buffers scale with price. Absolute buffers are raw price distance."
                >
                  <Select
                    value={draft.bufferMode}
                    onValueChange={(value) => patch({ bufferMode: value })}
                  >
                    <SelectTrigger aria-label="Buffer mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENT">Percentage</SelectItem>
                      <SelectItem value="ABSOLUTE">Absolute</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Price Precision"
                  help="Decimal places used when publishing a limit price."
                >
                  <Input
                    type="number"
                    value={String(draft.precision)}
                    onChange={(event) => patch({ precision: Number(event.target.value) })}
                  />
                </Field>
                <ToggleField
                  label="Compounding"
                  help="Reinvest realised size into the next execution of the same market."
                  checked={draft.compounding}
                  onChange={(checked) => patch({ compounding: checked })}
                />
                <ToggleField
                  label="Repricing"
                  help="Allow a resting order to be cancelled and replaced while a window is active."
                  checked={draft.repricingEnabled}
                  onChange={(checked) => patch({ repricingEnabled: checked })}
                />
              </div>
            </Panel>

            <Panel
              title="Window Definitions"
              className="overflow-x-auto"
              actions={
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2">
                    <span className="label-caps">Manual priority</span>
                    <Switch
                      checked={manualPriority}
                      aria-label="Manual priority"
                      onCheckedChange={setManualPriority}
                    />
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">
                    cfg {data?.digest ?? "—"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={draft.executionMode === "SINGLE_TRADE" && draft.windows.length >= 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        windows: [
                          ...draft.windows,
                          {
                            offset: Math.max(
                              1,
                              Math.min(...draft.windows.map((w) => w.offset), Infinity) - 1,
                            ),
                            unit: draft.windows[0]?.unit ?? "s",
                            enabled: true,
                            twapBuffer: 0,
                            positionSizeOverride: null,
                            retryCountOverride: null,
                            timeoutMillisOverride: null,
                            maxSpreadOverride: null,
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
              <p className="pb-3 text-xs text-muted-foreground">
                Each window arms at its offset before market resolution. Priority follows offset
                order (furthest first) unless manual priority is enabled.
              </p>

              {draft.windows.length === 0 ? (
                <EmptyState
                  message="No window definitions."
                  hint="Add at least one window: an offset before market close plus the TWAP buffer required to create an execution intent."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Enabled</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Offset</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>TWAP Buffer</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Retry</TableHead>
                      <TableHead>Timeout</TableHead>
                      <TableHead>Max Spread</TableHead>
                      <TableHead>Inheritance</TableHead>
                      <TableHead>Quota Cost</TableHead>
                      <TableHead className="sr-only">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {windows.map((window, position) => {
                      const index = draft.windows.indexOf(window);
                      const overrides = [
                        window.positionSizeOverride === null ? null : "POSITION",
                        window.retryCountOverride === null ? null : "RETRY",
                        window.timeoutMillisOverride === null ? null : "TIMEOUT",
                        window.maxSpreadOverride === null ? null : "SPREAD",
                      ].filter(Boolean) as string[];
                      return (
                        <TableRow key={index}>
                          <TableCell>
                            <Switch
                              checked={window.enabled}
                              aria-label={`Window ${position + 1} enabled`}
                              onCheckedChange={(checked) =>
                                patchWindow(index, { enabled: checked })
                              }
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{position + 1}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="w-20"
                              aria-label={`Window ${position + 1} offset`}
                              value={String(window.offset)}
                              onChange={(event) =>
                                patchWindow(index, { offset: Number(event.target.value) })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={window.unit}
                              onValueChange={(value) =>
                                patchWindow(index, { unit: value as WindowOffsetUnit })
                              }
                            >
                              <SelectTrigger
                                className="w-28"
                                aria-label={`Window ${position + 1} unit`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {WINDOW_OFFSET_UNITS.map((unit) => (
                                  <SelectItem key={unit} value={unit}>
                                    {UNIT_LABEL[unit]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                className="w-24"
                                aria-label={`Window ${position + 1} TWAP buffer`}
                                value={
                                  draft.bufferMode === "PERCENT"
                                    ? String(Number((window.twapBuffer * 100).toFixed(4)))
                                    : String(window.twapBuffer)
                                }
                                onChange={(event) =>
                                  patchWindow(index, {
                                    twapBuffer:
                                      draft.bufferMode === "PERCENT"
                                        ? Number(event.target.value) / 100
                                        : Number(event.target.value),
                                  })
                                }
                              />
                              <span className="font-mono text-xs text-muted-foreground">
                                {draft.bufferMode === "PERCENT" ? "%" : "abs"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <OverrideCell
                              label={`Window ${position + 1} position`}
                              value={window.positionSizeOverride}
                              inherited={draft.positionSize}
                              onChange={(value) =>
                                patchWindow(index, { positionSizeOverride: value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <OverrideCell
                              label={`Window ${position + 1} retry`}
                              value={window.retryCountOverride}
                              inherited={draft.retryCount}
                              onChange={(value) =>
                                patchWindow(index, { retryCountOverride: value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <OverrideCell
                              label={`Window ${position + 1} timeout`}
                              unit="sec"
                              value={
                                window.timeoutMillisOverride === null
                                  ? null
                                  : window.timeoutMillisOverride / 1000
                              }
                              inherited={draft.timeoutMillis / 1000}
                              onChange={(value) =>
                                patchWindow(index, {
                                  timeoutMillisOverride:
                                    value === null ? null : Math.round(value * 1000),
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <OverrideCell
                              label={`Window ${position + 1} maximum spread`}
                              value={window.maxSpreadOverride}
                              inherited={draft.maxSpread}
                              onChange={(value) => patchWindow(index, { maxSpreadOverride: value })}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {overrides.length === 0 ? "Inherited" : overrides.join(" + ")}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {window.enabled ? "1 trade" : "—"}
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

            <VersionHistoryPanel
              view={runtimeQuery.data as RuntimeView | undefined}
              busyVersion={
                activation.isPending
                  ? (activation.variables ?? null)
                  : archival.isPending
                    ? (archival.variables ?? null)
                    : null
              }
              onActivate={(version) => activation.mutate(version)}
              onArchive={(version) => archival.mutate(version)}
            />
          </div>


          <Panel title="Profile Summary" className="h-fit xl:sticky xl:top-4">
            <dl className="grid gap-y-2">
              {(
                [
                  ["Execution mode", MODE_LABEL[draft.executionMode] ?? draft.executionMode],
                  ["Trades per market", String(draft.maxTrades)],
                  [
                    "Windows enabled",
                    `${draft.windows.filter((window) => window.enabled).length} / ${draft.windows.length}`,
                  ],
                  ["Buffer mode", draft.bufferMode === "PERCENT" ? "Percentage" : "Absolute"],
                  ["Order timeout", `${draft.timeoutMillis / 1000} sec`],
                  ["Window active", `${draft.windowActiveMillis / 1000} sec`],
                  ["Repricing", draft.repricingEnabled ? "Enabled" : "Disabled"],
                  ["Compounding", draft.compounding ? "Enabled" : "Disabled"],
                ] as [string, string][]
              ).map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-3">
                  <dt className="label-caps">{key}</dt>
                  <dd className="font-mono text-sm">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 border-t border-border pt-3">
              <p className="label-caps pb-2">Buffers</p>
              {windows.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">No windows defined.</p>
              ) : (
                <ul className="space-y-1">
                  {windows.map((window, position) => (
                    <li
                      key={`${window.offset}${window.unit}-${position}`}
                      className="flex items-center justify-between font-mono text-xs"
                    >
                      <span className={window.enabled ? "" : "text-muted-foreground line-through"}>
                        {window.offset}
                        {window.unit}
                      </span>
                      <span className={window.enabled ? "" : "text-muted-foreground"}>
                        {bufferLabel(window.twapBuffer, draft.bufferMode)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
              The companion stores configuration only. The VPS remains the sole trading authority.
            </p>
          </Panel>
        </div>
      )}
    </OperatorShell>
  );
}

// ---------------------------------------------------------------------------
// Presentation primitives
// ---------------------------------------------------------------------------

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="label-caps">{label}</Label>
      {children}
      {help ? <p className="text-xs leading-snug text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function ToggleField({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <Label className="label-caps">{label}</Label>
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      </div>
      {help ? <p className="text-xs leading-snug text-muted-foreground">{help}</p> : null}
    </div>
  );
}

/** Operator-facing seconds input; milliseconds stay internal. */
function SecondsInput({
  label,
  millis,
  onChange,
}: {
  label: string;
  millis: number;
  onChange: (millis: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        aria-label={label}
        value={String(Number((millis / 1000).toFixed(3)))}
        onChange={(event) => onChange(Math.round(Number(event.target.value) * 1000))}
      />
      <span className="font-mono text-xs text-muted-foreground">sec</span>
    </div>
  );
}

/** Inherited / Override switch with a numeric field when overridden. */
function OverrideCell({
  label,
  value,
  inherited,
  unit,
  onChange,
}: {
  label: string;
  value: number | null;
  inherited: number;
  unit?: string;
  onChange: (value: number | null) => void;
}) {
  const overridden = value !== null;
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={overridden}
        aria-label={`${label} override`}
        onCheckedChange={(checked) => onChange(checked ? inherited : null)}
      />
      {overridden ? (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            className="w-20"
            aria-label={`${label} override value`}
            value={String(value)}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          {unit ? <span className="font-mono text-xs text-muted-foreground">{unit}</span> : null}
        </div>
      ) : (
        <span className="font-mono text-xs text-muted-foreground">
          Global {inherited}
          {unit ? ` ${unit}` : ""}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime synchronization (M6.7)
// ---------------------------------------------------------------------------

interface RuntimeVersion {
  version: number;
  status: string;
  configHash: string;
  origin: string;
  reasonCode: string;
  rejectionReason: string | null;
  snapshotId: string | null;
  createdAtIso: string;
  appliedAtIso: string | null;
}

interface RuntimeView {
  versions: RuntimeVersion[];
  latestActive: RuntimeVersion | null;
  pending: RuntimeVersion[];
  runtime: {
    version: number | null;
    configHash: string | null;
    snapshotId: string | null;
    runtimeStatus: string;
    activatedAtIso: string | null;
    engineVersion: string | null;
    lastSyncedAtIso: string | null;
    live: boolean;
  } | null;
  drift: { drifted: boolean; reasonCode: string; detail: string };
  authority: {
    registered: boolean;
    name: string | null;
    baseUrlHost: string | null;
    environment: string | null;
    reachable: boolean;
    detail: string;
    latencyMillis: number | null;
  };
}

const VERSION_TONE: Record<string, "positive" | "negative" | "warning" | "neutral"> = {
  ACTIVE: "positive",
  REJECTED: "negative",
  PENDING: "warning",
  SUPERSEDED: "neutral",
  ARCHIVED: "neutral",
};

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return hash.length > 14 ? `${hash.slice(0, 14)}…` : hash;
}

/** What the trading authority reports it is actually running right now. */
function RuntimePanel({
  view,
  loading,
  error,
}: {
  view: RuntimeView | undefined;
  loading: boolean;
  error: Error | null;
}) {
  if (error) {
    return (
      <Panel title="Active Runtime Configuration">
        <p className="font-mono text-sm text-destructive">{error.message}</p>
      </Panel>
    );
  }
  if (loading || !view) {
    return (
      <Panel title="Active Runtime Configuration">
        <LoadingState label="Querying trading authority" />
      </Panel>
    );
  }

  const { runtime, authority, drift, latestActive } = view;
  const tone = !authority.registered
    ? "neutral"
    : !authority.reachable
      ? "negative"
      : drift.drifted
        ? "warning"
        : "positive";
  const label = !authority.registered
    ? "NO AUTHORITY"
    : !authority.reachable
      ? "UNREACHABLE"
      : drift.drifted
        ? "DRIFT"
        : "IN SYNC";

  return (
    <Panel
      title="Active Runtime Configuration"
      actions={<StatusPill tone={tone as never} label={label} />}
    >
      {!authority.registered ? (
        <EmptyState
          message="Waiting for VPS connection."
          hint="No active engine endpoint is registered. Configuration versions are stored and stay PENDING until the trading authority accepts them."
        />
      ) : (
        <>
          <dl className="grid gap-y-2 sm:grid-cols-2 sm:gap-x-6">
            {(
              [
                ["Running version", runtime?.version ? `v${runtime.version}` : "—"],
                ["Saved version", latestActive ? `v${latestActive.version}` : "—"],
                ["Runtime status", runtime?.runtimeStatus ?? "UNKNOWN"],
                ["Snapshot", shortHash(runtime?.snapshotId ?? null)],
                ["Running hash", shortHash(runtime?.configHash ?? null)],
                ["Saved hash", shortHash(latestActive?.configHash ?? null)],
                ["Activated", runtime?.activatedAtIso ? fmtTime(runtime.activatedAtIso) : "—"],
                [
                  "Last sync",
                  runtime?.lastSyncedAtIso ? fmtTime(runtime.lastSyncedAtIso) : "never",
                ],
                ["Engine", runtime?.engineVersion ?? "—"],
                [
                  "Authority",
                  `${authority.baseUrlHost ?? "—"}${
                    authority.latencyMillis !== null ? ` · ${authority.latencyMillis}ms` : ""
                  }`,
                ],
              ] as [string, string][]
            ).map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="label-caps">{key}</dt>
                <dd className="font-mono text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            {drift.drifted ? `${drift.reasonCode} — ${drift.detail}` : authority.detail}
            {runtime && !runtime.live
              ? " · Values mirrored from the last successful sync, not a live read."
              : ""}
          </p>
        </>
      )}
    </Panel>
  );
}

/** Immutable version ledger — versions are never overwritten, only superseded. */
function VersionHistoryPanel({
  view,
  busyVersion,
  onActivate,
  onArchive,
}: {
  view: RuntimeView | undefined;
  busyVersion: number | null;
  onActivate: (version: number) => void;
  onArchive: (version: number) => void;
}) {
  if (!view) return null;
  return (
    <Panel title="Configuration Versions">
      {view.versions.length === 0 ? (
        <EmptyState
          message="No configuration versions published."
          hint="Publishing a profile stores an immutable version and dispatches it to the trading authority."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Origin</TableHead>
              <TableHead>Hash</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.versions.map((item) => (
              <TableRow key={item.version}>
                <TableCell className="font-mono">v{item.version}</TableCell>
                <TableCell>
                  <StatusPill
                    tone={(VERSION_TONE[item.status] ?? "neutral") as never}
                    label={item.status}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{item.origin}</TableCell>
                <TableCell className="font-mono text-xs">{shortHash(item.configHash)}</TableCell>
                <TableCell className="font-mono text-xs">{fmtTime(item.createdAtIso)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {item.appliedAtIso ? fmtTime(item.appliedAtIso) : (item.rejectionReason ?? "—")}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {item.status !== "ACTIVE" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyVersion !== null}
                        onClick={() => onActivate(item.version)}
                      >
                        {busyVersion === item.version ? "Sending…" : "Activate"}
                      </Button>
                    ) : null}
                    {item.status !== "ACTIVE" && item.status !== "ARCHIVED" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyVersion !== null}
                        onClick={() => onArchive(item.version)}
                      >
                        Archive
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
