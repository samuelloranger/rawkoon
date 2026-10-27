import { prisma } from "@rawkoon/api/db";
import { parseReleaseTitle } from "@rawkoon/api/utils/medias/filenameParser";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";

/** Candidates kept per target; the rest can't win ranking anyway. */
const MAX_PENDING_PER_TARGET = 10;

/** What a grab is FOR; mirrors the grabRelease target (movie, episode or season pack). */
export type DelayTarget = {
  mediaId: number;
  episodeId: number | null;
  season: number | null;
};

export type DelaySettings = { minutes: number; bypassIfCutoffMet: boolean };

export type DelayCandidate = {
  release: NormalizedRelease;
  score: number;
  resolution: number | null;
};

export type DelayDecision = { delay: false } | { delay: true; grabAfter: Date };

export function toDelayCandidate(
  release: NormalizedRelease,
  score: number,
): DelayCandidate {
  return {
    release,
    score,
    resolution: parseReleaseTitle(release.title).resolution,
  };
}

export function targetKey(t: DelayTarget): string {
  if (t.episodeId != null) return `e:${t.episodeId}`;
  if (t.season != null) return `s:${t.mediaId}:${t.season}`;
  return `m:${t.mediaId}`;
}

export function delaySettingsOf(
  profile:
    | { grabDelayMinutes?: number | null; bypassDelayIfCutoffMet?: boolean }
    | null
    | undefined,
): DelaySettings {
  return {
    minutes: Math.max(0, profile?.grabDelayMinutes ?? 0),
    bypassIfCutoffMet: profile?.bypassDelayIfCutoffMet ?? true,
  };
}

/** The scorer rejects anything above the cutoff, so reaching it means nothing better is allowed. */
export function meetsCutoff(
  resolution: number | null,
  cutoffResolution: number | null,
): boolean {
  return (
    cutoffResolution != null &&
    resolution != null &&
    resolution >= cutoffResolution
  );
}

/** Slim copy for the DB: rawPayload can hold indexer tokens and is not needed to re-grab. */
function storableRelease(r: NormalizedRelease): NormalizedRelease {
  const { rawPayload: _omit, ...rest } = r;
  return rest;
}

/**
 * Decide whether an automatic grab for `target` must wait. Called only on the
 * automatic paths (RSS, scheduled search). When it returns delay:true the
 * candidates are stored as pending releases and the caller must not grab.
 *
 * The window runs from the earliest publish time among everything known for the
 * target (falling back to when we first saw a release without one), so a worse
 * release that appeared first starts the clock and a better one arriving inside
 * the window is still collected.
 *
 * A target with held rows belongs to processPendingReleases: unless a new
 * candidate bypasses the delay, the batch joins the held set instead of
 * grabbing, so a better held release that has left the feed isn't lost.
 */
export async function evaluateDelay(opts: {
  target: DelayTarget;
  settings: DelaySettings;
  cutoffResolution: number | null;
  candidates: DelayCandidate[];
  /** Where the grab was initiated; replayed to grabRelease. */
  source?: "rss";
  now?: Date;
}): Promise<DelayDecision> {
  const { target, settings, candidates } = opts;
  const now = opts.now ?? new Date();
  if (settings.minutes <= 0 || candidates.length === 0) return { delay: false };

  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const best = ranked[0]!;
  if (
    settings.bypassIfCutoffMet &&
    meetsCutoff(best.resolution, opts.cutoffResolution)
  ) {
    return { delay: false };
  }

  const key = targetKey(target);
  const existing = await prisma.pendingRelease.findMany({
    where: { targetKey: key },
    select: { releaseGuid: true, createdAt: true, grabAfter: true },
  });
  const firstSeen = new Map(existing.map((e) => [e.releaseGuid, e.createdAt]));
  const delayMs = settings.minutes * 60_000;

  const stored = ranked.slice(0, MAX_PENDING_PER_TARGET).map((c) => {
    const parsed = c.release.publishedAt
      ? new Date(c.release.publishedAt)
      : null;
    // A publish time in the future (indexer clock skew) would stretch the window.
    const published = parsed && parsed.getTime() > now.getTime() ? now : parsed;
    const clock = published ?? firstSeen.get(c.release.guid) ?? now;
    return { c, published, grabAfter: new Date(clock.getTime() + delayMs) };
  });

  const earliest = Math.min(
    ...stored.map((s) => s.grabAfter.getTime()),
    ...existing.map((e) => e.grabAfter.getTime()),
  );
  if (existing.length === 0 && earliest <= now.getTime()) {
    return { delay: false };
  }

  for (const s of stored) {
    const release = storableRelease(s.c.release);
    const data = {
      releaseTitle: s.c.release.title,
      indexer: s.c.release.indexer,
      release: release as object,
      score: s.c.score,
      source: opts.source ?? null,
      publishedAt: s.published,
      grabAfter: s.grabAfter,
    };
    await prisma.pendingRelease.upsert({
      where: {
        targetKey_releaseGuid: {
          targetKey: key,
          releaseGuid: s.c.release.guid,
        },
      },
      create: {
        targetKey: key,
        mediaId: target.mediaId,
        episodeId: target.episodeId,
        season: target.season,
        releaseGuid: s.c.release.guid,
        ...data,
      },
      update: data,
    });
  }
  return { delay: true, grabAfter: new Date(earliest) };
}

/** Drop everything held for a target, e.g. once it has been grabbed. */
export async function clearPending(target: DelayTarget): Promise<void> {
  await prisma.pendingRelease.deleteMany({
    where: { targetKey: targetKey(target) },
  });
}
