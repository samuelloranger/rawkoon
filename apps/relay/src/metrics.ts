// Content-free counters. The relay deliberately logs no notification content,
// which left no way to tell abuse from an instance stuck in a loop — these are
// the smallest counters that answer that without recording anything private.
// Never add a title, body, raw device token, or IP to this module.

export type PushOutcome =
  | "ok"
  | "unregistered"
  | "rejected"
  | "retry"
  | "transport_error"
  | "rate_limited_ip"
  | "rate_limited_token"
  | "untrusted_peer"
  | "invalid_request"
  | "payload_too_large";

// APNs rejection reasons are a closed set of Apple-defined strings, so counting
// them by name leaks nothing about who sent what.
const MAX_TRACKED_REASONS = 40;

export class Metrics {
  private readonly outcomes = new Map<PushOutcome, number>();
  private readonly reasons = new Map<string, number>();
  private readonly startedAt: number;
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private consecutiveFailures = 0;

  constructor(private readonly now: () => number = () => Date.now()) {
    this.startedAt = this.now();
  }

  record(outcome: PushOutcome, reason?: string): void {
    this.outcomes.set(outcome, (this.outcomes.get(outcome) ?? 0) + 1);

    if (reason && this.reasons.size < MAX_TRACKED_REASONS) {
      this.reasons.set(reason, (this.reasons.get(reason) ?? 0) + 1);
    }

    // A 410 means the app was uninstalled — that is a healthy relay reporting a
    // dead token, not a delivery failure, so it must not trip the health probe.
    if (outcome === "ok") {
      this.lastSuccessAt = this.now();
      this.consecutiveFailures = 0;
    } else if (outcome === "transport_error" || outcome === "retry") {
      this.lastFailureAt = this.now();
      this.consecutiveFailures += 1;
    }
  }

  /**
   * Enough consecutive upstream failures that the credential or Apple is
   * suspect. A recent success clears it, so an Apple throttling burst on an
   * otherwise-delivering relay does not flap the container unhealthy.
   */
  get upstreamLooksBroken(): boolean {
    if (this.consecutiveFailures < 5) return false;
    if (this.lastSuccessAt === null) return true;
    return this.now() - this.lastSuccessAt > 5 * 60_000;
  }

  snapshot(): Record<string, unknown> {
    return {
      uptimeSeconds: Math.floor((this.now() - this.startedAt) / 1000),
      outcomes: Object.fromEntries(this.outcomes),
      apnsReasons: Object.fromEntries(this.reasons),
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      consecutiveFailures: this.consecutiveFailures,
    };
  }
}
