/**
 * One in-flight metadata write per book.
 *
 * The override merge is a single SQL statement, so two saves cannot lose each
 * other's keys. But the refresh that follows is a separate read / compute /
 * write, and any two of those overlapping can finish in the opposite order and
 * leave a book's columns disagreeing with its stored overrides. Every path that
 * refreshes a book therefore goes through this queue — the override route and
 * the manual refresh button alike, since a manual refresh racing a save
 * recreates exactly the disagreement the queue exists to prevent.
 *
 * This serializes within a process, which is rawkoon's deployment shape: one
 * API container. It is not a distributed lock and does not pretend to be.
 */

const inFlight = new Map<number, Promise<unknown>>();

export function serializePerBook<T>(
  id: number,
  work: () => Promise<T>,
): Promise<T> {
  const prior = inFlight.get(id) ?? Promise.resolve();
  // Run regardless of whether the previous entry resolved or rejected: one
  // failed save must not block every later one.
  const next = prior.then(work, work);

  /**
   * The chain the map holds must never reject.
   *
   * Deriving the cleanup from `next` directly would create a second promise
   * that rejects whenever the work does, and nothing would be there to catch
   * it — an unhandled rejection, which Bun can turn into a dead process rather
   * than the 500 the caller intended. `settled` absorbs the rejection, and both
   * the queue and the cleanup hang off that instead.
   */
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  inFlight.set(id, settled);
  void settled.then(() => {
    if (inFlight.get(id) === settled) inFlight.delete(id);
  });

  // The caller still sees the real outcome, including a rejection.
  return next;
}
