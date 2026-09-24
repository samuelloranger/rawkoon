import { prisma } from "@rawkoon/api/db";
import { pruneEmptyParentDirs } from "@rawkoon/api/utils/medias/pruneEmptyDirs";

/**
 * Remove the movie, show and season folders left empty by deleting these
 * library files. Never throws: the files are already gone, and a failed
 * cleanup must not turn a successful delete into an error response.
 */
export async function pruneLibraryDirsAfterDelete(
  filePaths: Iterable<string>,
): Promise<void> {
  const paths = [...filePaths];
  if (paths.length === 0) return;
  try {
    const settings = await prisma.mediaSettings.findUnique({
      where: { id: 1 },
      select: { moviesLibraryPath: true, showsLibraryPath: true },
    });
    const roots = [settings?.moviesLibraryPath, settings?.showsLibraryPath];
    // Sequential: sibling files share parents, and each climb must see the
    // previous one's removals.
    for (const p of paths) await pruneEmptyParentDirs(p, roots);
  } catch (e) {
    console.warn("[library] Failed to prune empty folders after delete:", e);
  }
}
