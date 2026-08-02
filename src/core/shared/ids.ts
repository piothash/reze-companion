/**
 * ARC — canonical domain identifiers (P0/M0).
 *
 * Identifiers only. No trading objects, no engine behaviour. Every identifier
 * is a branded string so an `OrderId` can never be passed where a
 * `WindowInstanceId` is expected.
 */

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type CorrelationId = Branded<string, "CorrelationId">;
export type CausationId = Branded<string, "CausationId">;
export type MarketInstanceId = Branded<string, "MarketInstanceId">;
export type ExecutionContextId = Branded<string, "ExecutionContextId">;
export type WindowDefinitionId = Branded<string, "WindowDefinitionId">;
export type WindowInstanceId = Branded<string, "WindowInstanceId">;
export type ExecutionIntentId = Branded<string, "ExecutionIntentId">;
export type OrderId = Branded<string, "OrderId">;
export type SettlementId = Branded<string, "SettlementId">;
export type LedgerEntryId = Branded<string, "LedgerEntryId">;
export type EventId = Branded<string, "EventId">;

export const ID_PREFIX = {
  CorrelationId: "cor",
  CausationId: "cau",
  MarketInstanceId: "mkt",
  ExecutionContextId: "exc",
  WindowDefinitionId: "wdf",
  WindowInstanceId: "win",
  ExecutionIntentId: "eit",
  OrderId: "ord",
  SettlementId: "stl",
  LedgerEntryId: "led",
  EventId: "evt",
} as const;

export type IdKind = keyof typeof ID_PREFIX;

/**
 * FNV-1a 32-bit, run over four salted passes to produce a 128-bit digest.
 * Synchronous, dependency-free and identical in every runtime — which is what
 * deterministic replay requires (WebCrypto digest is async and unusable here).
 */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function digest128(input: string): string {
  const seeds = [0x811c9dc5, 0x1000193, 0x9e3779b9, 0x85ebca6b];
  return seeds.map((seed) => fnv1a32(input, seed).toString(16).padStart(8, "0")).join("");
}

/**
 * Deterministic identifier: the same `kind` + same ordered parts always yields
 * the same id, in every process and every replay run.
 */
export function deterministicId<K extends IdKind>(kind: K, ...parts: readonly string[]): string {
  if (parts.length === 0) throw new Error(`deterministicId(${kind}) requires at least one part`);
  return `${ID_PREFIX[kind]}_${digest128(`${kind}\u0000${parts.join("\u0000")}`)}`;
}

export function isId(kind: IdKind, value: string): boolean {
  return new RegExp(`^${ID_PREFIX[kind]}_[0-9a-f]{32}$`).test(value);
}

function make<T extends string>(kind: IdKind, parts: readonly string[]): T {
  return deterministicId(kind, ...parts) as T;
}

export const Ids = {
  correlation: (...p: readonly string[]) => make<CorrelationId>("CorrelationId", p),
  causation: (...p: readonly string[]) => make<CausationId>("CausationId", p),
  marketInstance: (...p: readonly string[]) => make<MarketInstanceId>("MarketInstanceId", p),
  executionContext: (...p: readonly string[]) => make<ExecutionContextId>("ExecutionContextId", p),
  windowDefinition: (...p: readonly string[]) => make<WindowDefinitionId>("WindowDefinitionId", p),
  windowInstance: (...p: readonly string[]) => make<WindowInstanceId>("WindowInstanceId", p),
  executionIntent: (...p: readonly string[]) => make<ExecutionIntentId>("ExecutionIntentId", p),
  order: (...p: readonly string[]) => make<OrderId>("OrderId", p),
  settlement: (...p: readonly string[]) => make<SettlementId>("SettlementId", p),
  ledgerEntry: (...p: readonly string[]) => make<LedgerEntryId>("LedgerEntryId", p),
  event: (...p: readonly string[]) => make<EventId>("EventId", p),
} as const;

/** Parses an untrusted string into a branded id, or throws. */
export function parseId<K extends IdKind>(kind: K, value: string): string {
  if (!isId(kind, value)) throw new Error(`Value is not a valid ${kind}: ${value}`);
  return value;
}
