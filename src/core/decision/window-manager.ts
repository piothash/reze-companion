/**
 * ARC — Execution Window Manager (M2).
 *
 * Owns window lifecycle only. The scheduler owns timing; this manager owns
 * creation, ordering, activation, evaluation dispatch, intent emission and
 * completion. It does NOT own risk, execution, orders or settlement.
 */
import { EventEnvelopeFactory, type EventSink } from "../contracts/event-envelope";
import { versionManifest, versionOf } from "../contracts/versions";
import { type AuthoritativeMarketState } from "../market/types";
import { Ids } from "../shared/ids";
import { fromIsoUtc, toIsoUtc, type Clock } from "../shared/time";
import {
  executionProfileDigest,
  offsetToMillis,
  windowDefinitionIdFor,
  type ExecutionProfile,
} from "./configuration";
import { decide } from "./decision-engine";
import { DecisionEventPublisher, type DecisionEventContext } from "./events";
import { ExecutionContext } from "./execution-context";
import {
  executionIntentSchema,
  freezeDeep,
  windowConfigurationSnapshotSchema,
  type Decision,
  type ExecutionIntent,
  type WindowCompletionReason,
  type WindowConfigurationSnapshot,
} from "./types";
import { digest128 } from "../shared/ids";
import { WindowInstance } from "./window-instance";

export interface WindowManagerOptions {
  profile: ExecutionProfile;
  clock: Clock;
  sink: EventSink;
  /** Platform configuration version referenced by frozen snapshots. */
  configVersion?: string;
  publisher?: DecisionEventPublisher;
}

export interface MarketWindowTarget {
  marketInstanceId: string;
  /** Official resolution timestamp of the market instance, ISO-8601 UTC. */
  resolvesAtIso: string;
}

export interface EvaluationOutcome {
  windowInstanceId: string;
  decision: Decision | null;
  intent: ExecutionIntent | null;
  suppressed: boolean;
  completionReason: WindowCompletionReason | null;
}

/** Resolves global → per-window inheritance and freezes the result. */
export function resolveWindowConfiguration(
  profile: ExecutionProfile,
  window: ExecutionProfile["windows"][number],
): WindowConfigurationSnapshot {
  const offsetMillis = offsetToMillis(window.offset, window.unit);
  const draft = {
    configurationSnapshotId: "",
    executionProfileId: profile.executionProfileId,
    executionProfileVersion: profile.executionProfileVersion,
    bufferProfileVersion: profile.bufferProfileVersion,
    riskProfileVersion: profile.riskProfileVersion,
    executionMode: profile.executionMode,
    triggerMode: profile.triggerMode,
    limitMode: profile.limitMode,
    compounding: profile.compounding,
    tickPolicy: profile.tickPolicy,
    tickSize: profile.tickSize,
    bufferMode: profile.bufferMode,
    offset: window.offset,
    unit: window.unit,
    offsetMillis,
    twapBuffer: window.twapBuffer,
    positionSize: window.positionSizeOverride ?? profile.positionSize,
    retryCount: window.retryCountOverride ?? profile.retryCount,
    windowActiveMillis: profile.windowActiveMillis,
    timeoutMillis: profile.timeoutMillis,
    repricingEnabled: profile.repricingEnabled,
    repricingIntervalMillis: profile.repricingIntervalMillis,
    repricingMaxAttempts: profile.repricingMaxAttempts,
    minLiquidity: profile.minLiquidity,
    maxSpread: profile.maxSpread,
    precision: profile.precision,
  };
  const { configurationSnapshotId: _ignored, ...material } = draft;
  const configurationSnapshotId = `cfg_${digest128(
    `${executionProfileDigest(profile)}\u0000${JSON.stringify(material)}`,
  )}`;
  return freezeDeep(windowConfigurationSnapshotSchema.parse({ ...draft, configurationSnapshotId }));
}

export class ExecutionWindowManager {
  readonly events: DecisionEventPublisher;
  private context: ExecutionContext | null = null;
  private target: MarketWindowTarget | null = null;
  private correlationIdValue = "";

  constructor(private readonly options: WindowManagerOptions) {
    this.events =
      options.publisher ??
      new DecisionEventPublisher(new EventEnvelopeFactory(options.clock, "decision"), options.sink);
  }

  get executionContext(): ExecutionContext | null {
    return this.context;
  }

  get correlationId(): string {
    return this.correlationIdValue;
  }

