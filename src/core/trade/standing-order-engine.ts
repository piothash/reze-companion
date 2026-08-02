/**
 * ARC — Standing Limit Order Engine (M3).
 *
 * Generic, strategy-free execution machinery, harvested from the production
 * Reze implementation and refactored to remove every strategy coupling.
 *
 * The engine MUST NOT know: TWAP, PTB, buffers, execution windows, window
 * offsets, majority, crowd sentiment, Binance direction, execution profiles or
 * decision logic. It receives ExecutionConstraints and nothing else.
 *
 * Preserved from the production implementation:
 *   • standing (resting) limit orders with passive maker pricing
 *   • smart repricing through cancel/replace with a bounded budget
 *   • retry with a configured count and delay
 *   • partial fill accounting across cancel/replace boundaries
 *   • order monitoring and session deadline enforcement
 *   • IOC fallback once passive attempts are exhausted
 *   • settlement hooks fired exactly once
 *   • recovery/replay hooks (snapshot / restore)
 *
 * The engine is tick-driven, not timer-driven: the caller owns the clock, so
 * a recorded run replays byte-for-byte.
 */
import { type Clock, fromIsoUtc, toIsoUtc } from "../shared/time";
import { Order } from "./order";
import {
  applyTick,
  executionSessionSnapshotSchema,
  freezeDeep,
  type ExecutionConstraints,
  type ExecutionFailureReason,
  type ExecutionReport,
  type ExecutionSessionSnapshot,
  type ExecutionState,
  type Fill,
  type OrderSnapshot,
  type TimeInForce,
} from "./types";
import { type BookSnapshot, type VenueGateway } from "./venue-gateway";

export interface StandingOrderObserver {
  onOrderSubmitted?(order: OrderSnapshot): Promise<void> | void;
  onOrderUpdated?(order: OrderSnapshot, note: string): Promise<void> | void;
  onOrderFilled?(
    order: OrderSnapshot,
    fill: Fill,
    cumulative: number,
    complete: boolean,
  ): Promise<void> | void;
  onOrderCancelled?(order: OrderSnapshot): Promise<void> | void;
  /** Fired at most once per session, before the terminal report. */
  onFirstMeaningfulFill?(cumulative: number): Promise<void> | void;
  /** Settlement hook. Fired exactly once per session, on any terminal path. */
  onTerminal?(report: ExecutionReport): Promise<void> | void;
}

export interface StandingOrderEngineOptions {
  gateway: VenueGateway;
  clock: Clock;
  observer?: StandingOrderObserver;
}

export interface VenueFillEvent {
  venueOrderId: string;
  venueFillId: string;
  quantity: number;
  price: number;
}

const EPSILON = 1e-9;

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/**
 * One execution session: everything the engine does for a single set of
 * ExecutionConstraints, across every retry and every reprice.
 */
export class StandingOrderSession {
  private state: ExecutionState = "PENDING";
  private readonly orders: Order[] = [];
  private cumulativeFilled = 0;
  private cumulativeNotional = 0;
  private attempt = 0;
  private repriceCount = 0;
  private iocUsed = false;
  private quotaCommitted = false;
  private failure: ExecutionFailureReason | null = null;
  private readonly startedAtMillis: number;
  private readonly deadlineMillis: number;
  private nextRepriceAtMillis: number;
  private retryReadyAtMillis: number | null = null;
  private terminalAtIso: string | null = null;
  private terminalNotified = false;
  private observer: StandingOrderObserver | undefined;

  constructor(
    readonly constraints: ExecutionConstraints,
    private readonly options: StandingOrderEngineOptions,
  ) {
    this.observer = options.observer;
    this.startedAtMillis = options.clock.now();
    this.deadlineMillis = this.startedAtMillis + constraints.timeoutMillis;
    this.nextRepriceAtMillis = this.startedAtMillis + constraints.repricingIntervalMillis;
  }

  /** Replaces the observer before the session starts. */
  setObserver(observer: StandingOrderObserver): void {
    this.observer = observer;
  }

  get executionState(): ExecutionState {
    return this.state;
  }

  get isTerminal(): boolean {
    return this.state === "COMPLETED" || this.state === "FAILED" || this.state === "CANCELLED";
  }

  get cumulativeFilledQuantity(): number {
    return round(this.cumulativeFilled);
  }

  get hasMeaningfulFill(): boolean {
    return this.cumulativeFilled >= this.constraints.minMeaningfulQuantity - EPSILON;
  }

  private get activeOrder(): Order | undefined {
    return this.orders.find((order) => !order.isTerminal);
  }

  // -------------------------------------------------------------------------
  // Pricing — passive maker, bounded by the constraint limit price
  // -------------------------------------------------------------------------

