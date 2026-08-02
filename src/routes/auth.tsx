import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOperatorBootstrapState } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  // Session lives in localStorage; rendering this screen on the server produces
  // a hydration mismatch against the client's known auth state.
  ssr: false,
  loader: () => getOperatorBootstrapState(),
  head: () => ({
    meta: [
      { title: "Operator Sign In — ARC Companion" },
      {
        name: "description",
        content: "Sign in to the ARC companion control plane to view engine telemetry.",
      },
      { property: "og:title", content: "Operator Sign In — ARC Companion" },
      {
        property: "og:description",
        content: "Sign in to the ARC companion control plane to view engine telemetry.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const bootstrap = Route.useLoaderData();
  const registrationOpen = bootstrap.mode === "BOOTSTRAP_OPEN";
  const [mode, setMode] = useState<"signin" | "signup">(
    registrationOpen ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        navigate({ to: "/dashboard" });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!registrationOpen) throw new Error("Bootstrap registration is unavailable.");
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          toast.error("Account creation did not produce an active session.");
          return;
        }
        toast.success("Primary operator provisioned.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background grid-backdrop px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <Link to="/" className="font-mono text-sm font-bold tracking-[0.3em]">
          ARC
        </Link>
        <h1 className="mt-4 text-lg font-semibold">Operator access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Single-operator control plane. Trading authority stays on the VPS.
        </p>

        <form onSubmit={submit} className="mt-6 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="font-mono"
            />
          </div>
          <Button type="submit" disabled={busy || (mode === "signup" && !registrationOpen)}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {bootstrap.mode === "OWNER_FINALIZED" ? (
          <p className="mt-4 text-center font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
            Operator finalized — registration closed
          </p>
        ) : bootstrap.mode === "BOOTSTRAP_OPEN" ? (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Bootstrap mode. Register the account intended to operate this deployment, then
            finalize ownership from the console to close registration permanently.
          </p>
        ) : (
          <div className="mt-4 border border-destructive/50 bg-destructive/10 p-3 text-center">
            <p className="font-mono text-xs uppercase text-destructive">
              Authentication configuration mismatch
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{bootstrap.detail}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bootstrap registration is unavailable.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
