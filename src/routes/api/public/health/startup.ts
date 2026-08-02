import { createFileRoute } from "@tanstack/react-router";

/**
 * ARC startup probe (M6.5). Reports every startup gate. A failing gate yields
 * `SYSTEM_START_BLOCKED` and a 503 — supervisors must not promote the process.
 */
export const Route = createFileRoute("/api/public/health/startup")({
  server: {
    handlers: {
      GET: async () => {
        const { startupPayload } = await import("@/lib/health-surface.server");
        try {
          const payload = await startupPayload();
          return Response.json(payload, { status: payload.allowed ? 200 : 503 });
        } catch (error) {
          return Response.json(
            {
              allowed: false,
              reasonCode: "SYSTEM_START_BLOCKED",
              detail: error instanceof Error ? error.message : "startup validation failed",
              observedAt: new Date().toISOString(),
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
