/**
 * ARC — Decision Domain public surface (M2).
 *
 * TWAP-native decision making only: windows, quota, decisions and immutable
 * execution intents. No execution, no orders, no risk, no settlement, and no
 * trace of the legacy Majority strategy anywhere behind this barrel.
 */
export * from "./types";
export * from "./configuration";
export * from "./trade-quota";
export * from "./window-fsm";
export * from "./window-instance";
export * from "./decision-engine";
export * from "./events";
export * from "./execution-context";
export * from "./window-manager";
