/**
 * ARC — authority runtime surfaces (M6.8).
 *
 * Presentation for the runtime handshake: connection state, engine identity,
 * saved-vs-running verification and subsystem health. Every value is sourced
 * from the VPS handshake; nothing is invented and no placeholder is rendered —
 * unreported fields read "—" and mirrored values are labelled as such.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  EmptyState,
  LoadingState,
  Panel,
  StatusDot,
  StatusPill,
  type StatusTone,
} from "./primitives";
import { fmtTime } from "@/lib/format";
import { getAuthorityRuntime } from "@/lib/engine.functions";
import {
  formatUptime,
  type DashboardRuntimeState,
  type HealthEntry,
} from "@/core/platform/authority-handshake";

export type AuthorityRuntime = Awaited<ReturnType<typeof getAuthorityRuntime>>;

const STATE_TONE: Record<DashboardRuntimeState, StatusTone> = {
  UNREGISTERED: "neutral",
  CONNECTING: "neutral",
  CONNECTED: "healthy",
  DISCONNECTED: "unavailable",
  UNAUTHORIZED: "unavailable",
  CONFIGURATION_PENDING: "degraded",
  CONFIGURATION_APPLYING: "degraded",
  CONFIGURATION_ACTIVE: "healthy",
  CONFIGURATION_REJECTED: "unavailable",
};

export function runtimeTone(state: string | undefined): StatusTone {
  return STATE_TONE[(state ?? "UNREGISTERED") as DashboardRuntimeState] ?? "neutral";
}

/**
 * Continuous runtime synchronization. Polls at the interval registered for the
 * engine, refetches on focus and reconnect, so a PM2 restart, VPS reboot or
 * network interruption re-handshakes automatically with no manual refresh.
 */
export function useAuthorityRuntime() {
  const fetchRuntime = useServerFn(getAuthorityRuntime);
  return useQuery({
    queryKey: ["arc", "authority-runtime"],
    queryFn: () => fetchRuntime(),
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      (query.state.data as AuthorityRuntime | undefined)?.syncIntervalMillis ?? 5_000,
  });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border/50 py-1 last:border-b-0">
      <dt className="label-caps truncate">{label}</dt>
      <dd className="truncate font-mono text-xs">{value}</dd>
    </div>
  );
}

