/**
 * ARC — single-operator authentication surface (M7.1, revised M7.2).
 *
 * ARC is not a SaaS platform: exactly one primary operator (role `owner`) is
 * responsible for the trading authority. Registration is NOT closed by the
 * first account that happens to register — a development account must never
 * become the permanent production owner. Registration closes only once
 * ownership has been explicitly finalized by the intended operator.
 *
 * This read is deliberately public and returns a single boolean — it exposes no
 * account, identity or credential information.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

export interface OperatorBootstrapState {
  /** True once ownership is finalized — registration is then permanently closed. */
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

    const { data, error } = await client.rpc("ownership_finalized");
    // Fail closed: an unreachable probe never advertises an open registration.
    if (error) return { bootstrapped: true, resolved: false };
    return { bootstrapped: data === true, resolved: true };
  },
);
