import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { OperatorShell } from "@/components/arc/operator-shell";
import { LoadingState, Panel, StatusPill } from "@/components/arc/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtTime } from "@/lib/format";
import {
  finalizeOperatorOwnership,
  getOwnershipState,
  transferOperatorOwnership,
} from "@/lib/ownership.functions";

export const Route = createFileRoute("/_authenticated/ownership")({
  head: () => ({
    meta: [
      { title: "Operator Ownership — ARC Operator Platform" },
      {
        name: "description",
        content:
          "Bootstrap and migrate the single ARC production operator: transfer ownership, revoke previous sessions and finalize ownership.",
      },
      { property: "og:title", content: "Operator Ownership — ARC Operator Platform" },
      {
        property: "og:description",
        content: "Explicit ownership bootstrap and migration for the ARC control plane.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OwnershipPage,
  errorComponent: ({ error }) => (
    <div className="p-10 font-mono text-sm text-destructive">{error.message}</div>
  ),
});

function OwnershipPage() {
  const queryClient = useQueryClient();
  const readState = useServerFn(getOwnershipState);
  const transfer = useServerFn(transferOperatorOwnership);
  const finalize = useServerFn(finalizeOperatorOwnership);
  const [email, setEmail] = useState("");
  const [confirmFinalize, setConfirmFinalize] = useState("");

  const state = useQuery({ queryKey: ["ownership"], queryFn: () => readState({}) });

  const transferMutation = useMutation({
    mutationFn: (target: string) => transfer({ data: { email: target } }),
    onSuccess: (result) => {
      toast.success(
        result.sessionsRevoked
          ? "Ownership transferred. Previous operator sessions revoked."
          : "Ownership transferred.",
      );
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["ownership"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => finalize({}),
    onSuccess: () => {
      toast.success("Ownership finalized. Public registration is permanently closed.");
      setConfirmFinalize("");
      void queryClient.invalidateQueries({ queryKey: ["ownership"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = state.data;

  return (
    <OperatorShell
      title="Operator ownership"
      subtitle="Single-operator bootstrap, migration and finalization. Ownership is resolved dynamically — no email is ever compiled into the application."
    >
      {state.isLoading || !data ? (
        <LoadingState label="Reading ownership record" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Current ownership">
            <dl className="grid gap-3 text-sm">
              <Row label="Owner">
                <span className="font-mono">{data.ownerEmail ?? "— none configured —"}</span>
              </Row>
              <Row label="Owner id">
                <span className="font-mono text-xs text-muted-foreground">
                  {data.ownerUserId ?? "—"}
                </span>
              </Row>
              <Row label="State">
                <StatusPill
                  tone={data.finalized ? "healthy" : "degraded"}
                  label={data.finalized ? "FINALIZED" : "BOOTSTRAP"}
                />
              </Row>
              <Row label="Finalized at">
                <span className="font-mono text-xs">
                  {data.finalizedAtIso ? fmtTime(data.finalizedAtIso) : "—"}
                </span>
              </Row>
              <Row label="Registration">
                <StatusPill
                  tone={data.finalized ? "neutral" : "degraded"}
                  label={data.finalized ? "CLOSED" : "OPEN (BOOTSTRAP)"}
                />
              </Row>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              While ownership is unfinalized, the account that registered first is provisional only.
              The intended production operator is selected explicitly here — and the previous owner
              is demoted, its sessions revoked and the change written to the audit trail.
            </p>
          </Panel>

          <Panel title="Ownership migration">
            {data.migrationAvailable ? (
              <div className="grid gap-4">
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    transferMutation.mutate(email);
                  }}
                >
                  <Label htmlFor="owner-email">Transfer ownership to</Label>
                  <Input
                    id="owner-email"
                    type="email"
                    required
                    placeholder="registered operator email"
                    className="font-mono"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The target account must already be registered. Requires the current owner, or
                    any signed-in account while no owner exists.
                  </p>
                  <Button type="submit" disabled={transferMutation.isPending}>
                    {transferMutation.isPending ? "Transferring…" : "Transfer ownership"}
                  </Button>
                </form>

                <div className="grid gap-2 border-t border-border pt-4">
                  <Label htmlFor="finalize">Finalize ownership</Label>
                  <p className="text-xs text-muted-foreground">
                    Irreversible. Locks ownership to the current owner, disables this migration tool
                    and permanently closes public registration. Type <code>FINALIZE</code> to
                    confirm.
                  </p>
                  <Input
                    id="finalize"
                    className="font-mono"
                    value={confirmFinalize}
                    onChange={(event) => setConfirmFinalize(event.target.value)}
                  />
                  <Button
                    variant="destructive"
                    disabled={
                      confirmFinalize !== "FINALIZE" ||
                      !data.isCallerOwner ||
                      finalizeMutation.isPending
                    }
                    onClick={() => finalizeMutation.mutate()}
                  >
                    Finalize ownership
                  </Button>
                  {!data.isCallerOwner ? (
                    <p className="text-xs text-destructive">
                      Only the current owner may finalize ownership.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ownership is finalized. The migration tool is disabled and public registration is
                closed. Ownership changes now require a deliberate, audited backend operation.
              </p>
            )}
          </Panel>
        </div>
      )}
    </OperatorShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
