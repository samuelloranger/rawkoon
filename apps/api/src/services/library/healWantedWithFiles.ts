import { prisma } from "@rawkoon/api/db";

/** Movies and episodes left "wanted" while a library file exists go back to downloaded. */
export async function healWantedWithFiles(): Promise<number> {
  const where = { status: "wanted", files: { some: {} } };
  const data = { status: "downloaded" };
  const [movies, episodes] = await Promise.all([
    prisma.libraryMedia.updateMany({
      where: { ...where, type: "movie" },
      data,
    }),
    prisma.libraryEpisode.updateMany({ where, data }),
  ]);
  return movies.count + episodes.count;
}
