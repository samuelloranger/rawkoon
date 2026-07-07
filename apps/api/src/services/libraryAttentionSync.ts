import { prisma } from "@rawkoon/api/db";
import { Prisma } from "@prisma/client";
import { buildAttentionCandidates } from "@rawkoon/api/services/libraryAttentionCandidates";
import type { AttentionCandidate } from "@rawkoon/api/services/libraryAttentionTypes";
import {
  alertStillValidFromContext,
  buildValidationContext,
} from "@rawkoon/api/services/libraryAttentionSyncValidation";

function matchOpenAlertWhere(c: AttentionCandidate) {
  return {
    status: "open" as const,
    mediaId: c.media_id,
    kind: c.kind,
    scopeType: c.scope_type,
    episodeId: c.episode_id ?? null,
    season: c.season ?? null,
  };
}

export async function syncLibraryAttentionAlerts(): Promise<{
  created: number;
  updated: number;
  resolved: number;
}> {
  const [candidates, existingOpenAlerts] = await Promise.all([
    buildAttentionCandidates(),
    prisma.libraryAttentionAlert.findMany({
      where: { status: "open" },
      select: {
        id: true,
        kind: true,
        scopeType: true,
        mediaId: true,
        episodeId: true,
        season: true,
        downloadHistoryId: true,
      },
    }),
  ]);

  // Map for O(1) upsert lookups — eliminates N findFirst queries
  const alertKey = (r: {
    mediaId: number;
    kind: string;
    scopeType: string;
    episodeId: number | null;
    season: number | null;
  }) =>
    `${r.mediaId}|${r.kind}|${r.scopeType}|${r.episodeId ?? ""}|${r.season ?? ""}`;
  const existingMap = new Map(existingOpenAlerts.map((a) => [alertKey(a), a]));

  let created = 0;
  let updated = 0;

  for (const c of candidates) {
    const key = alertKey({
      mediaId: c.media_id,
      kind: c.kind,
      scopeType: c.scope_type,
      episodeId: c.episode_id ?? null,
      season: c.season ?? null,
    });
    const existing = existingMap.get(key);

    const data = {
      detail: c.detail,
      downloadHistoryId: c.download_history_id,
      searchAttempts: c.search_attempts,
      grabbedAt: c.grabbed_at,
      libraryStatusSnapshot: c.library_status,
    };

    if (existing) {
      await prisma.libraryAttentionAlert.update({
        where: { id: existing.id },
        data,
      });
      updated++;
    } else {
      try {
        await prisma.libraryAttentionAlert.create({
          data: {
            mediaId: c.media_id,
            episodeId: c.episode_id,
            season: c.season,
            scopeType: c.scope_type,
            kind: c.kind,
            status: "open",
            ...data,
          },
        });
        created++;
      } catch (e) {
        const isUniqueViolation =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002";
        if (!isUniqueViolation) {
          console.error(
            "[libraryAttention] create failed (non-unique-violation):",
            e,
          );
          throw e;
        }
        // Race condition: fell back to find + update
        const where = matchOpenAlertWhere(c);
        const existing2 = await prisma.libraryAttentionAlert.findFirst({
          where,
        });
        if (existing2) {
          await prisma.libraryAttentionAlert.update({
            where: { id: existing2.id },
            data,
          });
          updated++;
        }
      }
    }
  }

  // Re-fetch open alerts so downloadHistoryId reflects any updates made in the upsert loop above
  const currentOpenAlerts = await prisma.libraryAttentionAlert.findMany({
    where: { status: "open" },
    select: {
      id: true,
      kind: true,
      scopeType: true,
      mediaId: true,
      episodeId: true,
      season: true,
      downloadHistoryId: true,
    },
  });

  // Pre-fetch all referenced data in parallel, then check validity with no DB queries
  const ctx = await buildValidationContext(currentOpenAlerts);
  const toResolve = currentOpenAlerts
    .filter((row) => !alertStillValidFromContext(row, ctx))
    .map((row) => row.id);

  if (toResolve.length > 0) {
    await prisma.libraryAttentionAlert.updateMany({
      where: { id: { in: toResolve } },
      data: { status: "resolved_auto", resolvedAt: new Date() },
    });
  }

  return { created, updated, resolved: toResolve.length };
}
