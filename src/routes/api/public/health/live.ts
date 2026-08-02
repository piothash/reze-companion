import { createFileRoute } from "@tanstack/react-router";

/**
 * ARC liveness probe (M6.5). Answers only "this process is running".
 * Dependency-free by design so PM2 and the load balancer never restart the
 * process because the database is slow.
 */
export const Route = createFileRoute("/api/public/health/live")({
  server: {
    handlers: {
      GET: async () => {
        const { livePayload } = await import("@/lib/health-surface.server");
        return Response.json(livePayload(), { status: 200 });
      },
    },
  },
});
