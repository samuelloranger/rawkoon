import { rmdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * After a library file is deleted, remove the folders it leaves empty — the
 * season folder, then the show or movie folder — up to but never including
 * the library root that contains it. Uses rmdir, which refuses a non-empty
 * folder, so anything still holding a file is left alone. Paths outside every
 * root are not touched.
 */
export async function pruneEmptyParentDirs(
  filePath: string,
  roots: readonly (string | null | undefined)[],
): Promise<void> {
  const file = resolve(filePath);
  const root = roots
    .map((r) => r?.trim())
    .filter((r): r is string => !!r)
    .map((r) => resolve(r))
    .find((r) => file.startsWith(r.endsWith(sep) ? r : r + sep));
  if (!root) return;

  let dir = dirname(file);
  while (dir !== root && dir.startsWith(root + sep)) {
    try {
      await rmdir(dir);
    } catch (e) {
      // Already gone: its parent may still be empty, so keep climbing.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") return;
    }
    dir = dirname(dir);
  }
}
