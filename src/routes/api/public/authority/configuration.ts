/**
 * ARC — `/api/public/authority/configuration` (M7.6).
 *
 * The configuration dispatch loop, from the engine's side:
 *
 *   GET  → the version the engine should be running (pull, NAT-friendly)
 *   POST → the engine's signed ACCEPTED / REJECTED verdict
 *
 * No configuration becomes active without an explicit engine verdict: the GET
 * side only reads published versions, and only a verified POST flips a version
 * to ACTIVE and updates the runtime mirror.
 */
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

export const Route = createFileRoute("/api/public/authority/configuration")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async ({ request }) => {
        const authorityId = new URL(request.url).searchParams.get("authorityId")?.trim();
        if (!authorityId) {
          return Response.json(
            {
              pending: false,
              reasonCode: "AUTHORITY_ID_REQUIRED",
              detail: "authorityId query parameter is required",
            },
            { status: 400, headers: CORS },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { handleConfigurationPull } = await import("@/lib/authority-gateway.server");
        const result = await handleConfigurationPull(supabaseAdmin, authorityId);
        return Response.json(result.body, { status: result.status, headers: CORS });
      },

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
        const { handleConfigurationVerdict } = await import("@/lib/authority-gateway.server");
        const result = await handleConfigurationVerdict(supabaseAdmin, body);
        return Response.json(result.body, { status: result.status, headers: CORS });
      },
    },
  },
});
