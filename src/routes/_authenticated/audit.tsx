import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, Panel, fmtTime } from "@/components/arc/primitives";
import { Input } from "@/components/ui/input";
import { listAuditRecords } from "@/lib/operations.functions";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Searchable ARC audit timeline: configuration changes, profile changes, authentication, replay runs and platform actions.",
      },
      { property: "og:title", content: "Audit — ARC Operator Platform" },
      { property: "og:description", content: "Immutable, searchable operator action trail." },
    ],
  }),
  component: AuditPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

interface AuditRow {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: unknown;
  created_at: string;
}

function AuditPage() {
  const fetchAudit = useServerFn(listAuditRecords);
  const [search, setSearch] = useState("");
  const { data, isPending } = useQuery({ queryKey: ["arc", "audit"], queryFn: () => fetchAudit() });

  const records = ((data?.records ?? []) as unknown as AuditRow[]).filter((record) =>
    search.trim() === ""
      ? true
      : `${record.action} ${record.entity ?? ""} ${record.entity_id ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
  );

  return (
    <OperatorShell title="Audit" subtitle="Immutable platform action trail">
      <div className="space-y-4">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search actions, entities, ids…"
          aria-label="Search audit records"
          className="max-w-md"
        />
        <Panel title="Timeline">
          {isPending ? (
            <EmptyState message="Loading audit trail…" />
          ) : records.length === 0 ? (
            <EmptyState message="No audit records match." />
          ) : (
            <ol className="space-y-2">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border/60 pb-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{record.action}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {record.entity ?? "platform"}
                      {record.entity_id ? ` · ${record.entity_id}` : ""}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {fmtTime(record.created_at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </OperatorShell>
  );
}
