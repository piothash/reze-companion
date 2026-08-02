/**
 * ARC — Venue gateway port (M3).
 *
 * The boundary between the Standing Limit Order Engine and whatever actually
 * talks to a venue. The port is deliberately dumb: submit, cancel, read the
 * book. It carries no strategy, no retry policy and no state machine — those
 * belong to the engine, which is what makes the engine deterministic and
 * replayable against a recorded gateway.
 */
import { type TimeInForce } from "./types";

export interface OrderRequest {
  /** Deterministic ARC order id; used as the client order id. */
  orderId: string;
  outcomeKey: string;
  quantity: number;
  limitPrice: number;
  timeInForce: TimeInForce;
  postOnly: boolean;
}

export interface BookSnapshot {
  outcomeKey: string;
  bestBid: number | null;
  bestAsk: number | null;
  /** Size resting at the best bid, used for passive maker sizing. */
  bidSize: number;
  askSize: number;
  observedAtIso: string;
}

export type SubmitResult =
  | { accepted: true; venueOrderId: string; immediateFillQuantity?: number; immediateFillPrice?: number }
  | { accepted: false; rejectionReason: string; retryable: boolean };

export type CancelResult =
  | { cancelled: true }
  | { cancelled: false; reason: string; alreadyTerminal: boolean };

export interface VenueGateway {
  submit(request: OrderRequest): Promise<SubmitResult>;
  cancel(venueOrderId: string): Promise<CancelResult>;
  book(outcomeKey: string): Promise<BookSnapshot | null>;
}

/**
 * Deterministic in-memory gateway used by tests and replay. It records every
 * call so a run can be diffed byte-for-byte against a previous one.
 */
export class RecordingVenueGateway implements VenueGateway {
  readonly submissions: OrderRequest[] = [];
  readonly cancellations: string[] = [];

  constructor(
    private readonly behaviour: {
      book?: BookSnapshot | null;
      /** Consumed in order; the last entry repeats once exhausted. */
      submitResults?: readonly SubmitResult[];
      cancelResults?: readonly CancelResult[];
    } = {},
  ) {}

  private submitIndex = 0;
  private cancelIndex = 0;

  async submit(request: OrderRequest): Promise<SubmitResult> {
    this.submissions.push({ ...request });
    const results = this.behaviour.submitResults;
    if (!results || results.length === 0) {
      return { accepted: true, venueOrderId: `venue-${request.orderId}` };
    }
    const index = Math.min(this.submitIndex, results.length - 1);
    this.submitIndex += 1;
    return results[index]!;
  }

  async cancel(venueOrderId: string): Promise<CancelResult> {
    this.cancellations.push(venueOrderId);
    const results = this.behaviour.cancelResults;
    if (!results || results.length === 0) return { cancelled: true };
    const index = Math.min(this.cancelIndex, results.length - 1);
    this.cancelIndex += 1;
    return results[index]!;
  }

  async book(outcomeKey: string): Promise<BookSnapshot | null> {
    const snapshot = this.behaviour.book;
    if (snapshot === undefined) return null;
    if (snapshot === null) return null;
    return { ...snapshot, outcomeKey };
  }
}
