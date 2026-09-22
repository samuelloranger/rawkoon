import type {
  ReleasedTorrent,
  SeedingResponse,
  SeedStateEvent,
} from "@rawkoon/shared/types";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Fold a seed-state push into the cached Seeding list without a refetch. */
export function mergeSeedState(
  current: SeedingResponse | undefined,
  event: SeedStateEvent,
): SeedingResponse | undefined {
  if (!current) return current;
  const updates = new Map(event.torrents.map((i) => [i.hash, i]));
  const released: ReleasedTorrent[] = [];
  const torrents = current.torrents.flatMap((row) => {
    const item = updates.get(row.hash);
    if (!item) return [row];
    if (item.released) {
      released.push({
        hash: row.hash,
        title: row.title,
        reason: item.released.reason,
        released_at: item.released.at,
        size_bytes: item.released.freedBytes ?? row.size_bytes,
      });
      return [];
    }
    const ratio_pct = row.rule.ratio
      ? clamp01((item.ratio ?? 0) / row.rule.ratio)
      : null;
    const time_pct = row.rule.seed_time_mins
      ? clamp01((item.seedingTimeSecs ?? 0) / (row.rule.seed_time_mins * 60))
      : null;
    const target_met = row.target_met || item.etaSecs === 0;
    return [
      {
        ...row,
        ratio: item.ratio,
        seeding_time_secs: item.seedingTimeSecs,
        up_speed: item.upSpeed,
        eta_secs: item.etaSecs,
        ratio_pct,
        time_pct,
        target_met,
        owes_seed_time: row.is_private && !target_met,
      },
    ];
  });
  torrents.sort(
    (a, b) =>
      (a.eta_secs ?? Number.POSITIVE_INFINITY) -
      (b.eta_secs ?? Number.POSITIVE_INFINITY),
  );
  const seen = new Set(released.map((r) => r.hash));
  return {
    ...current,
    torrents,
    released_today: [
      ...released,
      ...current.released_today.filter((r) => !seen.has(r.hash)),
    ],
  };
}
