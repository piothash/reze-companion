import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { OperatorShell } from "@/components/arc/operator-shell";
import { EmptyState, Panel, SeverityBadge, fmtTime } from "@/components/arc/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { acknowledgeNotification, listOperatorNotifications } from "@/lib/operations.functions";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — ARC Operator Platform" },
      {
        name: "description",
        content:
          "ARC operator notifications with info, warning and critical severities, search, filtering and acknowledgement.",
      },
      { property: "og:title", content: "Notifications — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Severity-filtered operator alerts with acknowledgement.",
      },
    ],
  }),
  component: NotificationsPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  read_at: string | null;
  created_at: string;
}

function NotificationsPage() {
  const queryClient = useQueryClient();
  const fetchNotifications = useServerFn(listOperatorNotifications);
  const acknowledge = useServerFn(acknowledgeNotification);
  const [severity, setSeverity] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isPending } = useQuery({
    queryKey: ["arc", "notifications"],
    queryFn: () => fetchNotifications({ data: { limit: 100 } }),
    refetchInterval: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (id: string) => acknowledge({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["arc", "notifications"] }),
  });

  const rows = ((data?.notifications ?? []) as unknown as NotificationRow[])
    .filter((row) => severity === "all" || row.severity.toLowerCase() === severity)
    .filter((row) =>
      search.trim() === ""
        ? true
        : `${row.title} ${row.body ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
    );

  return (
    <OperatorShell
      title="Notifications"
      subtitle="Operator alerts derived from canonical reason codes"
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,24rem)_10rem]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search notifications…"
            aria-label="Search notifications"
          />
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger aria-label="Filter by severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Panel title="Inbox">
          {isPending ? (
            <EmptyState message="Loading notifications…" />
          ) : rows.length === 0 ? (
            <EmptyState message="No notifications match the current filter." />
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border/60 pb-3"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <SeverityBadge severity={row.severity} />
                      <p className="truncate text-sm font-medium">{row.title}</p>
                    </div>
                    {row.body ? (
                      <p className="mt-1 text-xs text-muted-foreground">{row.body}</p>
                    ) : null}
                    <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">
                      {fmtTime(row.created_at)}
                    </p>
                  </div>
                  {row.read_at ? (
                    <span className="font-mono text-xs text-muted-foreground">acknowledged</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate(row.id)}
                    >
                      Acknowledge
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </OperatorShell>
  );
}
