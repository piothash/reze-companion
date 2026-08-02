/**
 * ARC — Platform Services barrel (M4).
 *
 * Platform Services are infrastructure: event store, replay, ledger,
 * analytics, notifications, audit trail and synchronization policy. No
 * strategy, no trading decisions, no order placement lives here.
 */
export * from "./authority-presentation";
export * from "./configuration-activation";
export * from "./event-catalog";
export * from "./event-store";
export * from "./events";
export * from "./ledger";
export * from "./replay";
export * from "./recovery";
export * from "./analytics";
export * from "./notifications";
export * from "./audit";
export * from "./sync";
