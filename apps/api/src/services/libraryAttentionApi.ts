import { prisma } from "@rawkoon/api/db";
import { LIBRARY_ATTENTION_MAX_ITEMS } from "@rawkoon/api/constants/libraryGrab";
import type { LibraryAttentionKind } from "@rawkoon/shared/types";
import {
  attentionKindPriority,
  type LibraryAttentionScopeType,
} from "@rawkoon/api/services/libraryAttentionTypes";

export async function listOpenLibraryAttentionForApi(): Promise<{
  items: Array<{
    id: number;
    kind: LibraryAttentionKind;
    scope_type: LibraryAttentionScopeType;
    media_id: number;
    media_title: string;
    media_type: "movie" | "show";
    episode_id: number | null;
    season: number | null;
    episode_number: number | null;
    detail: string | null;
    search_attempts: number | null;
    library_status: string | null;
    download_history_id: number | null;
    grabbed_at: string | null;
    updated_at: string;
  }>;
}> {
  const rows = await prisma.libraryAttentionAlert.findMany({
    where: { status: "open" },
    include: {
      media: { select: { title: true, type: true } },
      episode: { select: { season: true, episode: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const items = rows
    .map((r) => {
      const scope = r.scopeType as LibraryAttentionScopeType;
      const season =
        scope === "season_pack"
          ? r.season
          : scope === "episode"
            ? (r.episode?.season ?? r.season)
            : null;
      return {
        id: r.id,
        kind: r.kind as LibraryAttentionKind,
        scope_type: scope,
        media_id: r.mediaId,
        media_title: r.media?.title ?? "?",
        media_type: (r.media?.type ?? "movie") as "movie" | "show",
        episode_id: r.episodeId,
        season,
        episode_number:
          scope === "episode" ? (r.episode?.episode ?? null) : null,
        detail: r.detail,
        search_attempts: r.searchAttempts,
        library_status: r.libraryStatusSnapshot,
        download_history_id: r.downloadHistoryId,
        grabbed_at: r.grabbedAt?.toISOString() ?? null,
        updated_at: r.updatedAt.toISOString(),
      };
    })
    .sort(
      (a, b) =>
        (attentionKindPriority(a.kind) ?? 99) -
          (attentionKindPriority(b.kind) ?? 99) ||
        b.updated_at.localeCompare(a.updated_at),
    )
    .slice(0, LIBRARY_ATTENTION_MAX_ITEMS);

  return { items };
}

export async function dismissLibraryAttentionAlert(
  alertId: number,
): Promise<boolean> {
  const row = await prisma.libraryAttentionAlert.findUnique({
    where: { id: alertId },
    select: { id: true, status: true },
  });
  if (!row || row.status !== "open") return false;
  await prisma.libraryAttentionAlert.update({
    where: { id: alertId },
    data: {
      status: "dismissed",
      dismissedAt: new Date(),
    },
  });
  return true;
}
