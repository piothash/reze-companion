import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  actions,
  className,
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="label-caps truncate">{title}</h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="label-caps">{label}</p>
      <p className="mt-1 font-mono text-xl leading-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export type StatusTone = "healthy" | "degraded" | "unavailable" | "neutral";

const TONE_CLASS: Record<StatusTone, string> = {
  healthy: "bg-primary",
  degraded: "bg-warn",
  unavailable: "bg-destructive",
  neutral: "bg-muted-foreground",
};

export function StatusDot({ tone }: { tone: StatusTone }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", TONE_CLASS[tone])}
    />
  );
}

export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-0.5 font-mono text-xs">
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const value = severity.toUpperCase();
  const variant =
    value === "CRITICAL" || value === "ERROR"
      ? "destructive"
      : value === "WARNING" || value === "WARN"
        ? "outline"
        : "secondary";
  return (
    <Badge variant={variant} className="font-mono text-[0.65rem]">
      {value}
    </Badge>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{message}</p>;
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
          <dt className="label-caps truncate">{key}</dt>
          <dd className="font-mono text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Live countdown to an ISO deadline. Display-only: no scheduling authority
 * lives in the companion (ADR-0001).
 */
export function Countdown({ toIso, prefix }: { toIso: string | null; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (!toIso) return <span className="font-mono">—</span>;
  const target = new Date(toIso.endsWith("Z") ? toIso : `${toIso}Z`).getTime();
  if (Number.isNaN(target)) return <span className="font-mono">—</span>;

  const remaining = target - now;
  const expired = remaining <= 0;
  const total = Math.floor(Math.abs(remaining) / 1000);
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");

  return (
    <span className={cn("font-mono", expired && "text-muted-foreground")}>
      {prefix ? `${prefix} ` : ""}
      {expired ? "-" : ""}
      {hours}:{minutes}:{seconds}
    </span>
  );
}
