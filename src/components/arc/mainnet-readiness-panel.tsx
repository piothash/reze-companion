/**
 * ARC — M8.0 mainnet readiness panel.
 *
 * Read-only. Renders the eight production domains and the single verdict.
 * There is no approve button and no override: a domain turns PASS only when
 * the underlying qualification layers produced the evidence for it.
 */
import {
  mainnetBlockers,
  mainnetVerdict,
  type DomainStatus,
  type MainnetDomainResult,
} from "@/core/qualification";
import { Panel, StatusPill, type StatusTone } from "@/components/arc/primitives";

const DOMAIN_TONE: Record<DomainStatus, StatusTone> = {
  PASS: "healthy",
  PENDING: "degraded",
  FAIL: "unavailable",
};

export function MainnetReadinessPanel({
  results,
  loading,
}: {
  results: readonly MainnetDomainResult[];
  loading?: boolean;
}) {
  const verdict = mainnetVerdict(results);
  const qualified = verdict === "QUALIFIED FOR MAINNET";
  const passed = results.filter((result) => result.status === "PASS").length;
  const blockers = mainnetBlockers(results);

  return (
    <Panel
      title="Mainnet Readiness Gate — M8.0"
      actions={
        <StatusPill
          tone={qualified ? "healthy" : "degraded"}
          label={
            results.length === 0
              ? loading
                ? "EVALUATING"
                : "NO EVIDENCE"
              : `${passed}/${results.length} PASS`
          }
        />
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
          <p className="font-mono text-sm tracking-wide">{verdict}</p>
          <p className="text-xs text-muted-foreground">
            Derived from observed evidence only — no manual approval is possible.
          </p>
        </div>

        <div className="divide-y divide-border">
          {results.map((result) => (
            <div
              key={result.domain}
              className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)_5.5rem] sm:items-start"
            >
              <p className="label-caps">{result.domain}</p>
              <div className="min-w-0">
                <p className="text-sm">{result.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{result.requirement}</p>
                {result.status === "PASS"
                  ? result.evidence.map((line) => (
                      <p key={line} className="mt-1 font-mono text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))
                  : result.blockers.map((line) => (
                      <p key={line} className="mt-1 font-mono text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
              </div>
              <div className="sm:justify-self-end">
                <StatusPill tone={DOMAIN_TONE[result.status]} label={result.status} />
              </div>
            </div>
          ))}
        </div>

        {!qualified && blockers.length > 0 ? (
          <p className="border-t border-border pt-3 font-mono text-xs text-muted-foreground">
            {blockers.length} open item(s) across{" "}
            {new Set(blockers.map((entry) => entry.domain)).size} domain(s). Mainnet stays closed
            until every domain reports PASS.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
