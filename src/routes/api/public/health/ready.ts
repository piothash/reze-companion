import { createFileRoute } from "@tanstack/react-router";

/**
 * ARC readiness probe (M6.5). Ready means: dependencies answer, every startup
 * gate passed and no subsystem watchdog is critical.
 */
export const Route = createFileRoute("/api/public/health/ready")({
  server: {
    handlers: {
      GET: async () => {
        const { readyPayload } = await import("@/lib/health-surface.server");
        try {
          const payload = await readyPayload();
          return Response.json(payload, { status: payload.status === "ready" ? 200 : 503 });
        } catch (error) {
          return Response.json(
            {
              status: "not-ready",
              reasonCode: "SYSTEM_START_BLOCKED",
              detail: error instanceof Error ? error.message : "readiness evaluation failed",
              observedAt: new Date().toISOString(),
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
