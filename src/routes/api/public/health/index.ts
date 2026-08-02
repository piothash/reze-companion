import { createFileRoute } from "@tanstack/react-router";

import { createRuntime, registerFoundationHealthChecks } from "@/core/runtime";
import { versionManifest } from "@/core/contracts/versions";

/**
 * ARC foundation health endpoint (P0/M0).
 *
 * Reports configuration validity, scheduler state and platform versions.
 * No trading data, no engine credentials, no user data.
 */
export const Route = createFileRoute("/api/public/health/")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const runtime = createRuntime({ env: process.env, source: "health" });
          registerFoundationHealthChecks(runtime);
          const report = await runtime.health.report();
          return Response.json(
            { ...report, versions: runtime.versions },
            { status: report.status === "unavailable" ? 503 : 200 },
          );
        } catch (error) {
          return Response.json(
            {
              status: "unavailable",
              reasonCode: "CFG_INVALID",
              detail: error instanceof Error ? error.message : "configuration invalid",
              versions: versionManifest(),
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
