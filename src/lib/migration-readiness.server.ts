/**
 * ARC — control-plane migration readiness probe (M7.5).
 *
 * Server-only by filename. Reads which required tables exist through the
 * read-only `arc_schema_report()` reporter and evaluates the pure checklist.
 * It never creates, alters or drops anything.
 */
import {
  evaluateMigrationReadiness,
  type MigrationReadinessReport,
} from "./supabase/cutover";
import { createPublishableServerClient } from "./supabase/backend.server";

interface SchemaReportRow {
  readonly table_name: string;
  readonly present: boolean;
}

/** Lists the public tables the reporter says are present. */
export async function readPresentTables(): Promise<string[] | null> {
  const client = createPublishableServerClient();
  if (!client) return null;
  const { data, error } = await client.rpc("arc_schema_report");
  if (error || !Array.isArray(data)) return null;
  return (data as SchemaReportRow[]).filter((row) => row.present).map((row) => row.table_name);
}

/** Full migration checklist for the System diagnostics surface. */
export async function probeMigrationReadiness(): Promise<
  MigrationReadinessReport & { readonly resolved: boolean }
> {
  const tables = await readPresentTables();
  if (!tables) {
    const report = evaluateMigrationReadiness([]);
    return {
      ...report,
      resolved: false,
      detail: "Schema readiness could not be verified against the active backend.",
    };
  }
  return { ...evaluateMigrationReadiness(tables), resolved: true };
}
