/**
 * ARC — `POST /api/public/authority/register` (M7.6).
 *
 * Engine-initiated. The VPS trading authority announces itself here on boot,
 * before it starts its runtime. A registration is accepted only when it is
 * signed with the shared authority key, carries a fresh timestamp and has
 * never been seen before. If this endpoint does not return `accepted: true`,
 * the engine must not claim active status.
 *
 * The control plane stores public identity only.
 */
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

export const Route = createFileRoute("/api/public/authority/register")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
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
        const { handleAuthorityRegistration } = await import("@/lib/authority-gateway.server");
        const result = await handleAuthorityRegistration(supabaseAdmin, body);
        return Response.json(result.body, { status: result.status, headers: CORS });
      },
    },
  },
});
