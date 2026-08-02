/**
 * ARC — M8.1 production incident & diagnostics center.
 *
 * Read-only. Diagnoses real VPS problems after deployment: authority liveness,
 * configuration activation, the engine startup chain, and every open incident
 * stated as problem → reason → missing evidence → required action → expected
 * recovery. It issues no commands: the VPS remains the sole trading authority.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import {
  EmptyState,
  LoadingState,
  Metric,
  Panel,
  StatusPill,
  type StatusTone,
} from "@/components/arc/primitives";
import { getLiveQualificationEvidence } from "@/lib/qualification.functions";
import {
  deriveOperationsDiagnostics,
  formatHeartbeatAge,
  type AuthorityDisplayStatus,
  type ConfigurationActivationState,
  type IncidentSeverity,
  type OperatorIncident,
  type StartupStepStatus,
} from "@/core/platform";

export const Route = createFileRoute("/_authenticated/operations")({
  head: () => ({
    meta: [
      { title: "Operations Diagnostics — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Production incident and diagnostics center: authority liveness, configuration activation, engine startup chain and actionable operator incidents.",
      },
      { property: "og:title", content: "Operations Diagnostics — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Diagnose live VPS trading authority issues from reported evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OperationsPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

const AUTHORITY_TONE: Record<AuthorityDisplayStatus, StatusTone> = {
  ACTIVE: "healthy",
  STALE: "degraded",
  REVOKED: "unavailable",
  UNREGISTERED: "neutral",
};

const CONFIG_TONE: Record<ConfigurationActivationState, StatusTone> = {
  ACTIVE: "healthy",
  ACCEPTED: "healthy",
  PENDING: "degraded",
  NOT_PUBLISHED: "neutral",
  REJECTED: "unavailable",
  DRIFTED: "unavailable",
};

const STARTUP_TONE: Record<StartupStepStatus, string> = {
  PASS: "text-primary",
  WAITING: "text-muted-foreground",
  FAILED: "text-destructive",
};

const SEVERITY_TONE: Record<IncidentSeverity, StatusTone> = {
  CRITICAL: "unavailable",
  WARNING: "degraded",
  INFO: "neutral",
};

function IncidentCard({ incident }: { incident: OperatorIncident }) {
  return (
    <article className="border-b border-border py-4 last:border-b-0 last:pb-0 first:pt-0">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="label-caps text-muted-foreground">{incident.area}</p>
          <h3 className="mt-1 font-mono text-sm">{incident.problem}</h3>
        </div>
        <StatusPill tone={SEVERITY_TONE[incident.severity]} label={incident.severity} />
      </header>
      <dl className="mt-3 grid gap-1.5 font-mono text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className="label-caps text-muted-foreground">Reason</dt>
        <dd className="text-muted-foreground">{incident.reason}</dd>
        <dt className="label-caps text-muted-foreground">Missing</dt>
        <dd className="text-muted-foreground">{incident.missingEvidence}</dd>
        <dt className="label-caps text-muted-foreground">Required</dt>
        <dd className="text-foreground">{incident.requiredAction}</dd>
        <dt className="label-caps text-muted-foreground">Recovery</dt>
        <dd className="text-muted-foreground">{incident.expectedRecovery}</dd>
      </dl>
    </article>
  );
}

function OperationsPage() {
  const fetchEvidence = useServerFn(getLiveQualificationEvidence);

  const evidence = useQuery({
    queryKey: ["arc", "operations", "evidence"],
    queryFn: () => fetchEvidence(),
    refetchInterval: 20_000,
  });

  const snapshot = evidence.data?.snapshot ?? null;
  const diagnostics = snapshot ? deriveOperationsDiagnostics(snapshot) : null;
  const authority = snapshot?.authority ?? null;
  const configuration = snapshot?.configuration ?? null;

  return (
    <OperatorShell
      title="Operations Diagnostics"
      subtitle="Production incident center — every verdict is derived from reported VPS evidence"
      actions={
        diagnostics ? (
          <StatusPill
            tone={
              diagnostics.incidents.some((incident) => incident.severity === "CRITICAL")
                ? "unavailable"
                : diagnostics.incidents.length > 0
                  ? "degraded"
                  : "healthy"
            }
            label={
              diagnostics.incidents.length === 0
                ? "NO OPEN INCIDENTS"
                : `${diagnostics.incidents.length} OPEN`
            }
          />
        ) : null
      }
    >
      {evidence.isLoading && !diagnostics ? (
        <LoadingState label="Reading authority evidence…" />
      ) : evidence.isError ? (
        <Panel title="Diagnostics unavailable">
          <EmptyState
            message="The control plane could not read authority evidence."
            hint={(evidence.error as Error).message}
          />
        </Panel>
      ) : !diagnostics ? (
        <Panel title="Diagnostics">
          <EmptyState
            message="No evidence has been collected yet."
            hint="Diagnostics populate once the control plane can read the authority registry."
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Authority"
              value={diagnostics.authority.status}
              hint={authority?.authorityId ?? "no authority registered"}
            />
            <Metric
              label="Last heartbeat"
              value={formatHeartbeatAge(diagnostics.authority.heartbeatAgeMillis)}
              hint={`stale after ${Math.round(diagnostics.authority.heartbeatDeadlineMillis / 1000)}s`}
            />
            <Metric
              label="Latency"
              value={authority?.latencyMillis === null || authority === null
                ? "—"
                : `${authority.latencyMillis} ms`}
              hint="reported on the last verified heartbeat"
            />
            <Metric
              label="Runtime identity"
              value={authority?.runtimeIdentity ?? "—"}
              hint={authority?.engineVersion ?? "engine version not reported"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title="Authority"
              actions={
                <StatusPill
                  tone={AUTHORITY_TONE[diagnostics.authority.status]}
                  label={diagnostics.authority.status}
                />
              }
            >
              <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-y-2 font-mono text-xs">
                <dt className="label-caps text-muted-foreground">Registered</dt>
                <dd>{authority ? "YES" : "NO"}</dd>
                <dt className="label-caps text-muted-foreground">Environment</dt>
                <dd>{authority?.environment ?? "—"}</dd>
                <dt className="label-caps text-muted-foreground">Runtime identity</dt>
                <dd className="truncate">{authority?.runtimeIdentity ?? "not reported"}</dd>
                <dt className="label-caps text-muted-foreground">Last heartbeat</dt>
                <dd>{authority?.lastSeenIso ?? "never"}</dd>
                <dt className="label-caps text-muted-foreground">Heartbeat age</dt>
                <dd>{formatHeartbeatAge(diagnostics.authority.heartbeatAgeMillis)}</dd>
                <dt className="label-caps text-muted-foreground">Event sequence</dt>
                <dd>{authority?.eventSequence ?? "—"}</dd>
              </dl>
              {diagnostics.authority.blockers.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-border pt-3 font-mono text-xs text-muted-foreground">
                  {diagnostics.authority.blockers.map((blocker) => (
                    <li key={blocker}>— {blocker}</li>
                  ))}
                </ul>
              ) : null}
            </Panel>

            <Panel
              title="Configuration"
              actions={
                <StatusPill
                  tone={CONFIG_TONE[diagnostics.configuration.state]}
                  label={diagnostics.configuration.state}
                />
              }
            >
              <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-y-2 font-mono text-xs">
                <dt className="label-caps text-muted-foreground">Published version</dt>
                <dd>{configuration?.publishedVersion ?? "—"}</dd>
                <dt className="label-caps text-muted-foreground">Published hash</dt>
                <dd className="truncate">{configuration?.publishedConfigHash ?? "—"}</dd>
                <dt className="label-caps text-muted-foreground">Runtime version</dt>
                <dd>{configuration?.runtimeVersion ?? "—"}</dd>
                <dt className="label-caps text-muted-foreground">Runtime hash</dt>
                <dd className="truncate">{configuration?.runtimeConfigHash ?? "—"}</dd>
                <dt className="label-caps text-muted-foreground">Drift</dt>
                <dd>{configuration?.drift ? "DRIFTED" : configuration ? "NONE" : "—"}</dd>
              </dl>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                {diagnostics.configuration.detail}
              </p>
            </Panel>
          </div>

          <Panel
            title="Startup Chain"
            actions={
              <StatusPill
                tone={
                  diagnostics.startupComplete
                    ? "healthy"
                    : diagnostics.startup.some((step) => step.status === "FAILED")
                      ? "unavailable"
                      : "degraded"
                }
                label={`${diagnostics.startup.filter((step) => step.status === "PASS").length}/${diagnostics.startup.length}`}
              />
            }
          >
            <ol className="divide-y divide-border font-mono text-xs">
              {diagnostics.startup.map((step, index) => (
                <li key={step.step} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="truncate">{step.label}</span>
                  </span>
                  <span className={STARTUP_TONE[step.status]}>{step.status}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Open Incidents">
            {diagnostics.incidents.length === 0 ? (
              <EmptyState
                message="No open incidents."
                hint="Every observation the control plane can make is healthy. This does not assert that trading is safe — the VPS owns that."
              />
            ) : (
              <div>
                {diagnostics.incidents.map((incident) => (
                  <IncidentCard key={incident.id} incident={incident} />
                ))}
              </div>
            )}
          </Panel>

          {evidence.data?.notes.length ? (
            <Panel title="Collection Notes">
              <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                {evidence.data.notes.map((note) => (
                  <li key={note}>— {note}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      )}
    </OperatorShell>
  );
}
