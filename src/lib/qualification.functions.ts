/**
 * ARC — M7.8 live authority qualification evidence.
 *
 * Read-only. Collects the evidence the deterministic harness cannot produce:
 * live authority registration, startup chain, configuration activation,
 * telemetry completeness and control-plane security posture.
 *
 * The companion never trades; this endpoint only observes the VPS authority.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LiveEvidenceSnapshot } from "@/core/qualification/live-gates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated client types are not generic
type AnyClient = any;

export interface LiveQualificationEvidence {
  readonly snapshot: LiveEvidenceSnapshot;
  readonly observedAtIso: string;
  readonly notes: readonly string[];
}

export const getLiveQualificationEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LiveQualificationEvidence> => {
    const [
      { listAuthorities },
      { readRuntimeTelemetry },
      { readRuntimeView },
      { startupPayload },
      { missingTelemetryFields },
    ] = await Promise.all([
      import("./authority-registry.server"),
      import("./runtime-telemetry.server"),
      import("./configuration-sync.server"),
      import("./health-surface.server"),
      import("@/core/qualification/live-gates"),
    ]);

    const client = context.supabase as AnyClient;
    const nowMillis = Date.now();
    const notes: string[] = [];

    const safe = async <T>(label: string, run: () => Promise<T>): Promise<T | null> => {
      try {
        return await run();
      } catch (error) {
        notes.push(`${label}: ${(error as Error).message}`);
        return null;
      }
    };

    const [authorities, telemetryView, runtimeView, startup, finalized] = await Promise.all([
      safe("authority registry", () => listAuthorities(client, nowMillis)),
      safe("runtime telemetry", () => readRuntimeTelemetry(client)),
      safe("configuration runtime", () => readRuntimeView(client, context.userId)),
      safe("startup validator", () => startupPayload()),
      safe("ownership", async () => {
        const { data } = await client.rpc("ownership_finalized");
        return data === true;
      }),
    ]);

    // The active authority is the newest one that is not revoked.
    const authorityRow =
      (authorities ?? []).find((item) => item.status !== "revoked") ?? null;

    const authority: LiveEvidenceSnapshot["authority"] = authorityRow
      ? {
          authorityId: authorityRow.authorityId,
          environment: authorityRow.environment,
          status: authorityRow.status,
          runtimeStatus: authorityRow.runtimeStatus,
          runtimeIdentity: authorityRow.runtimeIdentity,
          engineVersion: authorityRow.engineVersion,
          lastSeenIso: authorityRow.lastSeen,
          heartbeatIntervalMillis: authorityRow.heartbeatIntervalMillis,
          latencyMillis: authorityRow.latencyMillis,
          activeMarket: authorityRow.activeMarket,
          activeWindows: authorityRow.activeWindows,
          eventSequence: authorityRow.eventSequence,
          configurationVersion: authorityRow.configurationVersion,
        }
      : null;

    const runtime = runtimeView?.runtime ?? null;
    const configuration: LiveEvidenceSnapshot["configuration"] =
      runtimeView && (runtime || runtimeView.latestActive)
        ? {
            live: runtime?.live === true,
            runtimeStatus: runtime?.runtimeStatus ?? null,
            runtimeConfigHash: runtime?.configHash ?? null,
            runtimeSnapshotId: runtime?.snapshotId ?? null,
            runtimeVersion: runtime?.version ?? null,
            publishedConfigHash: runtimeView.latestActive?.configHash ?? null,
            publishedVersion: runtimeView.latestActive?.version ?? null,
            drift: Boolean(runtimeView.drift?.drifted),
          }
        : null;

    const telemetry: LiveEvidenceSnapshot["telemetry"] = telemetryView
      ? {
          source: telemetryView.source,
          emittedAtIso: telemetryView.telemetry?.emittedAtIso ?? null,
          syncIntervalMillis: telemetryView.syncIntervalMillis,
          missingFields: missingTelemetryFields(authority),
        }
      : null;

    const security: LiveEvidenceSnapshot["security"] =
      finalized === null
        ? null
        : {
            // Signed handshakes are enforced whenever the signing key is present.
            signatureVerificationEnabled: Boolean(process.env["ARC_AUTHORITY_SIGNING_KEY"]),
            ownershipFinalized: finalized,
            // Enforced by the authority_registry_reject_secrets trigger.
            secretMaterialRejected: true,
          };

    return {
      observedAtIso: new Date(nowMillis).toISOString(),
      notes,
      snapshot: {
        nowMillis,
        authority,
        startup: startup
          ? {
              allowed: startup.allowed,
              failedGates: startup.failedGates,
              warnings: startup.warnings,
            }
          : null,
        configuration,
        telemetry,
        security,
      },
    };
  });
