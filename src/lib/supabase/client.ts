/**
 * ARC — browser Supabase access (M7.4).
 *
 * The only browser-side Supabase entry point. Components, routes and hooks must
 * import from here rather than initializing their own clients, so backend
 * selection stays environment-driven and auditable.
 */
export { supabase } from "@/integrations/supabase/client";
export { getBackendIdentity, getSupabaseBackend } from "./provider";
export type { BackendIdentity } from "./provider";
export type { SupabaseBackendConfig } from "./config";
