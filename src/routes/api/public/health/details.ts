import { createFileRoute } from "@tanstack/react-router";

/**
 * ARC health details (M6.5). Every engine and subsystem reports independently:
 * dependency health, subsystem watchdogs and the startup gate matrix.
 */
export const Route = createFileRoute("/api/public/health/details")({
  server: {
    handlers: {
      GET: async () => {
        const { detailsPayload } = await import("@/lib/health-surface.server");
        try {
          const payload = await detailsPayload();
          return Response.json(payload, {
            status: payload.status === "unavailable" ? 503 : 200,
          });
        } catch (error) {
          return Response.json(
            {
              status: "unavailable",
              reasonCode: "CFG_INVALID",
              detail: error instanceof Error ? error.message : "health details unavailable",
              observedAt: new Date().toISOString(),
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
