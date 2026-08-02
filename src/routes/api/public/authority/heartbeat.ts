/**
 * ARC — `POST /api/public/authority/heartbeat` (M7.6).
 *
 * Engine-initiated liveness proof. Every heartbeat is signature-, timestamp-
 * and replay-checked before it touches the registry. The engine reports what
 * it is doing; the companion never tells it what to do, and the engine can
 * never set its own registry status — liveness is derived from heartbeats the
 * companion verified itself.
 */
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

export const Route = createFileRoute("/api/public/authority/heartbeat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const receivedAt = Date.now();
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { accepted: false, reasonCode: "BODY_INVALID", detail: "expected a JSON body" },
            { status: 400, headers: CORS },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { handleAuthorityHeartbeat } = await import("@/lib/authority-gateway.server");
        const result = await handleAuthorityHeartbeat(supabaseAdmin, body, receivedAt);
        return Response.json(result.body, { status: result.status, headers: CORS });
      },
    },
  },
});
