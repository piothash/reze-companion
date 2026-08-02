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
  const { bootstrapped } = Route.useLoaderData();
  const [mode, setMode] = useState<"signin" | "signup">(bootstrapped ? "signin" : "signup");
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
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          toast.info("Operator account created. Sign in to continue.");
          setMode("signin");
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
          <Button type="submit" disabled={busy}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {bootstrapped ? (
          <p className="mt-4 text-center font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
            Operator already configured
          </p>
        ) : (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            No operator exists yet. The first account registered becomes the primary operator
            (OWNER).
          </p>
        )}
      </div>
    </div>
  );
}