  private ctx(windowInstanceId?: string, executionIntentId?: string): DecisionEventContext {
    return {
      correlationId: this.correlationIdValue,
      marketInstanceId: this.target?.marketInstanceId ?? "unknown",
      ...(windowInstanceId ? { windowInstanceId } : {}),
      ...(executionIntentId ? { executionIntentId } : {}),
    };
  }

  /**
   * Loads the execution profile, creates one window instance per enabled
   * definition, sorts by descending priority and opens each window.
   */
  async prepare(target: MarketWindowTarget): Promise<ExecutionContext> {
    const { profile, clock } = this.options;
    this.target = target;
    this.correlationIdValue = Ids.correlation(
      "decision",
      target.marketInstanceId,
      profile.executionProfileId,
    );

    const quota = profile.executionMode === "SINGLE_TRADE" ? 1 : profile.maxTrades;
    const context = new ExecutionContext({
      marketInstanceId: target.marketInstanceId,
      executionProfileId: profile.executionProfileId,
      quota,
    });
    this.context = context;

    const resolvesAt = fromIsoUtc(target.resolvesAtIso);
    const enabled = profile.windows.filter((window) => window.enabled);
    // Priority is derived from the offset, never configured: the largest
    // offset activates first and therefore ranks highest.
    const ordered = [...enabled].sort(
      (a, b) => offsetToMillis(b.offset, b.unit) - offsetToMillis(a.offset, a.unit),
    );

    let sequence = 0;
    for (const definition of ordered) {
      const configuration = resolveWindowConfiguration(profile, definition);
      const activatesAt = resolvesAt - configuration.offsetMillis;
      const expiresAt = Math.min(activatesAt + configuration.windowActiveMillis, resolvesAt);
      const windowDefinitionId = windowDefinitionIdFor(
        profile.executionProfileId,
        definition.offset,
        definition.unit,
      );
      const instance = new WindowInstance({
        windowInstanceId: Ids.windowInstance(
          target.marketInstanceId,
          windowDefinitionId,
          String(sequence),
        ),
        windowDefinitionId,
        marketInstanceId: target.marketInstanceId,
        executionContextId: context.executionContextId,
        sequence,
        priority: configuration.offsetMillis,
        offset: definition.offset,
        unit: definition.unit,
        configuration,
        activatesAtIso: toIsoUtc(activatesAt),
        expiresAtIso: toIsoUtc(expiresAt),
        tradeQuotaAtCreation: context.quota.remaining,
        clock,
      });
      instance.open();
      context.registerWindow(instance);
      await this.events.windowOpened(instance.snapshot(), this.ctx(instance.id));
      sequence += 1;
    }

    return context;
  }

  /**
   * Scheduler-driven tick: activates due windows and completes expired ones.
   * Timing is owned by the scheduler; this method only applies lifecycle.
   */
  async tick(nowMillis: number = this.options.clock.now()): Promise<void> {
    const context = this.context;
    if (!context) return;

    for (const window of context.orderedWindows()) {
      if (window.isCompleted) continue;
      const activatesAt = fromIsoUtc(window.activatesAtIso);
      const expiresAt = fromIsoUtc(window.expiresAtIso);

      if (window.state === "WAITING" && nowMillis >= activatesAt) {
        // Quota is always checked before anything else; when it is exhausted
        // the Decision Engine is never invoked for this window.
        if (context.quota.exhausted) {
          await this.completeWindow(window.id, "QUOTA_EXHAUSTED");
          continue;
        }
        window.activate();
        await this.events.windowActivated(window.snapshot(), this.ctx(window.id));
      }

      if (nowMillis >= expiresAt && !window.isCompleted) {
        const snapshot = window.snapshot();
        const reason: WindowCompletionReason = window.hasIntent
          ? "NOT_FILLED"
          : snapshot.evaluationCount > 0
            ? "NO_SIGNAL"
            : "EXPIRED";
        await this.completeWindow(window.id, reason);
      }
    }
  }

  /**
   * Every AuthoritativeMarketStateUpdated triggers a fresh, stateless
   * evaluation of every ACTIVE window, in descending priority order.
   */
  async onMarketState(state: AuthoritativeMarketState): Promise<EvaluationOutcome[]> {
    const context = this.context;
    if (!context) return [];
    const outcomes: EvaluationOutcome[] = [];
    for (const window of context.orderedWindows()) {
      // EXECUTING windows are still visited so the suppression is explicit and
      // auditable: one window produces at most one ExecutionIntent.
      if (window.state !== "ACTIVE" && window.state !== "EXECUTING") continue;
      outcomes.push(await this.evaluateWindow(window, state));
    }
    return outcomes;
  }