function hash(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function text(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

/** Live connection pill usable in any header. */
export function ConnectionPill({ runtime }: { runtime: AuthorityRuntime | undefined }) {
  if (!runtime) return <StatusPill tone="neutral" label="CONNECTING" />;
  return (
    <StatusPill tone={runtimeTone(runtime.connection.state)} label={runtime.connection.state} />
  );
}

/** The expanded Runtime Configuration panel required by M6.8. */
export function AuthorityRuntimePanel({
  runtime,
  isPending,
  error,
}: {
  runtime: AuthorityRuntime | undefined;
  isPending: boolean;
  error: Error | null;
}) {
  if (error) {
    return (
      <Panel title="Active Runtime Configuration">
        <p className="font-mono text-sm text-destructive">{error.message}</p>
      </Panel>
    );
  }
  if (isPending || !runtime) {
    return (
      <Panel title="Active Runtime Configuration">
        <LoadingState label="Performing runtime handshake" />
      </Panel>
    );
  }

  if (!runtime.endpoint.registered) {
    return (
      <Panel title="Active Runtime Configuration" actions={<ConnectionPill runtime={runtime} />}>
        <EmptyState
          message="No trading engine registered."
          hint="Register the VPS trading engine to establish the runtime handshake. Configuration versions stay PENDING until an authority accepts them."
        />
      </Panel>
    );
  }

  const { connection, identity, runtimeConfiguration, savedConfiguration, verification } = runtime;

  return (
    <Panel
      title="Active Runtime Configuration"
      actions={
        <div className="flex items-center gap-2">
          <StatusPill
            tone={
              verification.state === "MATCH"
                ? "healthy"
                : verification.state === "DRIFT"
                  ? "degraded"
                  : "neutral"
            }
            label={verification.state === "DRIFT" ? "DRIFT DETECTED" : verification.state}
          />
          <ConnectionPill runtime={runtime} />
        </div>
      }
    >
      <dl className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
        <Row
          label="Engine connected"
          value={
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={connection.connected ? "healthy" : "unavailable"} />
              {connection.connected ? "YES" : "NO"}
            </span>
          }
        />
        <Row label="Engine ID" value={text(identity?.engineId)} />
        <Row label="Public identifier" value={text(identity?.publicIdentifier)} />
        <Row label="Current snapshot" value={hash(runtimeConfiguration?.snapshotId)} />
        <Row label="Snapshot hash" value={hash(runtimeConfiguration?.snapshotHash)} />
        <Row
          label="Running version"
          value={runtimeConfiguration?.version ? `v${runtimeConfiguration.version}` : "—"}
        />
        <Row label="Configuration hash" value={hash(runtimeConfiguration?.configHash)} />
        <Row
          label="Saved version"
          value={savedConfiguration ? `v${savedConfiguration.version}` : "—"}
        />
        <Row label="Saved hash" value={hash(savedConfiguration?.configHash)} />
        <Row label="Running since" value={fmtTime(identity?.startedAtIso)} />
        <Row label="Runtime uptime" value={formatUptime(identity?.uptimeSeconds ?? null)} />
        <Row label="Last synchronized" value={fmtTime(runtime.lastSynchronizedIso)} />
        <Row label="Engine version" value={text(identity?.engineVersion)} />
        <Row label="Platform version" value={text(identity?.platformVersion)} />
        <Row
          label="API version"
          value={text(identity?.apiVersion ?? runtime.endpoint.apiVersion)}
        />
        <Row
          label="Environment"
          value={text(identity?.environment ?? runtime.endpoint.environment)}
        />
        <Row label="Network" value={text(identity?.network)} />
        <Row label="Feed provider" value={text(runtime.feed?.provider)} />
        <Row label="TWAP feed" value={text(runtime.feed?.twapFeed)} />
        <Row label="Feed status" value={text(runtime.feed?.status)} />
        <Row label="Scheduler" value={text(runtime.scheduler?.status)} />
        <Row label="Authority host" value={text(runtime.endpoint.host)} />
        <Row
          label="Latency"
          value={connection.latencyMillis === null ? "—" : `${connection.latencyMillis} ms`}
        />
        <Row
          label="Capabilities"
          value={identity?.capabilities?.length ? identity.capabilities.join(", ") : "—"}
        />
      </dl>

      <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <p>
          {connection.reasonCode} — {connection.detail}
          {connection.live
            ? ""
            : " · Values mirrored from the last successful handshake, not a live read."}
        </p>
        {verification.state === "DRIFT" ? (
          <ul className="mt-2 space-y-1">
            {verification.reasons.map((reason) => (
              <li key={reason.field} className="font-mono text-xs text-warn">
                {reason.field}: saved {reason.saved} · running {reason.running} — {reason.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}

const HEALTH_TONE: Record<string, StatusTone> = {
  healthy: "healthy",
  degraded: "degraded",
  unavailable: "unavailable",
  unknown: "neutral",
};

/** The full engine subsystem grid, sourced from the handshake. */
export function SubsystemHealthGrid({
  entries,
  live,
}: {
  entries: readonly HealthEntry[];
  live: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => (
        <Panel key={entry.component} title={entry.component}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <p className="truncate text-sm text-muted-foreground">
              {entry.detail ?? (live ? "Reported by the trading authority." : "Mirrored value.")}
            </p>
            <StatusPill
              tone={HEALTH_TONE[entry.status] ?? "neutral"}
              label={entry.status.toUpperCase()}
            />
          </div>
          {entry.latencyMillis !== null ? (
            <p className="mt-1 font-mono text-xs text-muted-foreground">{entry.latencyMillis} ms</p>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}
