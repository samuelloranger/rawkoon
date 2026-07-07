// Serializes async work per string key: calls sharing a key run one at a time,
// in arrival order. Prevents check-then-act races on the same resource (a media
// item, a destination path) within this process.
//
// ponytail: in-process only — assumes a single API/worker instance. If Rawkoon
// is ever run multi-instance, replace with a Postgres advisory lock keyed the same.
const chains = new Map<string, Promise<unknown>>();

export function withKeyedLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = (chains.get(key) ?? Promise.resolve()).catch(() => {});
  const run = prev.then(() => fn());
  chains.set(key, run);
  // Drop the key once this run settles and nothing newer is queued behind it.
  run
    .catch(() => {})
    .finally(() => {
      if (chains.get(key) === run) chains.delete(key);
    });
  return run;
}
