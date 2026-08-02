/**
 * ARC — trading authority registry panel (M7.5).
 *
 * Read-only view of the VPS trading authorities that have registered with this
 * control plane. Registration itself is engine-initiated; the console never
 * fabricates an authority and never stores credential material.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { EmptyState, LoadingState, Panel } from "@/components/arc/primitives";
import { fmtTime } from "@/lib/format";
import { listRegisteredAuthorities } from "@/lib/authority.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AuthorityRegistryPanel() {
  const fetchAuthorities = useServerFn(listRegisteredAuthorities);
  const { data, isPending, error } = useQuery({
    queryKey: ["arc", "authority-registry"],
    queryFn: () => fetchAuthorities(),
    refetchInterval: 30_000,
  });

  return (
    <Panel title="Trading Authority Registry" className="overflow-x-auto">
      {error ? (
        <p className="font-mono text-sm text-destructive">{(error as Error).message}</p>
      ) : isPending ? (
        <LoadingState label="Reading authority registry" />
      ) : (data ?? []).length === 0 ? (
        <EmptyState
          message="No trading authority registered."
          hint="The VPS engine registers itself through POST /authority/register and keeps its record live with POST /authority/heartbeat. The control plane stores public identity only."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Authority</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Last Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((authority) => (
              <TableRow key={authority.authorityId}>
                <TableCell className="font-mono text-xs">
                  {authority.name}
                  <span className="block text-muted-foreground">{authority.authorityId}</span>
                </TableCell>
                <TableCell className="font-mono text-xs uppercase">
                  {authority.environment}
                </TableCell>
                <TableCell
                  className={
                    authority.status === "active"
                      ? "font-mono text-xs uppercase text-primary"
                      : authority.status === "revoked"
                        ? "font-mono text-xs uppercase text-destructive"
                        : "font-mono text-xs uppercase text-muted-foreground"
                  }
                >
                  {authority.status}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {authority.engineVersion ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {fmtTime(authority.registeredAt)}
                </TableCell>
                <TableCell className="font-mono text-xs">{fmtTime(authority.lastSeen)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Public identity only: no wallet keys, exchange credentials or execution secrets are ever
        stored in the control plane.
      </p>
    </Panel>
  );
}
