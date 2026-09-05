/**
 * Percentile helpers for the perf-baseline report. Pure functions — no I/O — so
 * they are unit-tested directly.
 *
 * Uses the nearest-rank method: for a percentile p (0–100) over n sorted
 * samples, the rank is ceil(p/100 * n), and the value is the sample at that
 * 1-based rank (clamped to [1, n]). p50 of ten samples 1..10 is therefore the
 * 5th (value 5); p95 is the 10th (value 10). Nearest-rank needs no
 * interpolation and always returns an actually-observed value, which is what a
 * latency baseline wants.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (p <= 0) {
    return Math.min(...values);
  }
  if (p >= 100) {
    return Math.max(...values);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[index];
}

export interface PercentileSummary {
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

/** Summarize a set of samples (e.g. per-route latencies in ms). */
export function summarize(values: number[]): PercentileSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, mean: 0 };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    mean: sum / values.length,
  };
}
