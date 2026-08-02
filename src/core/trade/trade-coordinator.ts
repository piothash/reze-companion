/**
 * ARC — Trade Coordinator (M3).
 *
 * Wires the Trade Domain together: risk evaluation, exposure reservation,
 * execution adaptation, the Standing Limit Order Engine, canonical events and
 * the settlement hook.
 *
 * The coordinator makes no trading decisions. It receives an ExecutionIntent
 * that the Decision Domain already produced and answers one question: may this
 * be executed, and if so, execute it exactly once.
 */
import { type EventEnvelopeFactory, type EventSink } from "../contracts/event-envelope";
import { type Clock } from "../shared/time";
import { type TradeDomainConfig } from "./configuration";
import { TradeEventPublisher, type TradeEventContext } from "./events";
import { adaptIntent, type AdaptableIntent } from "./execution-adapter";
import { ExposureLedger } from "./exposure";
import { evaluateRisk } from "./risk-engine";
import {
  StandingOrderEngine,
  type StandingOrderObserver,
  type StandingOrderSession,
  type VenueFillEvent,
} from "./standing-order-engine";
import {
  type ExecutionReport,
  type ExecutionSessionSnapshot,
  type RiskInput,
  type RiskVerdict,
} from "./types";
import { type VenueGateway } from "./venue-gateway";

/** Observable market conditions risk is allowed to see. No strategy inputs. */
export interface TradeConditions {
  marketValid: boolean;
  marketTradable: boolean;
  feedFreshnessState: "FRESH" | "STALE" | "UNAVAILABLE";
  feedAgeMillis: number | null;
  outcomePosition: number;
  availableLiquidity: number | null;
  spread: number | null;
  /** Ceiling the engine may pay; supplied by venue data, never derived here. */
  maxPrice: number;
  outcomeKeys: { BUY_UP: string; BUY_DOWN: string };
}

export interface TradeCoordinatorOptions {
  config: TradeDomainConfig;
  gateway: VenueGateway;
  clock: Clock;
  eventFactory: EventEnvelopeFactory;
  eventSink: EventSink;
  marketInstanceId: string;
  /** Live exposure carried in from a previous run. */
  initialLiveExposure?: number;
  /** Called once per execution intent that reaches a meaningful fill. */
  onQuotaCommit?: (executionIntentId: string) => Promise<void> | void;
  /** Settlement hook. Fired exactly once per execution intent. */
  onSettlement?: (report: ExecutionReport) => Promise<void> | void;
}

export type SubmitOutcome =
  | { accepted: true; session: StandingOrderSession; verdict: RiskVerdict }
  | { accepted: false; reason: "RISK_DENIED"; verdict: RiskVerdict }
  | { accepted: false; reason: "EXPOSURE_UNAVAILABLE"; verdict: RiskVerdict }
  | { accepted: false; reason: "DUPLICATE"; verdict: RiskVerdict | null };

export class TradeCoordinator {
  readonly ledger: ExposureLedger;
  readonly engine: StandingOrderEngine;
  private readonly events: TradeEventPublisher;
  private readonly settled = new Set<string>();

  constructor(private readonly options: TradeCoordinatorOptions) {
    this.ledger = new ExposureLedger({
      marketInstanceId: options.marketInstanceId,
      limit: options.config.risk.maxExposure,
      clock: options.clock,
      ...(options.initialLiveExposure !== undefined
        ? { initialLiveExposure: options.initialLiveExposure }
        : {}),
    });
    this.events = new TradeEventPublisher(options.eventFactory, options.eventSink);
    this.engine = new StandingOrderEngine({ gateway: options.gateway, clock: options.clock });
  }

  get publishedEvents() {
    return this.events.published;
  }

