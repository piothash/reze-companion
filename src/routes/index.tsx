import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ARC Companion — Control Plane for the ARC Engine" },
      {
        name: "description",
        content:
          "Session 0 status for the ARC companion: hybrid control plane, frozen architecture, read-only reference and Lovable Cloud foundation.",
      },
      { property: "og:title", content: "ARC Companion — Control Plane for the ARC Engine" },
      {
        property: "og:description",
        content:
          "Hybrid control plane for the ARC autonomous BTC maker engine. The VPS remains the sole trading authority.",
      },
    ],
  }),
  component: Index,
});

const readiness: Array<[string, string, "ok" | "pending"]> = [
  ["Repository understood", "Source archive ingested and mapped", "ok"],
  ["Reference ingested", "docs/knowledge + docs/reference/p4, no live data", "ok"],
  ["Architecture understood", "Tick loop, SLO manager, executor contract, ledger", "ok"],
  ["Lovable Cloud", "Foundational schema + RLS applied", "ok"],
  ["Environment audited", "No secrets committed; engine keys documented", "ok"],
  ["GitHub connection", "No GitHub remote visible — connect via + menu", "pending"],
];

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-mono text-sm font-bold tracking-[0.3em]">ARC</span>
          <Link
            to="/auth"
            className="rounded-md border border-border px-3 py-1.5 font-mono text-xs hover:bg-accent"
          >
            Operator sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="grid-backdrop border-b border-border">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <p className="label-caps">Session 0 · Initialization</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight">
              The companion is the control plane. The VPS remains the sole trading authority.
            </h1>
            <p className="mt-5 max-w-2xl text-muted-foreground">
              No trading decisions, market state generation, TWAP calculation, risk evaluation or
              order execution will ever be implemented inside this application. It observes,
              configures and reports — nothing else.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="label-caps">Readiness</h2>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
            {readiness.map(([name, detail, state]) => (
              <li key={name} className="flex items-center gap-4 px-4 py-3">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    state === "ok" ? "bg-primary" : "bg-warn"
                  }`}
                />
                <span className="w-56 shrink-0 font-mono text-xs">{name}</span>
                <span className="text-sm text-muted-foreground">{detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-20 md:grid-cols-3">
          {[
            ["Frozen architecture", "Changes require an ADR in docs/architecture."],
            ["Read-only reference", "docs/reference/p4 is never modified, imported or bundled."],
            ["No live data", "Databases, WAL files and credentials never enter this repository."],
          ].map(([title, body]) => (
            <article key={title} className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-mono text-xs uppercase tracking-widest">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
