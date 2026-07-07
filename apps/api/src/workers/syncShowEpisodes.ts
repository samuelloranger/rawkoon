import { prisma } from "@rawkoon/api/db";
import { syncLibraryShowEpisodes } from "@rawkoon/api/services/libraryTmdbRefresh";

export async function syncShowEpisodes(): Promise<void> {
  const shows = await prisma.libraryMedia.findMany({
    where: { type: "show" },
    select: { id: true },
  });

  for (const s of shows) {
    try {
      await syncLibraryShowEpisodes(s.id);
    } catch (e) {
      console.warn(`[syncShowEpisodes] Failed for media ${s.id}:`, e);
    }
  }
}
