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
export type { OperatorBootstrapState } from "./auth-state.server";

export const getOperatorBootstrapState = createServerFn({ method: "GET" }).handler(
  async (): Promise<OperatorBootstrapState> => {
    const { resolveOperatorBootstrapState } = await import("./auth-state.server");
    return resolveOperatorBootstrapState();
  },
);
