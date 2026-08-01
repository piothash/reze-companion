import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOperatorOverview } from "@/lib/arc.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/console")({
  head: () => ({
    meta: [
      { title: "Operator Console — ARC Companion" },
      {
        name: "description",
        content:
          "Read-only operator console for the ARC engine: endpoints, mirrored snapshots and canonical event history.",
      },
      { property: "og:title", content: "Operator Console — ARC Companion" },
      {
        property: "og:description",
        content: "Endpoints, mirrored engine snapshots and canonical event history.",
      },
    ],
  }),
  component: ConsolePage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="label-caps">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ConsolePage() {
  const navigate = useNavigate();
  const fetchOverview = useServerFn(getOperatorOverview);
  const { data, isPending, error } = useQuery({
    queryKey: ["arc", "overview"],
    queryFn: () => fetchOverview(),
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-baseline gap-3">
          <Link to="/" className="font-mono text-sm font-bold tracking-[0.3em]">
            ARC
          </Link>
          <span className="label-caps">Operator Console</span>
        </div>
        <div className="flex items-center gap-3">
          {data?.displayName ? (
            <span className="font-mono text-xs text-muted-foreground">{data.displayName}</span>
          ) : null}
          <Button size="sm" variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-4 px-6 py-8">
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 font-mono text-xs text-foreground">
          Control plane only. The VPS engine remains the sole trading authority — no order, sizing
          or risk decision is ever made here.
        </div>

        {error ? <p className="font-mono text-sm text-destructive">{error.message}</p> : null}

        <Panel title="Engine endpoints">
          {isPending ? (
            <p className="font-mono text-xs text-muted-foreground">Loading…</p>
          ) : data && data.endpoints.length > 0 ? (
            <ul className="grid gap-2">
              {data.endpoints.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between rounded-md bg-secondary px-3 py-2"
                >
                  <span className="font-mono text-xs">{e.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{e.base_url}</span>
                  <Badge variant={e.is_active ? "default" : "secondary"}>{e.environment}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              No endpoint registered. The VPS base URL and control token are supplied by the
              operator; nothing is assumed or invented here.
            </p>
          )}
        </Panel>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Last mirrored snapshot">
            {data?.snapshot ? (
              <dl className="grid gap-1 font-mono text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">state</dt>
                  <dd>{data.snapshot.engine_state ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">mode</dt>
                  <dd>{data.snapshot.mode ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">captured</dt>
                  <dd>{new Date(data.snapshot.captured_at).toLocaleString()}</dd>
                </div>
              </dl>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">
                No snapshot mirrored yet. Snapshots are a cache of engine-reported state, never
                derived locally.
              </p>
            )}
          </Panel>

          <Panel title="Unread notifications">
            {data && data.notifications.length > 0 ? (
              <ul className="grid gap-2 font-mono text-xs">
                {data.notifications.map((n) => (
                  <li key={n.id} className="flex justify-between gap-3">
                    <span>{n.title}</span>
                    <span className="text-muted-foreground">{n.severity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Nothing pending.</p>
            )}
          </Panel>
        </div>

        <Panel title="Canonical event log (mirrored)">
          {data && data.events.length > 0 ? (
            <ul className="grid gap-1 font-mono text-xs">
              {data.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="text-muted-foreground">
                    {new Date(e.occurred_at).toLocaleTimeString()}
                  </span>
                  <span className="text-muted-foreground">{e.level}</span>
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              No events mirrored. Engine event ingestion is wired in a later session.
            </p>
          )}
        </Panel>
      </main>
    </div>
  );
}
