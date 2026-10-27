import { prisma } from "@rawkoon/api/db";
import { bookInclude } from "@rawkoon/api/routes/books/bookHelpers";
import { refreshBookMetadata } from "@rawkoon/api/services/books/refreshBookMetadata";
import { serializePerBook } from "@rawkoon/api/services/books/refreshQueue";
import { loadReadAtByBookId } from "@rawkoon/api/services/books/setBookRead";

export const bookIdExists = async (id: number): Promise<boolean> =>
  !!(await prisma.libraryBook.findUnique({
    where: { id },
    select: { id: true },
  }));

export const loadReadAtForBook = async (
  userId: string,
  bookId: number,
): Promise<Date | null> =>
  (await loadReadAtByBookId(prisma, userId, [bookId])).get(bookId) ?? null;

export async function applyBookOverrides(
  id: number,
  patch: Record<string, unknown>,
  removed: string[],
) {
  return serializePerBook(id, async () => {
    /**
     * Read inside the job, not before it.
     *
     * Captured outside the queue, this snapshot could predate another
     * request that has already been applied — a revert would then restore a
     * value that is no longer the one it is reverting.
     */
    const before = await prisma.libraryBook.findUnique({
      where: { id },
      select: { overrides: true },
    });
    const priorOverrides =
      before?.overrides &&
      typeof before.overrides === "object" &&
      !Array.isArray(before.overrides)
        ? (before.overrides as Record<string, unknown>)
        : {};

    /**
     * Merged in the database, not read-modify-written in the handler.
     *
     * Each field has its own Save button, so two saves can overlap.
     * Reading the JSON, merging in memory and writing it back would let
     * the second write drop the first field, since both started from the
     * same snapshot. `||` adds and replaces keys, `-` removes them, both
     * inside the one statement.
     */
    await prisma.$executeRaw`
      UPDATE library_books
      SET overrides =
        (COALESCE(overrides, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)
        - ${removed}::text[]
      WHERE id = ${id}
    `;

    // Recompute so the columns reflect the change: an override has to win,
    // a cleared field has to fall back to the sources, and a cleared field
    // no source supplies has to be emptied rather than left frozen.
    let outcome;
    try {
      outcome = await refreshBookMetadata(id, {
        clearedOverrides: removed,
      });
    } catch (error) {
      /**
       * The JSON is already committed at this point, so a failed refresh
       * would otherwise leave the override stored while the column still
       * shows the old value — a request reported as failed that changed
       * something anyway. Put the previous state back before rethrowing.
       */
      await prisma.libraryBook.update({
        where: { id },
        data: { overrides: priorOverrides as object },
      });
      throw error;
    }

    /**
     * A revert the sources cannot honour is undone rather than half-applied.
     *
     * title and language cannot be emptied, so if nothing replaced them the
     * column still holds the operator's value. Leaving the override deleted
     * would strand it: displayed as if it came from a source, with no Revert
     * action and no later refresh able to repair it. Putting the override
     * back keeps the JSON and the column agreeing, and the caller is told.
     */
    const unrestored = outcome.ok ? outcome.unrestoredFields : [];
    if (unrestored.length > 0) {
      const restore: Record<string, unknown> = {};
      for (const field of unrestored) {
        if (Object.hasOwn(priorOverrides, field)) {
          restore[field] = priorOverrides[field];
        }
      }
      if (Object.keys(restore).length > 0) {
        await prisma.$executeRaw`
          UPDATE library_books
          SET overrides =
            COALESCE(overrides, '{}'::jsonb) || ${JSON.stringify(restore)}::jsonb
          WHERE id = ${id}
        `;
      }
    }

    const item = await prisma.libraryBook.findUnique({
      where: { id },
      include: bookInclude,
    });
    return { item, unrestored };
  });
}
