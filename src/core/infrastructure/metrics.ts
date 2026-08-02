/**
 * ARC — metrics abstraction (P0/M0).
 *
 * Infrastructure metrics only (call volume, latency, error rate, health).
 * No business or trading metrics exist at this milestone. The registry exposes
 * a Prometheus text rendering so a future exporter needs no code change here.
 */
import { type Clock, systemClock } from "../shared/time";

export type MetricKind = "counter" | "gauge" | "histogram";
export type MetricLabels = Readonly<Record<string, string>>;

export interface MetricSample {
  name: string;
  kind: MetricKind;
  labels: MetricLabels;
  value: number;
  /** Present for histograms only. */
  count?: number;
  sum?: number;
  buckets?: Record<string, number>;
  timestamp: string;
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];

function labelKey(name: string, labels: MetricLabels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1));
  return `${name}{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}`;
}

interface HistogramState {
  count: number;
  sum: number;
  buckets: number[];
}

export class MetricsRegistry {
  private readonly counters = new Map<
    string,
    { name: string; labels: MetricLabels; value: number }
  >();
  private readonly gauges = new Map<
    string,
    { name: string; labels: MetricLabels; value: number }
  >();
  private readonly histograms = new Map<
    string,
    { name: string; labels: MetricLabels; state: HistogramState }
  >();

  constructor(
    private readonly namespace = "arc",
    private readonly clock: Clock = systemClock,
    private readonly buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {}

  private qualify(name: string): string {
    return name.startsWith(`${this.namespace}_`) ? name : `${this.namespace}_${name}`;
  }

  increment(name: string, labels: MetricLabels = {}, delta = 1): void {
    const qualified = this.qualify(name);
    const key = labelKey(qualified, labels);
    const existing = this.counters.get(key);
    if (existing) existing.value += delta;
    else this.counters.set(key, { name: qualified, labels, value: delta });
  }

  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    const qualified = this.qualify(name);
    this.gauges.set(labelKey(qualified, labels), { name: qualified, labels, value });
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const qualified = this.qualify(name);
    const key = labelKey(qualified, labels);
    const entry =
      this.histograms.get(key) ??
      (() => {
        const created = {
          name: qualified,
          labels,
          state: { count: 0, sum: 0, buckets: this.buckets.map(() => 0) },
        };
        this.histograms.set(key, created);
        return created;
      })();

    entry.state.count += 1;
    entry.state.sum += value;
    this.buckets.forEach((bound, index) => {
      if (value <= bound) entry.state.buckets[index] = (entry.state.buckets[index] ?? 0) + 1;
    });
  }

  /** Times an async operation and records duration plus outcome. */
  async time<T>(name: string, labels: MetricLabels, operation: () => Promise<T>): Promise<T> {
    const started = this.clock.monotonic();
    try {
      const result = await operation();
      this.observe(name, this.clock.monotonic() - started, { ...labels, outcome: "success" });
      return result;
    } catch (error) {
      this.observe(name, this.clock.monotonic() - started, { ...labels, outcome: "error" });
      this.increment(`${name}_errors_total`, labels);
      throw error;
    }
  }

  snapshot(): MetricSample[] {
    const timestamp = this.clock.isoNow();
    const samples: MetricSample[] = [];

    for (const entry of this.counters.values()) {
      samples.push({
        name: entry.name,
        kind: "counter",
        labels: entry.labels,
        value: entry.value,
        timestamp,
      });
    }
    for (const entry of this.gauges.values()) {
      samples.push({
        name: entry.name,
        kind: "gauge",
        labels: entry.labels,
        value: entry.value,
        timestamp,
      });
    }
    for (const entry of this.histograms.values()) {
      const buckets: Record<string, number> = {};
      this.buckets.forEach((bound, index) => {
        buckets[String(bound)] = entry.state.buckets[index] ?? 0;
      });
      samples.push({
        name: entry.name,
        kind: "histogram",
        labels: entry.labels,
        value: entry.state.count === 0 ? 0 : entry.state.sum / entry.state.count,
        count: entry.state.count,
        sum: entry.state.sum,
        buckets,
        timestamp,
      });
    }

    return samples;
  }

  /** Prometheus exposition format; future scrapers need no additional code. */
  renderPrometheus(): string {
    return this.snapshot()
      .map((sample) => {
        const labels = Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        const suffix = labels ? `{${labels}}` : "";
        if (sample.kind !== "histogram") return `${sample.name}${suffix} ${sample.value}`;
        const lines = Object.entries(sample.buckets ?? {}).map(
          ([bound, count]) =>
            `${sample.name}_bucket{${labels ? `${labels},` : ""}le="${bound}"} ${count}`,
        );
        lines.push(`${sample.name}_sum${suffix} ${sample.sum ?? 0}`);
        lines.push(`${sample.name}_count${suffix} ${sample.count ?? 0}`);
        return lines.join("\n");
      })
      .join("\n");
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

export function createMetricsRegistry(
  namespace = "arc",
  clock: Clock = systemClock,
): MetricsRegistry {
  return new MetricsRegistry(namespace, clock);
}
