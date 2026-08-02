/**
 * ARC — Trade Domain public surface (M3).
 *
 * Risk, exposure, orders and execution only. No strategy, no TWAP, no PTB, no
 * windows, and no trace of the legacy Majority strategy behind this barrel.
 */
export * from "./types";
export * from "./configuration";
export * from "./order-fsm";
export * from "./exposure";
export * from "./risk-engine";
export * from "./order";
export * from "./venue-gateway";
export * from "./standing-order-engine";
export * from "./execution-adapter";
export * from "./events";
export * from "./trade-coordinator";
