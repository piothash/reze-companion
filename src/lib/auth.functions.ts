/**
 * ARC — single-operator authentication surface (M7.1).
 *
 * ARC is not a SaaS platform: exactly one primary operator (role `owner`) is
 * responsible for the trading authority. The first registration bootstraps that
 * owner; afterwards public registration is closed at the auth provider level and
 * the sign-in screen hides the sign-up affordance.
 *
 * This read is deliberately public and returns a single boolean — it exposes no
 * account, identity or credential information.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

export interface OperatorBootstrapState {
  /** True once a primary operator (OWNER) exists — registration is then closed. */
  readonly bootstrapped: boolean;
  /** False when the probe could not reach persistence; UI must fail closed. */
  readonly resolved: boolean;
}

export const getOperatorBootstrapState = createServerFn({ method: "GET" }).handler(
  async (): Promise<OperatorBootstrapState> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return { bootstrapped: true, resolved: false };

    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
            headers.delete("Authorization");
          }
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });

    const { data, error } = await client.rpc("operator_bootstrapped");
    // Fail closed: an unreachable probe never advertises an open registration.
    if (error) return { bootstrapped: true, resolved: false };
    return { bootstrapped: data === true, resolved: true };
  },
);