  /**
   * Resolves the resting price. Passive maker: join the best bid when one is
   * observable, otherwise fall back to the constraint limit. The result is
   * always tick-aligned and never above `constraints.limitPrice`.
   */
  private resolvePrice(book: BookSnapshot | null, crossing: boolean): number {
    const { limitPrice, tickSize, tickPolicy, precision } = this.constraints;
    let candidate = limitPrice;
    if (book) {
      if (crossing && book.bestAsk !== null) candidate = Math.min(limitPrice, book.bestAsk);
      else if (!crossing && book.bestBid !== null) candidate = Math.min(limitPrice, book.bestBid);
    }
    const ticked = applyTick(candidate, tickSize, tickPolicy, precision);
    const floor = applyTick(tickSize, tickSize, "ROUND_UP", precision);
    return Math.max(floor, Math.min(ticked, limitPrice));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Places the first standing order. Idempotent: a second call is a no-op. */
  async start(): Promise<OrderSnapshot | null> {
    if (this.state !== "PENDING") return this.activeOrder?.snapshot() ?? null;
    this.state = "WORKING";
    return this.placeOrder({ crossing: false, timeInForce: "GTC" });
  }

  private async placeOrder(input: {
    crossing: boolean;
    timeInForce: TimeInForce;
  }): Promise<OrderSnapshot | null> {
    const remaining = round(this.constraints.quantity - this.cumulativeFilled);
    if (remaining <= 0) {
      await this.complete();
      return null;
    }

    const book = await this.options.gateway.book(this.constraints.outcomeKey);
    const price = this.resolvePrice(book, input.crossing);

    const order = new Order({
      executionIntentId: this.constraints.executionIntentId,
      marketInstanceId: this.constraints.marketInstanceId,
      outcomeKey: this.constraints.outcomeKey,
      attempt: this.attempt,
      repriceCount: this.repriceCount,
      quantity: remaining,
      limitPrice: price,
      timeInForce: input.timeInForce,
      postOnly: input.timeInForce === "IOC" ? false : this.constraints.postOnly,
      clock: this.options.clock,
    });
    this.orders.push(order);
    order.submit();
    await this.observer?.onOrderSubmitted?.(order.snapshot());

    const result = await this.options.gateway.submit({
      orderId: order.orderId,
      outcomeKey: this.constraints.outcomeKey,
      quantity: remaining,
      limitPrice: price,
      timeInForce: input.timeInForce,
      postOnly: order.snapshot().postOnly,
    });

    if (!result.accepted) {
      order.reject(result.rejectionReason);
      await this.observer?.onOrderUpdated?.(order.snapshot(), result.rejectionReason);
      await this.handleAttemptFailure(result.retryable ? "GATEWAY_ERROR" : "REJECTED");
      return order.snapshot();
    }

    order.acknowledge(result.venueOrderId);
    await this.observer?.onOrderUpdated?.(order.snapshot(), "working");

    if (result.immediateFillQuantity && result.immediateFillQuantity > 0) {
      await this.applyFill({
        venueOrderId: result.venueOrderId,
        venueFillId: `${result.venueOrderId}:immediate`,
        quantity: result.immediateFillQuantity,
        price: result.immediateFillPrice ?? price,
      });
    } else if (input.timeInForce === "IOC") {
      // An unfilled IOC never rests; it is dead on arrival.
      order.expire();
      await this.observer?.onOrderUpdated?.(order.snapshot(), "ioc-unfilled");
      await this.fail("NO_LIQUIDITY");
    }

    return order.snapshot();
  }

  // -------------------------------------------------------------------------
  // Fills — partial fill accounting survives cancel/replace and restarts
  // -------------------------------------------------------------------------

  async applyFill(event: VenueFillEvent): Promise<boolean> {
    if (this.isTerminal) return false;
    const order = this.orders.find((entry) => entry.venueOrderId === event.venueOrderId);
    if (!order) return false;

    const result = order.applyFill({
      venueFillId: event.venueFillId,
      quantity: event.quantity,
      price: event.price,
    });
    if (!result.applied || !result.fill) return false;

    this.cumulativeFilled = round(this.cumulativeFilled + result.fill.quantity);
    this.cumulativeNotional = round(
      this.cumulativeNotional + result.fill.quantity * result.fill.price,
    );

    await this.observer?.onOrderFilled?.(
      order.snapshot(),
      result.fill,
      this.cumulativeFilledQuantity,
      result.complete,
    );

    // Canonical partial-fill rule: the quota is consumed exactly once, the
    // first time cumulative executed quantity reaches the minimum meaningful
    // tradable quantity. Subsequent fills never consume quota again.
    if (!this.quotaCommitted && this.hasMeaningfulFill) {
      this.quotaCommitted = true;
      await this.observer?.onFirstMeaningfulFill?.(this.cumulativeFilledQuantity);
    }

    if (this.cumulativeFilled >= this.constraints.quantity - EPSILON) await this.complete();
    return true;
  }

  // -------------------------------------------------------------------------
  // Monitoring — repricing, retry and the session deadline
  // -------------------------------------------------------------------------

  /**
   * Advances the session. The caller decides when; the engine decides what.
   * Returns true when the session did something observable on this tick.
   */
  async tick(): Promise<boolean> {
    if (this.isTerminal) return false;
    const now = this.options.clock.now();

    if (this.retryReadyAtMillis !== null && now >= this.retryReadyAtMillis) {
      this.retryReadyAtMillis = null;
      this.attempt += 1;
      this.repriceCount = 0;
      await this.placeOrder({ crossing: false, timeInForce: "GTC" });
      return true;
    }

    if (now >= this.deadlineMillis) {
      await this.onDeadline();
      return true;
    }

    if (
      this.constraints.repricingEnabled &&
      this.repriceCount < this.constraints.repricingMaxAttempts &&
      now >= this.nextRepriceAtMillis &&
      this.activeOrder
    ) {
      this.nextRepriceAtMillis = now + this.constraints.repricingIntervalMillis;
      await this.reprice();
      return true;
    }

    return false;
  }

  /** Cancel/replace: cancel the resting order and re-place the remainder. */
  private async reprice(): Promise<void> {
    const order = this.activeOrder;
    if (!order) return;

    const book = await this.options.gateway.book(this.constraints.outcomeKey);
    const nextPrice = this.resolvePrice(book, false);
    if (Math.abs(nextPrice - order.limitPrice) < EPSILON) return;

    if (order.venueOrderId) {
      const cancelled = await this.options.gateway.cancel(order.venueOrderId);
      if (!cancelled.cancelled && !cancelled.alreadyTerminal) return;
    }
    order.cancel();
    await this.observer?.onOrderCancelled?.(order.snapshot());

    this.repriceCount += 1;
    await this.placeOrder({ crossing: false, timeInForce: "GTC" });
  }

  /**
   * Deadline reached. Either fall back to a crossing IOC order for the
   * remainder, or terminate. Partial fills already collected are preserved.
   */
  private async onDeadline(): Promise<void> {
    const order = this.activeOrder;

    if (this.constraints.iocFallbackEnabled && !this.iocUsed) {
      this.iocUsed = true;
      if (order?.venueOrderId) await this.options.gateway.cancel(order.venueOrderId);
      order?.cancel();
      if (order) await this.observer?.onOrderCancelled?.(order.snapshot());
      this.attempt += 1;
      this.repriceCount = 0;
      await this.placeOrder({ crossing: true, timeInForce: "IOC" });
      return;
    }

    if (order?.venueOrderId) await this.options.gateway.cancel(order.venueOrderId);
    order?.expire();
    if (order) await this.observer?.onOrderUpdated?.(order.snapshot(), "expired");

    if (this.cumulativeFilled > 0) await this.complete();
    else await this.fail("TIMEOUT");
  }

  private async handleAttemptFailure(reason: ExecutionFailureReason): Promise<void> {
    if (this.attempt < this.constraints.retryCount) {
      this.retryReadyAtMillis = this.options.clock.now() + this.constraints.retryDelayMillis;
      return;
    }
    await this.fail(this.constraints.retryCount > 0 ? "RETRY_EXHAUSTED" : reason);
  }

  /** Operator or upstream cancellation. Preserves partial fills. */
  async cancel(): Promise<void> {
    if (this.isTerminal) return;
    const order = this.activeOrder;
    if (order?.venueOrderId) await this.options.gateway.cancel(order.venueOrderId);
    if (order?.cancel()) await this.observer?.onOrderCancelled?.(order.snapshot());
    if (this.cumulativeFilled > 0) {
      await this.complete();
      return;
    }
    this.state = "CANCELLED";
    this.failure = "CANCELLED";
    this.terminalAtIso = this.options.clock.isoNow();
    await this.notifyTerminal();
  }

  private async complete(): Promise<void> {
    if (this.isTerminal) return;
    this.state = "COMPLETED";
    this.terminalAtIso = this.options.clock.isoNow();
    await this.notifyTerminal();
  }

  private async fail(reason: ExecutionFailureReason): Promise<void> {
    if (this.isTerminal) return;
    this.state = "FAILED";
    this.failure = reason;
    this.terminalAtIso = this.options.clock.isoNow();
    await this.notifyTerminal();
  }

  /** Settlement hook, fired exactly once regardless of the terminal path. */
  private async notifyTerminal(): Promise<void> {
    if (this.terminalNotified) return;
    this.terminalNotified = true;
    await this.observer?.onTerminal?.(this.report());
  }

  report(): ExecutionReport {
    const filled = this.cumulativeFilled >= this.constraints.quantity - EPSILON;
    return freezeDeep({
      executionIntentId: this.constraints.executionIntentId,
      marketInstanceId: this.constraints.marketInstanceId,
      outcomeKey: this.constraints.outcomeKey,
      filled,
      partiallyFilled: !filled && this.cumulativeFilled > 0,
      cumulativeFilledQuantity: this.cumulativeFilledQuantity,
      cumulativeNotional: round(this.cumulativeNotional),
      averagePrice:
        this.cumulativeFilled > 0 ? round(this.cumulativeNotional / this.cumulativeFilled) : 0,
      requestedQuantity: this.constraints.quantity,
      failureReason: this.failure,
      orders: this.orders.map((order) => order.snapshot()),
      reportedAtIso: this.terminalAtIso ?? this.options.clock.isoNow(),
    } satisfies ExecutionReport);
  }

  snapshot(): ExecutionSessionSnapshot {
    return freezeDeep(
      executionSessionSnapshotSchema.parse({
        executionIntentId: this.constraints.executionIntentId,
        marketInstanceId: this.constraints.marketInstanceId,
        outcomeKey: this.constraints.outcomeKey,
        state: this.state,
        constraints: this.constraints,
        orders: this.orders.map((order) => order.snapshot()),
        cumulativeFilledQuantity: this.cumulativeFilledQuantity,
        cumulativeNotional: round(this.cumulativeNotional),
        attempts: this.attempt,
        reprices: this.repriceCount,
        iocFallbackUsed: this.iocUsed,
        quotaCommitted: this.quotaCommitted,
        failureReason: this.failure,
        startedAtIso: toIsoUtc(this.startedAtMillis),
        deadlineIso: toIsoUtc(this.deadlineMillis),
        terminalAtIso: this.terminalAtIso,
      } satisfies ExecutionSessionSnapshot),
    );
  }

  /**
   * Recovery hook: rebuilds a session from a persisted snapshot. Cumulative
   * fills, the quota-committed flag and every order are restored, so a restart
   * can neither duplicate an order nor consume the quota a second time.
   */
  static restore(
    snapshot: ExecutionSessionSnapshot,
    options: StandingOrderEngineOptions,
  ): StandingOrderSession {
    const session = new StandingOrderSession(snapshot.constraints, options);
    session.state = snapshot.state;
    session.cumulativeFilled = snapshot.cumulativeFilledQuantity;
    session.cumulativeNotional = snapshot.cumulativeNotional;
    session.attempt = snapshot.attempts;
    session.repriceCount = snapshot.reprices;
    session.iocUsed = snapshot.iocFallbackUsed;
    session.quotaCommitted = snapshot.quotaCommitted;
    session.failure = snapshot.failureReason;
    session.terminalAtIso = snapshot.terminalAtIso;
    session.terminalNotified = snapshot.terminalAtIso !== null;
    for (const order of snapshot.orders) session.orders.push(Order.restore(order, options.clock));
    session.nextRepriceAtMillis =
      fromIsoUtc(snapshot.startedAtIso) + snapshot.constraints.repricingIntervalMillis;
    return session;
  }
}

/**
 * Owns one session per execution intent. Refusing a second session for a known
 * intent is what stops a restart from duplicating orders.
 */
export class StandingOrderEngine {
  private readonly sessions = new Map<string, StandingOrderSession>();

