/**
 * ARC — Market State Domain public surface (M1).
 *
 * The single authoritative source of runtime market information. No trading
 * logic lives behind this barrel.
 */
export * from "./types";
export * from "./configuration";
export * from "./events";
export * from "./discovery";
export * from "./lifecycle";
export * from "./feed-engine";
export * from "./twap-engine";
export * from "./ptb-engine";
export * from "./signal-conditioning";
export * from "./market-state";
export * from "./domain";
