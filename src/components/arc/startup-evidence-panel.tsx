/**
 * ARC — VPS startup evidence panel (M7.10).
 *
 * Read-only. Renders the nine-step engine startup chain exactly as the trading
 * authority reported it. An unreported step is shown as PENDING, never as
 * complete: the console does not infer engine progress it was not told about.
 */
import {
  STARTUP_CHAIN_STEPS,
  STARTUP_STEP_LABELS,
  type StartupChainStep,
  type StartupEvidence,
} from "@/core/qualification";
import { EmptyState, Panel, StatusPill } from "@/components/arc/primitives";

export function StartupEvidencePanel({
  startup,
  loading,
}: {
  startup: StartupEvidence | null | undefined;
  loading?: boolean;
}) {
  const reported = new Map<string, boolean>(
    (startup?.steps ?? []).map((entry) => [entry.step, entry.ok]),
  );
  const completed = STARTUP_CHAIN_STEPS.filter((step) => reported.get(step) === true).length;

  return (
    <Panel
      title="VPS Startup Evidence"
      actions={
        <StatusPill
          tone={startup?.allowed ? "healthy" : startup ? "degraded" : "neutral"}
          label={startup ? `${completed}/${STARTUP_CHAIN_STEPS.length}` : "NO EVIDENCE"}
        />
      }
    >
      {!startup ? (
        loading ? (
          <p className="font-mono text-xs text-muted-foreground">Awaiting engine telemetry…</p>
        ) : (
          <EmptyState
            message="The trading authority has not reported a startup chain."
            hint="Startup evidence appears once the VPS engine publishes live telemetry. The control plane never infers engine startup on its own."
          />
        )
      ) : (
        <ol className="space-y-0 divide-y divide-border font-mono text-xs">
          {STARTUP_CHAIN_STEPS.map((step: StartupChainStep, index) => {
            const ok = reported.get(step) === true;
            return (
              <li key={step} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-baseline gap-3">
                  <span className="text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate">{STARTUP_STEP_LABELS[step]}</span>
                </span>
                <span className={ok ? "text-primary" : "text-muted-foreground"}>
                  {ok ? "REPORTED" : "PENDING"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
