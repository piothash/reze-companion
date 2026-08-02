/**
 * ARC — trading authority registry panel (M7.5 / M7.6).
 *
 * Read-only view of the VPS trading authorities registered with this control
 * plane. Registration and heartbeats are engine-initiated; the console never
 * fabricates an authority, never asserts liveness and never stores credential
 * material.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { EmptyState, LoadingState, Panel } from "@/components/arc/primitives";
import { fmtTime } from "@/lib/format";
import { listRegisteredAuthorities } from "@/lib/authority.functions";
import { getAuthoritySigningStatus } from "@/lib/security.functions";
import {
  deriveAuthorityDisplay,
  formatHeartbeatAge,
  type AuthorityDisplayStatus,
} from "@/core/platform/authority-presentation";

const STATUS_TONE: Record<AuthorityDisplayStatus, string> = {
  ACTIVE: "text-primary",
  STALE: "text-warning",
  REVOKED: "text-destructive",
  UNREGISTERED: "text-muted-foreground",
};

const RUNTIME_TONE: Record<string, string> = {
  healthy: "text-primary",
  starting: "text-muted-foreground",
  degraded: "text-warning",
  halted: "text-destructive",
  unknown: "text-muted-foreground",
};

function ago(iso: string | null, nowMillis: number): string {
  if (!iso) return "never";
  const delta = Math.max(0, Math.round((nowMillis - Date.parse(iso)) / 1000));
  if (delta < 60) return `${delta} second${delta === 1 ? "" : "s"} ago`;
  if (delta < 3600) return `${Math.round(delta / 60)} min ago`;
  return `${Math.round(delta / 3600)} h ago`;
}

function uptime(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string | undefined;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`font-mono text-sm ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

export function AuthorityRegistryPanel() {
  const fetchAuthorities = useServerFn(listRegisteredAuthorities);
  const { data, isPending, error } = useQuery({
    queryKey: ["arc", "authority-registry"],
    queryFn: () => fetchAuthorities(),
    refetchInterval: 5_000,
  });
  const fetchSigning = useServerFn(getAuthoritySigningStatus);
  const signing = useQuery({
    queryKey: ["arc", "authority-signing"],
    queryFn: () => fetchSigning(),
    refetchInterval: 60_000,
  });

  const now = Date.now();
  const signatureVerified = signing.data?.securityStatus === "ENFORCED";

  return (
    <Panel title="Trading Authority Registry">
      {error ? (
        <p className="font-mono text-sm text-destructive">{(error as Error).message}</p>
      ) : isPending ? (
        <LoadingState label="Reading authority registry" />
      ) : (data ?? []).length === 0 ? (
        <EmptyState
          message="No trading authority registered — UNREGISTERED."
          hint="The VPS engine registers itself through POST /api/public/authority/register on boot and keeps its record live with POST /api/public/authority/heartbeat. Until it does, no authority is allowed to trade."
        />
      ) : (
        <div className="space-y-4">
          {(data ?? []).map((authority) => {
            const display = deriveAuthorityDisplay(
              {
                status: authority.status,
                lastSeenIso: authority.lastSeen,
                heartbeatIntervalMillis: authority.heartbeatIntervalMillis,
                runtimeIdentity: authority.runtimeIdentity,
                signatureVerified,
              },
              now,
            );
            return (
            <div
              key={authority.authorityId}
              className="rounded border border-border bg-card/40 p-4"
            >
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-mono text-sm">{authority.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {authority.authorityId}
                  </p>
                </div>
                <span
                  className={`font-mono text-xs uppercase tracking-wider ${
                    STATUS_TONE[display.status]
                  }`}
                >
                  {display.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Field label="Authority ID" value={authority.authorityId} />
                <Field label="Runtime identity" value={authority.runtimeIdentity ?? "—"} />
                <Field label="Environment" value={authority.environment.toUpperCase()} />
                <Field label="Version" value={authority.engineVersion ?? "—"} />
                <Field
                  label="Heartbeat age"
                  value={formatHeartbeatAge(display.heartbeatAgeMillis)}
                  tone={display.status === "ACTIVE" ? undefined : "text-warning"}
                />

                <Field
                  label="Latency"
                  value={
                    authority.latencyMillis === null ? "—" : `${authority.latencyMillis} ms`
                  }
                />
                <Field
                  label="Runtime"
                  value={authority.runtimeStatus.toUpperCase()}
                  tone={RUNTIME_TONE[authority.runtimeStatus]}
                />
                <Field label="Uptime" value={uptime(authority.uptimeSeconds)} />
                <Field
                  label="Active windows"
                  value={authority.activeWindows === null ? "—" : String(authority.activeWindows)}
                />
                <Field
                  label="Config version"
                  value={
                    authority.configurationVersion === null
                      ? "—"
                      : `v${authority.configurationVersion}`
                  }
                />
                <Field label="Active market" value={authority.activeMarket ?? "—"} />
                <Field
                  label="Event sequence"
                  value={authority.eventSequence === null ? "—" : String(authority.eventSequence)}
                />
                <Field label="Registered" value={fmtTime(authority.registeredAt)} />
                <Field
                  label="Registrations"
                  value={String(authority.registrationCount)}
                />
              </div>

              <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                heartbeat interval {Math.round(authority.heartbeatIntervalMillis / 1000)}s ·
                stale after {Math.round(display.heartbeatDeadlineMillis / 1000)}s
                {display.blockers.length > 0 ? ` · ${display.blockers.join("; ")}` : ""}
              </p>
            </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Public identity only: no wallet keys, exchange credentials or execution secrets are ever
        stored in the control plane. Liveness is derived from verified heartbeats — an engine
        cannot declare itself active.
      </p>
    </Panel>
  );
}