  constructor(private readonly options: StandingOrderEngineOptions) {}

  session(executionIntentId: string): StandingOrderSession | undefined {
    return this.sessions.get(executionIntentId);
  }

  get openSessions(): readonly StandingOrderSession[] {
    return [...this.sessions.values()].filter((session) => !session.isTerminal);
  }

  /** Creates a session. Returns the existing one when the intent is known. */
  open(
    constraints: ExecutionConstraints,
    observer?: StandingOrderObserver,
  ): { session: StandingOrderSession; duplicate: boolean } {
    const existing = this.sessions.get(constraints.executionIntentId);
    if (existing) return { session: existing, duplicate: true };
    const session = new StandingOrderSession(constraints, this.options);
    if (observer) session.setObserver(observer);
    this.sessions.set(constraints.executionIntentId, session);
    return { session, duplicate: false };
  }

  async tickAll(): Promise<void> {
    for (const session of this.openSessions) await session.tick();
  }

  async cancelAll(): Promise<void> {
    for (const session of this.openSessions) await session.cancel();
  }

  snapshot(): readonly ExecutionSessionSnapshot[] {
    return [...this.sessions.values()]
      .map((session) => session.snapshot())
      .sort((a, b) => (a.executionIntentId < b.executionIntentId ? -1 : 1));
  }

  /** Rebuilds every session after a restart. */
  restore(snapshots: readonly ExecutionSessionSnapshot[]): void {
    for (const snapshot of snapshots) {
      this.sessions.set(
        snapshot.executionIntentId,
        StandingOrderSession.restore(snapshot, this.options),
      );
    }
  }
}
