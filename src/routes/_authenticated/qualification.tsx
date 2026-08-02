import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import { StartupEvidencePanel } from "@/components/arc/startup-evidence-panel";
import { MainnetReadinessPanel } from "@/components/arc/mainnet-readiness-panel";
import {
  LoadingState,
  Metric,
  Panel,
  StatusPill,
  type StatusTone,
} from "@/components/arc/primitives";
import { getRuntimeTelemetry } from "@/lib/engine.functions";
import { getConfigurationRuntimeView } from "@/lib/configuration.functions";
import { getLiveQualificationEvidence } from "@/lib/qualification.functions";
import { replayEvents } from "@/core/platform/replay";
import {
  QUALIFICATION_SPEC,
  evaluateQualificationGates,
  qualificationVerdict,
  activationComplete,
  evaluateMainnetReadiness,
  buildActivationChecklist,
  evaluateLiveAuthorityGates,
  liveQualificationVerdict,
  runQualificationScenario,
  type ActivationStatus,
  type GateStatus,
} from "@/core/qualification";

const ACTIVATION_TONE: Record<ActivationStatus, StatusTone> = {
  DONE: "healthy",
  READY: "degraded",
  WAITING: "neutral",
  BLOCKED: "unavailable",
};

export const Route = createFileRoute("/_authenticated/qualification")({
  head: () => ({
    meta: [
      { title: "Testnet Qualification — ARC Operator Platform" },
      {
        name: "description",
        content:
          "M7.7 qualification gates: deterministic lifecycle, multi-window ordering, replay, recovery, configuration dispatch and authority telemetry evidence.",
      },
      { property: "og:title", content: "Testnet Qualification — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Production gate checklist for the ARC testnet qualification run.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QualificationPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

const STATUS_TONE: Record<GateStatus, StatusTone> = {
  PASS: "healthy",
  PENDING: "degraded",
  FAIL: "unavailable",
};

function QualificationPage() {
  const fetchTelemetry = useServerFn(getRuntimeTelemetry);
  const fetchConfiguration = useServerFn(getConfigurationRuntimeView);
  const fetchEvidence = useServerFn(getLiveQualificationEvidence);

  const scenario = useQuery({
    queryKey: ["arc", "qualification", "scenario"],
    queryFn: async () => {
      const run = await runQualificationScenario(QUALIFICATION_SPEC);
      const replay = replayEvents([...run.events]);
      return { run, replay };
    },
    staleTime: Infinity,
  });

  const telemetry = useQuery({
    queryKey: ["arc", "runtime-telemetry"],
    queryFn: () => fetchTelemetry(),
    refetchInterval: 15_000,
  });

  const evidence = useQuery({
    queryKey: ["arc", "qualification", "live-evidence"],
    queryFn: () => fetchEvidence(),
    refetchInterval: 20_000,
  });

  const configuration = useQuery({
    queryKey: ["arc", "configuration-runtime"],
    queryFn: () => fetchConfiguration(),
    refetchInterval: 30_000,
  });

  if (scenario.isPending || !scenario.data) {
    return (
      <OperatorShell title="Testnet Qualification" subtitle="M7.7–M7.9 — validation only">
        <LoadingState label="Running deterministic qualification scenario" />
      </OperatorShell>
    );
  }

  const { run, replay } = scenario.data;
  const live = telemetry.data;
  const config = configuration.data;

  // Live gates stay PENDING until the VPS authority actually reports; absence of
  // evidence is never treated as a failure.
  const liveEvidence = live?.source === "LIVE" ? true : undefined;
  const authorityRegistered = config?.authority.registered ? true : undefined;
  const configurationActive =
    config?.runtime?.runtimeStatus === "LIVE" ? true : authorityRegistered ? false : undefined;

  const results = evaluateQualificationGates(run, {
    ...(liveEvidence === undefined
      ? {}
      : { environmentValidated: liveEvidence, telemetryCurrent: liveEvidence }),
    ...(authorityRegistered === undefined ? {} : { authorityRegistered }),
    ...(configurationActive === undefined ? {} : { configurationActive }),
    replayDeterministic: replay.deterministic && replay.mismatches.length === 0,
  });

  const liveResults = evidence.data ? evaluateLiveAuthorityGates(evidence.data.snapshot) : [];
  const liveVerdict = evidence.data ? liveQualificationVerdict(liveResults) : "PENDING";
  const activation = evidence.data ? buildActivationChecklist(evidence.data.snapshot) : [];
  const activationDone = activationComplete(activation);
  const mainnet = evaluateMainnetReadiness({
    harness: results,
    live: liveResults,
    activation,
    operations: evidence.data?.operations ?? null,
  });
  const harnessVerdict = qualificationVerdict(results);
  const verdict: GateStatus =
    harnessVerdict === "FAIL" || liveVerdict === "FAIL"
      ? "FAIL"
      : harnessVerdict === "PENDING" || liveVerdict === "PENDING"
        ? "PENDING"
        : "PASS";
  const accepted = run.intents.filter((intent) => intent.submitted === "ACCEPTED");

  return (
    <OperatorShell
      title="Testnet Qualification"
      subtitle="M7.7–M7.9 — validation only; the VPS remains the sole trading authority"
      actions={<StatusPill tone={STATUS_TONE[verdict]} label={`GATE ${verdict}`} />}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Canonical Events" value={run.events.length} hint={`${run.ticks} ticks`} />
          <Metric
            label="Execution Intents"
            value={`${accepted.length}/${run.intents.length}`}
            hint="accepted / produced"
          />
          <Metric
            label="Settlements"
            value={run.settlements.length}
            hint={`notional ${run.settledNotional.toFixed(2)}`}
          />
          <Metric
            label="Replay Digest"
            value={<span className="text-sm">{replay.digest.slice(0, 12)}</span>}
            hint={`${replay.mismatches.length} mismatch(es)`}
          />
        </div>

        <MainnetReadinessPanel results={mainnet} loading={evidence.isPending} />

        <Panel
          title="Activation Checklist — M7.9"
          actions={
            <StatusPill
              tone={activationDone ? "healthy" : "degraded"}
              label={
                activation.length === 0
                  ? "PENDING"
                  : `${activation.filter((step) => step.status === "DONE").length}/${activation.length} DONE`
              }
            />
          }
        >
          {evidence.isPending ? (
            <LoadingState label="Resolving activation state" />
          ) : (
            <div className="divide-y divide-border">
              {activation.map((step) => (
                <div
                  key={step.id}
                  className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[6rem_minmax(0,1fr)_7rem] sm:items-start"
                >
                  <p className="label-caps">{step.owner}</p>
                  <div>
                    <p className="text-sm">{step.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.action}</p>
                    {step.status === "DONE" ? (
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{step.detail}</p>
                    ) : (
                      <dl className="mt-2 grid gap-x-3 gap-y-1 font-mono text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
                        <dt className="label-caps">Reason</dt>
                        <dd className="text-muted-foreground">{step.reason}</dd>
                        <dt className="label-caps">Missing</dt>
                        <dd className="text-muted-foreground">{step.evidence}</dd>
                        <dt className="label-caps">Required</dt>
                        <dd className="text-foreground">{step.required}</dd>
                        <dt className="label-caps">Then</dt>
                        <dd className="text-muted-foreground">{step.transition}</dd>
                      </dl>
                    )}
                  </div>
                  <div className="sm:justify-self-end">
                    <StatusPill tone={ACTIVATION_TONE[step.status]} label={step.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <StartupEvidencePanel
          startup={evidence.data?.snapshot.startup ?? null}
          loading={evidence.isPending}
        />

        <Panel
          title="Live Authority Gates — M7.8"
          actions={<StatusPill tone={STATUS_TONE[liveVerdict]} label={liveVerdict} />}
        >
          {evidence.isPending ? (
            <LoadingState label="Collecting live authority evidence" />
          ) : (
            <div className="divide-y divide-border">
              {liveResults.map((gate) => (
                <div
                  key={gate.id}
                  className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)_7rem] sm:items-start"
                >
                  <p className="label-caps">{gate.category}</p>
                  <div>
                    <p className="text-sm">{gate.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{gate.requirement}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{gate.detail}</p>
                  </div>
                  <div className="sm:justify-self-end">
                    <StatusPill tone={STATUS_TONE[gate.status]} label={gate.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Deterministic Gate Checklist">
          <div className="divide-y divide-border">
            {results.map((gate) => (
              <div
                key={gate.id}
                className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)_7rem] sm:items-start"
              >
                <p className="label-caps">{gate.category}</p>
                <div>
                  <p className="text-sm">{gate.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{gate.requirement}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{gate.detail}</p>
                </div>
                <div className="sm:justify-self-end">
                  <StatusPill tone={STATUS_TONE[gate.status]} label={gate.status} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Window Activation Order">
          <ol className="space-y-1 font-mono text-xs">
            {run.windowOffsets.map((offset, index) => (
              <li key={offset} className="flex items-center justify-between">
                <span>
                  #{index + 1} · T-{offset / 1000}s
                </span>
                <span className="text-muted-foreground">{run.windowOrder[index] ?? "—"}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Execution Intents">
          {run.intents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No intent was produced by this scenario.
            </p>
          ) : (
            <table className="w-full font-mono text-xs">
              <thead className="label-caps text-left">
                <tr>
                  <th className="pb-2">Intent</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Size</th>
                  <th className="pb-2">Risk</th>
                  <th className="pb-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {run.intents.map((intent) => (
                  <tr key={intent.executionIntentId} className="border-t border-border">
                    <td className="py-1.5">{intent.executionIntentId.slice(0, 18)}</td>
                    <td>{intent.side}</td>
                    <td>{intent.positionSize}</td>
                    <td>{intent.deniedBy ?? intent.riskDecision ?? "—"}</td>
                    <td>{intent.submitted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </OperatorShell>
  );
}
