/**
 * ARC — Order instance (M3).
 *
 * A single order, driven by the deterministic Order FSM, with idempotent fill
 * accounting. Fills are keyed by their venue fill id, so a duplicate fill
 * delivered after a restart or a websocket replay is ignored rather than
 * double-counted.
 *
 * This module is strategy-free: it knows a quantity, a limit price and an
 * opaque outcome key. Nothing else.
 */
import { StateMachine } from "../infrastructure/fsm";
import { deterministicId } from "../shared/ids";
import { type Clock } from "../shared/time";
import { ORDER_FSM } from "./order-fsm";
import {
  freezeDeep,
  orderSnapshotSchema,
  type Fill,
  type OrderSnapshot,
  type OrderState,
  type TimeInForce,
} from "./types";

export interface OrderOptions {
  executionIntentId: string;
  marketInstanceId: string;
  outcomeKey: string;
  attempt: number;
  repriceCount: number;
  quantity: number;
  limitPrice: number;
  timeInForce: TimeInForce;
  postOnly: boolean;
  clock: Clock;
}

export interface ApplyFillResult {
  applied: boolean;
  duplicate: boolean;
  complete: boolean;
  fill: Fill | null;
}

const EPSILON = 1e-9;

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export class Order {
  readonly orderId: string;
  private readonly machine: StateMachine<
    OrderState,
    "SUBMIT" | "ACKNOWLEDGE" | "PARTIAL_FILL" | "FILL" | "CANCEL" | "REJECT" | "EXPIRE"
  >;
  private readonly fillsById = new Map<string, Fill>();
  private filled = 0;
  private notional = 0;
  private venueOrderIdValue: string | null = null;
  private rejectionReasonValue: string | null = null;
  private readonly createdAtIso: string;
  private updatedAtIso: string;
  private terminalAtIso: string | null = null;

  constructor(private readonly options: OrderOptions) {
    this.orderId = deterministicId(
      "OrderId",
      options.executionIntentId,
      String(options.attempt),
      String(options.repriceCount),
    );
    this.machine = new StateMachine(ORDER_FSM, options.clock);
    this.createdAtIso = options.clock.isoNow();
    this.updatedAtIso = this.createdAtIso;
  }

  get state(): OrderState {
    return this.machine.state;
  }

  get isTerminal(): boolean {
    return this.machine.isTerminal;
  }

  get filledQuantity(): number {
    return round(this.filled);
  }

  get remainingQuantity(): number {
    return round(Math.max(0, this.options.quantity - this.filled));
  }

  get limitPrice(): number {
    return this.options.limitPrice;
  }

  get venueOrderId(): string | null {
    return this.venueOrderIdValue;
  }

  private touch(): void {
    this.updatedAtIso = this.options.clock.isoNow();
    if (this.machine.isTerminal && !this.terminalAtIso) this.terminalAtIso = this.updatedAtIso;
  }

  submit(): void {
    this.machine.send("SUBMIT");
    this.touch();
  }

  acknowledge(venueOrderId: string): void {
    this.venueOrderIdValue = venueOrderId;
    if (this.machine.can("ACKNOWLEDGE")) this.machine.send("ACKNOWLEDGE");
    this.touch();
  }

  reject(reason: string): void {
    this.rejectionReasonValue = reason;
    if (this.machine.can("REJECT")) this.machine.send("REJECT");
    this.touch();
  }

  cancel(): boolean {
    if (!this.machine.can("CANCEL")) return false;
    this.machine.send("CANCEL");
    this.touch();
    return true;
  }

  expire(): boolean {
    if (!this.machine.can("EXPIRE")) return false;
    this.machine.send("EXPIRE");
    this.touch();
    return true;
  }

  /**
   * Applies a venue fill. Idempotent on `venueFillId`, clamped to the order
   * quantity, and drives the FSM to PARTIALLY_FILLED or FILLED.
   */
  applyFill(input: { venueFillId: string; quantity: number; price: number }): ApplyFillResult {
    if (this.fillsById.has(input.venueFillId)) {
      return { applied: false, duplicate: true, complete: this.state === "FILLED", fill: null };
    }
    if (this.isTerminal && this.state !== "PARTIALLY_FILLED") {
      return { applied: false, duplicate: false, complete: this.state === "FILLED", fill: null };
    }

    const quantity = round(Math.min(input.quantity, this.remainingQuantity));
    if (quantity <= 0) {
      return { applied: false, duplicate: false, complete: this.state === "FILLED", fill: null };
    }

    const fill: Fill = {
      fillId: deterministicId("LedgerEntryId", this.orderId, input.venueFillId),
      orderId: this.orderId,
      quantity,
      price: input.price,
      venueFillId: input.venueFillId,
      filledAtIso: this.options.clock.isoNow(),
    };
    this.fillsById.set(input.venueFillId, fill);
    this.filled = round(this.filled + quantity);
    this.notional = round(this.notional + quantity * input.price);

    const complete = this.filled >= this.options.quantity - EPSILON;
    const event = complete ? "FILL" : "PARTIAL_FILL";
    if (this.machine.can(event)) this.machine.send(event);
    this.touch();

    return { applied: true, duplicate: false, complete, fill };
  }

  snapshot(): OrderSnapshot {
    return freezeDeep(
      orderSnapshotSchema.parse({
        orderId: this.orderId,
        executionIntentId: this.options.executionIntentId,
        marketInstanceId: this.options.marketInstanceId,
        outcomeKey: this.options.outcomeKey,
        attempt: this.options.attempt,
        repriceCount: this.options.repriceCount,
        state: this.state,
        timeInForce: this.options.timeInForce,
        postOnly: this.options.postOnly,
        limitPrice: this.options.limitPrice,
        quantity: this.options.quantity,
        filledQuantity: this.filledQuantity,
        remainingQuantity: this.remainingQuantity,
        averageFillPrice: this.filled > 0 ? round(this.notional / this.filled) : 0,
        venueOrderId: this.venueOrderIdValue,
        rejectionReason: this.rejectionReasonValue,
        fills: [...this.fillsById.values()],
        createdAtIso: this.createdAtIso,
        updatedAtIso: this.updatedAtIso,
        terminalAtIso: this.terminalAtIso,
      } satisfies OrderSnapshot),
    );
  }

  get notionalFilled(): number {
    return round(this.notional);
  }

  /** Rebuilds an order from a persisted snapshot after a restart. */
  static restore(snapshot: OrderSnapshot, clock: Clock): Order {
    const order = new Order({
      executionIntentId: snapshot.executionIntentId,
      marketInstanceId: snapshot.marketInstanceId,
      outcomeKey: snapshot.outcomeKey,
      attempt: snapshot.attempt,
      repriceCount: snapshot.repriceCount,
      quantity: snapshot.quantity,
      limitPrice: snapshot.limitPrice,
      timeInForce: snapshot.timeInForce,
      postOnly: snapshot.postOnly,
      clock,
    });
    order.venueOrderIdValue = snapshot.venueOrderId;
    order.rejectionReasonValue = snapshot.rejectionReason;
    order.filled = snapshot.filledQuantity;
    order.notional = round(snapshot.filledQuantity * snapshot.averageFillPrice);
    for (const fill of snapshot.fills) order.fillsById.set(fill.venueFillId, fill);
    order.terminalAtIso = snapshot.terminalAtIso;
    order.updatedAtIso = snapshot.updatedAtIso;
    order.forceState(snapshot.state);
    return order;
  }

  /** Replay-only: restores a persisted terminal/interim state verbatim. */
  private forceState(state: OrderState): void {
    const path: Record<
      OrderState,
      readonly (
        "SUBMIT" | "ACKNOWLEDGE" | "PARTIAL_FILL" | "FILL" | "CANCEL" | "REJECT" | "EXPIRE"
      )[]
    > = {
      CREATED: [],
      SUBMITTED: ["SUBMIT"],
      WORKING: ["SUBMIT", "ACKNOWLEDGE"],
      PARTIALLY_FILLED: ["SUBMIT", "ACKNOWLEDGE", "PARTIAL_FILL"],
      FILLED: ["SUBMIT", "ACKNOWLEDGE", "FILL"],
      CANCELLED: ["SUBMIT", "ACKNOWLEDGE", "CANCEL"],
      REJECTED: ["SUBMIT", "REJECT"],
      EXPIRED: ["SUBMIT", "ACKNOWLEDGE", "EXPIRE"],
    };
    for (const event of path[state]) {
      if (this.machine.can(event)) this.machine.send(event);
    }
  }
}
