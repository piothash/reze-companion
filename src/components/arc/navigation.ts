/**
 * ARC — operator navigation registry.
 *
 * Single source of truth for the operator platform's primary navigation. The
 * platform is TWAP-native: no majority/crowd/vote surface exists.
 */
export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly description: string;
}

export const OPERATOR_NAV = [
  { to: "/dashboard", label: "Dashboard", description: "Global operational overview" },
  { to: "/markets", label: "Markets", description: "Authoritative market state" },
  { to: "/execution-profiles", label: "Execution Profiles", description: "Windows and buffers" },
  { to: "/windows", label: "Active Windows", description: "Live window instances" },
  { to: "/trade-monitor", label: "Trade Monitor", description: "Intents, orders, settlement" },
  { to: "/signal-tank", label: "Signal Tank", description: "TWAP vs PTB decisions" },
  { to: "/replay", label: "Replay", description: "Deterministic reconstruction" },
  { to: "/analytics", label: "Analytics", description: "Execution performance" },
  { to: "/health", label: "Health", description: "Component health" },
  { to: "/notifications", label: "Notifications", description: "Operator alerts" },
  { to: "/configuration", label: "Configuration", description: "Profiles, flags, environment" },
  { to: "/system", label: "System", description: "Versions and build" },
  { to: "/audit", label: "Audit", description: "Immutable action trail" },
] as const;
