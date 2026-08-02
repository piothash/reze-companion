/**
 * ARC — M8.1 deployment checklist.
 *
 * Read-only. Restates existing evidence as the pre-deployment questions:
 * environment wired, VPS up, trading configured, qualification passed. Nothing
 * on this page is tickable — every item closes on observed evidence only, and
 * the mainnet gate has no manual approval path.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { OperatorShell } from "@/components/arc/operator-shell";
import {
  EmptyState,
  LoadingState,
  Panel,
  StatusPill,
  type StatusTone,
} from "@/components/arc/primitives";
import { getLiveQualificationEvidence } from "@/lib/qualification.functions";
import { replayEvents } from "@/core/platform/replay";
import {
  DEPLOYMENT_SECTIONS,
  QUALIFICATION_SPEC,
  buildActivationChecklist,
  buildDeploymentChecklist,
  deploymentReady,
  evaluateLiveAuthorityGates,
  evaluateMainnetReadiness,
  evaluateQualificationGates,
  mainnetVerdict,
  runQualificationScenario,
  type ChecklistStatus,
  type DeploymentSection,
} from "@/core/qualification";

export const Route = createFileRoute("/_authenticated/deployment")({
  head: () => ({
    meta: [
      { title: "Deployment Checklist — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Read-only production deployment checklist: environment, VPS authority, trading readiness and qualification gate status, derived from observed evidence.",
      },
      { property: "og:title", content: "Deployment Checklist — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Pre-deployment readiness for the ARC control plane and VPS trading authority.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeploymentPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

const CHECK_TONE: Record<ChecklistStatus, StatusTone> = {
  PASS: "healthy",
  PENDING: "degraded",
  FAIL: "unavailable",
};

function DeploymentPage() {
  const fetchEvidence = useServerFn(getLiveQualificationEvidence);

  const scenario = useQuery({
    queryKey: ["arc", "qualification", "scenario"],
    queryFn: async () => {
      const run = await runQualificationScenario(QUALIFICATION_SPEC);
      return { run, replay: replayEvents([...run.events]) };
    },
    staleTime: Infinity,
  });

  const evidence = useQuery({
    queryKey: ["arc", "operations", "evidence"],
    queryFn: () => fetchEvidence(),
    refetchInterval: 30_000,
  });

  const snapshot = evidence.data?.snapshot ?? null;

  const harness = scenario.data
    ? evaluateQualificationGates(scenario.data.run, scenario.data.replay)
    : [];
  const live = snapshot ? evaluateLiveAuthorityGates(snapshot) : [];
  const activation = snapshot ? buildActivationChecklist(snapshot) : [];
  const mainnet = evaluateMainnetReadiness({
    harness,
    live,
    activation,
    operations: evidence.data?.operations ?? null,
  });

  const checks = buildDeploymentChecklist({
    snapshot,
    // The evidence read itself is the backend reachability proof.
    backendReachable: evidence.isSuccess,
    mainnet,
    verdict: mainnetVerdict(mainnet),
  });

  const passed = checks.filter((check) => check.status === "PASS").length;
  const ready = deploymentReady(checks);
  const loading = (scenario.isLoading || evidence.isLoading) && checks.length === 0;

  return (
    <OperatorShell
      title="Deployment Checklist"
      subtitle="Read-only — every item closes on observed evidence; nothing here can be ticked by hand"
      actions={
        <StatusPill
          tone={ready ? "healthy" : "degraded"}
          label={`${passed}/${checks.length} PASS`}
        />
      }
    >
      {loading ? (
        <LoadingState label="Collecting deployment evidence…" />
      ) : (
        <div className="space-y-4">
          <Panel
            title="Deployment Verdict"
            actions={
              <StatusPill
                tone={ready ? "healthy" : "unavailable"}
                label={ready ? "READY TO DEPLOY" : "NOT READY"}
              />
            }
          >
            <p className="font-mono text-sm">
              {ready
                ? "Every checklist item is satisfied by reported evidence."
                : `${checks.length - passed} item(s) are not satisfied. The VPS trading authority must be live before the remaining items can close.`}
            </p>
            {evidence.isError ? (
              <p className="mt-2 font-mono text-xs text-destructive">
                Evidence read failed: {(evidence.error as Error).message}
              </p>
            ) : null}
          </Panel>

          {DEPLOYMENT_SECTIONS.map((section: DeploymentSection) => {
            const sectionChecks = checks.filter((check) => check.section === section);
            if (sectionChecks.length === 0) return null;
            const sectionPassed = sectionChecks.filter(
              (check) => check.status === "PASS",
            ).length;
            return (
              <Panel
                key={section}
                title={section}
                actions={
                  <StatusPill
                    tone={sectionPassed === sectionChecks.length ? "healthy" : "degraded"}
                    label={`${sectionPassed}/${sectionChecks.length}`}
                  />
                }
              >
                <ul className="divide-y divide-border">
                  {sectionChecks.map((check) => (
                    <li
                      key={check.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm">{check.label}</p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {check.detail}
                        </p>
                      </div>
                      <StatusPill tone={CHECK_TONE[check.status]} label={check.status} />
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}

          {checks.length === 0 ? (
            <Panel title="Checklist">
              <EmptyState
                message="No checklist items could be evaluated."
                hint="The checklist populates once the control plane can read backend evidence."
              />
            </Panel>
          ) : null}
        </div>
      )}
    </OperatorShell>
  );
}
