import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Companion control-plane reads ONLY.
 *
 * Per docs/ARC_PROJECT_CHARTER.md and ADR-0001: no trading decisions, market
 * state generation, TWAP calculation, risk evaluation, or order execution is
 * implemented here. These functions read companion-owned metadata and mirrored
 * engine telemetry from Lovable Cloud. The VPS remains the sole trading authority.
 */

export const getOperatorOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [profile, roles, endpoints, snapshot, events, notifications] = await Promise.all([
      supabase.from("profiles").select("display_name, email").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("engine_endpoints")
        .select("id, name, base_url, environment, is_active, last_seen_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("engine_snapshots")
        .select("id, engine_state, mode, captured_at")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("event_log")
        .select("id, level, message, source, occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(12),
      supabase
        .from("notifications")
        .select("id, title, severity, created_at, read_at")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    return {
      displayName: profile.data?.display_name ?? profile.data?.email ?? null,
      roles: (roles.data ?? []).map((r) => r.role),
      endpoints: endpoints.data ?? [],
      snapshot: snapshot.data ?? null,
      events: events.data ?? [],
      notifications: notifications.data ?? [],
    };
  });