  /**
   * Risk-evaluates an intent, reserves exposure and opens a standing order
   * session. A repeated intent id is suppressed, so a restart cannot place a
   * duplicate order.
   */
  async submit(
    intent: AdaptableIntent & { riskProfileVersion: string },
    conditions: TradeConditions,
  ): Promise<SubmitOutcome> {
    const context: TradeEventContext = {
      correlationId: intent.correlationId,
      marketInstanceId: intent.marketInstanceId,
      executionIntentId: intent.executionIntentId,
    };

    if (this.engine.session(intent.executionIntentId)) {
      return { accepted: false, reason: "DUPLICATE", verdict: null };
    }

    const riskInput: RiskInput = {
      executionIntentId: intent.executionIntentId,
      marketInstanceId: intent.marketInstanceId,
      riskProfileVersion: intent.riskProfileVersion,
      requestedExposure: intent.positionSize,
      requestedQuantity: intent.positionSize / conditions.maxPrice,
      outcomeKey: conditions.outcomeKeys[intent.side],
      killSwitchEngaged: this.options.config.risk.killSwitch,
      marketValid: conditions.marketValid,
      marketTradable: conditions.marketTradable,
      feedFreshnessState: conditions.feedFreshnessState,
      feedAgeMillis: conditions.feedAgeMillis,
      liveExposure: this.ledger.live,
      reservedExposure: this.ledger.reserved,
      outcomePosition: conditions.outcomePosition,
      availableLiquidity: conditions.availableLiquidity,
      spread: conditions.spread,
    };

    const verdict = evaluateRisk(riskInput, {
      profile: this.options.config.risk,
      evaluatedAtIso: this.options.clock.isoNow(),
    });

    if (verdict.decision === "DENY") {
      await this.events.riskDenied(verdict, context);
      return { accepted: false, reason: "RISK_DENIED", verdict };
    }
    await this.events.riskApproved(verdict, context);

    const reservation = this.ledger.reserve({
      executionIntentId: intent.executionIntentId,
      outcomeKey: conditions.outcomeKeys[intent.side],
      amount: intent.positionSize,
    });
    if (!reservation.ok) {
      return { accepted: false, reason: "EXPOSURE_UNAVAILABLE", verdict };
    }
    await this.events.exposureReserved(
      { reservation: reservation.reservation, exposure: this.ledger.snapshot() },
      context,
    );

    const constraints = adaptIntent(intent, {
      outcomeKeys: conditions.outcomeKeys,
      maxPrice: conditions.maxPrice,
      execution: this.options.config.execution,
    });

    const { session, duplicate } = this.engine.open(
      constraints,
      this.buildObserver(context, constraints.minMeaningfulQuantity),
    );
    if (duplicate) return { accepted: false, reason: "DUPLICATE", verdict };

    await session.start();
    return { accepted: true, session, verdict };
  }

  private buildObserver(context: TradeEventContext, minMeaningfulQuantity: number): StandingOrderObserver {
    const options = this.options;
    const events = this.events;
    const ledger = this.ledger;
    const settled = this.settled;

    return {
      onOrderSubmitted: async (order) => {
        await events.orderSubmitted(order, context);
      },
      onOrderUpdated: async (order) => {
        await events.orderUpdated(order, context);
      },
      onOrderCancelled: async (order) => {
        await events.orderCancelled(order, context);
      },
      onOrderFilled: async (order, fill, cumulative, complete) => {
        ledger.commit(context.executionIntentId, fill.quantity * fill.price);
        await events.orderFilled(
          { order, fill, cumulativeFilledQuantity: cumulative, complete },
          context,
        );
      },
      onFirstMeaningfulFill: async (cumulative) => {
        await events.tradeQuotaConsumed(
          {
            executionIntentId: context.executionIntentId,
            cumulativeFilledQuantity: cumulative,
            minMeaningfulQuantity,
          },
          context,
        );
        await options.onQuotaCommit?.(context.executionIntentId);
      },
      onTerminal: async (report) => {
        if (settled.has(report.executionIntentId)) return;
        settled.add(report.executionIntentId);

        const record = ledger.settle(report.executionIntentId);
        if (record) {
          await events.exposureReleased(
            {
              reservation: record,
              exposure: ledger.snapshot(),
              reason: report.failureReason ? "EXECUTION_FAILED" : "EXECUTION_COMPLETED",
            },
            context,
          );
        }

        if (report.failureReason && report.cumulativeFilledQuantity === 0) {
          await events.executionFailed({ report, failureReason: report.failureReason }, context);
        } else {
          await events.executionCompleted(report, context);
        }
        await options.onSettlement?.(report);
      },
    };
  }

  applyFill(event: VenueFillEvent & { executionIntentId: string }): Promise<boolean> {
    const session = this.engine.session(event.executionIntentId);
    if (!session) return Promise.resolve(false);
    return session.applyFill(event);
  }

  tick(): Promise<void> {
    return this.engine.tickAll();
  }

  snapshot(): readonly ExecutionSessionSnapshot[] {
    return this.engine.snapshot();
  }
}
