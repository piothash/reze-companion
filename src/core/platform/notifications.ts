/**
 * ARC — notification framework (M4 Platform Services).
 *
 * Internal framework only. No Telegram, no email, no external channel is
 * implemented in this milestone: notifications are derived from canonical
 * events, deduplicated and handed to registered in-process channels.
 */
import { type EventEnvelope } from "../contracts/event-envelope";
import { REASON_CODES, isReasonCode, type ReasonSeverity } from "../contracts/reason-codes";
import { versionOf } from "../contracts/versions";
import { digest128 } from "../shared/ids";
import { classifyEventType } from "./event-catalog";

export const NOTIFICATION_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_CATEGORIES = [
  "LIFECYCLE",
  "TRADING",
  "RISK",
  "PLATFORM",
  "RECOVERY",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface Notification {
  notificationId: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  title: string;
  body: string;
  reasonCode: string;
  correlationId: string;
  sourceEventId: string;
  createdAtIso: string;
}

export interface NotificationChannel {
  readonly name: string;
  deliver(notification: Notification): Promise<void>;
}

export interface NotificationPreferences {
  minimumSeverity: NotificationSeverity;
  categories: Partial<Record<NotificationCategory, boolean>>;
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

export function severityForReason(severity: ReasonSeverity): NotificationSeverity {
  if (severity === "fatal" || severity === "error") return "CRITICAL";
  if (severity === "warning") return "WARNING";
  return "INFO";
}

export function categoryForEvent(type: string): NotificationCategory {
  if (type.startsWith("trade.risk.")) return "RISK";
  if (type.startsWith("trade.") || classifyEventType(type) === "BUSINESS") return "TRADING";
  if (type.startsWith("decision.")) return "LIFECYCLE";
  if (type.includes("feed") || type.includes("health")) return "RECOVERY";
  return "PLATFORM";
}

/** Derives a notification from an event, or null when the event is routine. */
export function notificationFromEvent(
  envelope: EventEnvelope,
  options: { includeInfo?: boolean } = {},
): Notification | null {
  const code = envelope.metadata.reasonCode;
  const spec = isReasonCode(code) ? REASON_CODES[code] : null;
  const severity = spec ? severityForReason(spec.severity) : "INFO";
  if (severity === "INFO" && !options.includeInfo) return null;

  return {
    notificationId: `ntf_${digest128(`${envelope.eventId}\u0000${code}`)}`,
    severity,
    category: categoryForEvent(envelope.type),
    title: spec?.description ?? envelope.type,
    body: `${envelope.type} (${code}) at ${envelope.occurredAt}`,
    reasonCode: code,
    correlationId: envelope.metadata.correlationId,
    sourceEventId: envelope.eventId,
    createdAtIso: envelope.occurredAt,
  };
}

export interface NotificationEngineOptions {
  preferences?: Partial<NotificationPreferences>;
  includeInfo?: boolean;
}

export class NotificationEngine {
  readonly notificationVersion = versionOf("notification");
  readonly raised: Notification[] = [];
  readonly suppressed: { notificationId: string; reason: string }[] = [];

  private readonly channels: NotificationChannel[] = [];
  private readonly seen = new Set<string>();
  private readonly preferences: NotificationPreferences;
  private readonly includeInfo: boolean;

  constructor(options: NotificationEngineOptions = {}) {
    this.preferences = {
      minimumSeverity: options.preferences?.minimumSeverity ?? "WARNING",
      categories: options.preferences?.categories ?? {},
    };
    this.includeInfo = options.includeInfo ?? false;
  }

  register(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  /** Returns the notification when it was raised, null when suppressed. */
  async ingest(envelope: EventEnvelope): Promise<Notification | null> {
    const notification = notificationFromEvent(envelope, { includeInfo: this.includeInfo });
    if (!notification) return null;
    return this.publish(notification);
  }

  async publish(notification: Notification): Promise<Notification | null> {
    if (this.seen.has(notification.notificationId)) {
      this.suppressed.push({ notificationId: notification.notificationId, reason: "DUPLICATE" });
      return null;
    }
    if (
      SEVERITY_RANK[notification.severity] < SEVERITY_RANK[this.preferences.minimumSeverity] &&
      !this.includeInfo
    ) {
      this.suppressed.push({
        notificationId: notification.notificationId,
        reason: "BELOW_MINIMUM",
      });
      return null;
    }
    if (this.preferences.categories[notification.category] === false) {
      this.suppressed.push({
        notificationId: notification.notificationId,
        reason: "CATEGORY_DISABLED",
      });
      return null;
    }

    this.seen.add(notification.notificationId);
    this.raised.push(notification);
    for (const channel of this.channels) {
      try {
        await channel.deliver(notification);
      } catch {
        // A failing channel must never break event processing (NTF_DELIVERY_FAILED).
      }
    }
    return notification;
  }

  list(severity?: NotificationSeverity): Notification[] {
    return severity ? this.raised.filter((item) => item.severity === severity) : [...this.raised];
  }
}

export class RecordingNotificationChannel implements NotificationChannel {
  readonly name = "recording";
  readonly delivered: Notification[] = [];

  async deliver(notification: Notification): Promise<void> {
    this.delivered.push(notification);
  }
}