  private async evaluateWindow(
    window: WindowInstance,
    state: AuthoritativeMarketState,
  ): Promise<EvaluationOutcome> {
    const context = this.context!;

    // Invariant: one window produces at most one ExecutionIntent, ever.
    if (window.hasIntent) {
      return {
        windowInstanceId: window.id,
        decision: null,
        intent: null,
        suppressed: true,
        completionReason: null,
      };
    }

    // Quota check happens BEFORE the Decision Engine is invoked.
    if (context.quota.exhausted) {
      await this.completeWindow(window.id, "QUOTA_EXHAUSTED");
      return {
        windowInstanceId: window.id,
        decision: null,
        intent: null,
        suppressed: false,
        completionReason: "QUOTA_EXHAUSTED",
      };
    }

    window.beginEvaluation(state.marketStateVersion);
    const decision = decide({
      marketState: state,
      windowInstanceId: window.id,
      configuration: window.configuration,
    });
    await this.events.windowEvaluated(decision, this.ctx(window.id));

    if (decision.outcome === "NO_SIGNAL") {
      window.inconclusive();
      return {
        windowInstanceId: window.id,
        decision,
        intent: null,
        suppressed: false,
        completionReason: null,
      };
    }

    const intent = this.buildIntent(window, state, decision);
    window.attachIntent(intent.executionIntentId);
    context.recordIntent();
    context.quota.consume();

    await this.events.executionIntentCreated(intent, {
      ...this.ctx(window.id, intent.executionIntentId),
    });
    await this.events.tradeQuotaConsumed(
      {
        windowInstanceId: window.id,
        executionIntentId: intent.executionIntentId,
        quota: context.quota.snapshot(),
      },
      this.ctx(window.id, intent.executionIntentId),
    );

    return {
      windowInstanceId: window.id,
      decision,
      intent,
      suppressed: false,
      completionReason: null,
    };
  }

  private buildIntent(
    window: WindowInstance,
    state: AuthoritativeMarketState,
    decision: Decision,
  ): ExecutionIntent {
    const configuration = window.configuration;
    const executionIntentId = Ids.executionIntent(
      window.id,
      String(state.marketStateVersion),
      decision.outcome,
    );
    return freezeDeep(
      executionIntentSchema.parse({
        executionIntentId,
        marketInstanceId: state.marketInstanceId,
        windowInstanceId: window.id,
        correlationId: this.correlationIdValue,
        marketStateVersion: state.marketStateVersion,
        configurationSnapshotId: configuration.configurationSnapshotId,
        executionProfileVersion: configuration.executionProfileVersion,
        bufferProfileVersion: configuration.bufferProfileVersion,
        riskProfileVersion: configuration.riskProfileVersion,
        engineVersions: versionManifest(),
        platformVersion: versionOf("platform"),
        side: decision.outcome as "BUY_UP" | "BUY_DOWN",
        positionSize: configuration.positionSize,
        retryCount: configuration.retryCount,
        referenceEffectiveTwap: decision.effectiveTwap ?? 0,
        referencePtb: decision.ptb ?? 0,
        appliedBuffer: decision.appliedBuffer,
        createdAtIso: this.options.clock.isoNow(),
      } satisfies ExecutionIntent),
    );
  }

  /** Completes a window exactly once and publishes WindowCompleted. */
  async completeWindow(windowInstanceId: string, reason: WindowCompletionReason): Promise<boolean> {
    const context = this.context;
    const window = context?.window(windowInstanceId);
    if (!context || !window) return false;
    if (!window.complete(reason, context.quota.remaining)) return false;
    await this.events.windowCompleted(
      { window: window.snapshot(), completionReason: reason },
      this.ctx(window.id),
    );
    return true;
  }

  /** Cancels every window that has not yet completed. */
  async cancelAll(reason: WindowCompletionReason = "CANCELLED"): Promise<void> {
    const context = this.context;
    if (!context) return;
    for (const window of context.orderedWindows()) {
      if (!window.isCompleted) await this.completeWindow(window.id, reason);
    }
  }
}
