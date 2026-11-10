/**
 * Refuse-to-run guard: clips must never live in, above or below anything the
 * library, downloads or transcoder use. Read-only; compares realpaths and
 * device+inode so symlinks and bind mounts cannot hide an overlap.
 */
import { realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { prisma } from "@rawkoon/api/db";
import { clipsRoot } from "@rawkoon/api/services/clips/clipStore";

export class ClipSafetyError extends Error {}

/** Realpath of the deepest existing ancestor plus the not-yet-created tail. */
async function resolveReal(p: string): Promise<string> {
  const abs = resolve(p);
  try {
    return await realpath(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const parent = dirname(abs);
    if (parent === abs) return abs;
    return join(await resolveReal(parent), basename(abs));
  }
}

async function key(p: string): Promise<string | null> {
  try {
    const s = await stat(p);
    return `${s.dev}:${s.ino}`;
  } catch {
    return null;
  }
}

/** [p, parent, ..., "/"] as realpath + dev:ino; keys are null for paths that do not exist. */
async function chain(
  p: string,
): Promise<{ path: string; key: string | null }[]> {
  const out: { path: string; key: string | null }[] = [];
  let cur = await resolveReal(p);
  for (;;) {
    out.push({ path: cur, key: await key(cur) });
    const up = dirname(cur);
    if (up === cur) return out;
    cur = up;
  }
}

function under(child: string, parent: string): boolean {
  return (
    child === parent || child.startsWith(parent === "/" ? "/" : `${parent}/`)
  );
}

/** Overlap when either path is the other or contains it, by realpath or by dev:ino. */
function overlaps(
  a: { path: string; key: string | null }[],
  b: { path: string; key: string | null }[],
): boolean {
  const [a0, b0] = [a[0], b[0]];
  if (!a0 || !b0) return false;
  if (under(a0.path, b0.path) || under(b0.path, a0.path)) return true;
  return (
    (a0.key !== null && b.some((x) => x.key === a0.key)) ||
    (b0.key !== null && a.some((x) => x.key === b0.key))
  );
}

function envRoots(): string[] {
  const out = [Bun.env.MEDIA_PATH_FROM, Bun.env.MEDIA_PATH_TO];
  for (const pair of (Bun.env.MEDIA_PATH_REMAP ?? "").split(",")) {
    const [f, t] = pair.split(":");
    out.push(f, t);
  }
  return out.filter((v): v is string => !!v && v.startsWith("/"));
}

/** Every string column of media settings whose name contains `Path` is a root the clips must stay out of. */
export async function libraryRoots(): Promise<string[]> {
  const row = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  const fromDb = Object.entries(row ?? {})
    .filter(
      ([k, v]) =>
        k.includes("Path") && typeof v === "string" && v.startsWith("/"),
    )
    .map(([, v]) => v as string);
  return [...fromDb, ...envRoots()];
}

export const transcodeTempDir = () => join(tmpdir(), "rawkoon-transcode");

/** Throws ClipSafetyError unless the clips root is clear of every media location. */
export async function assertClipsRootSafe(): Promise<void> {
  const root = await chain(clipsRoot());
  const r0 = root[0]?.path ?? "";
  if (r0 === "/" || dirname(r0) === "/") {
    throw new ClipSafetyError(
      "Clips folder is the filesystem root or a top-level directory",
    );
  }

  const protectedRoots = [...(await libraryRoots()), transcodeTempDir()];
  for (const p of protectedRoots) {
    if (overlaps(root, await chain(p))) {
      throw new ClipSafetyError(
        "Clips folder overlaps a library, downloads or transcode location",
      );
    }
  }

  // A tracked media file inside the clips folder, or directly in a directory above it.
  const prefixes = new Set([r0, resolve(clipsRoot())]);
  for (const prefix of prefixes) {
    const hit = await prisma.mediaFile.findFirst({
      where: { filePath: { startsWith: `${prefix}/` } },
      select: { id: true },
    });
    if (hit)
      throw new ClipSafetyError(
        "A tracked media file lives inside the clips folder",
      );
  }
  for (const ancestor of root.slice(1)) {
    if (ancestor.path === "/") continue;
    // Only files directly in the ancestor: media deeper in other branches is not a conflict.
    const prefix = `${ancestor.path}/`;
    const hit = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM media_files
      WHERE starts_with(file_path, ${prefix})
        AND position('/' in substr(file_path, ${prefix.length + 1})) = 0
      LIMIT 1`;
    if (hit.length > 0)
      throw new ClipSafetyError(
        "A tracked media file lives in a directory above the clips folder",
      );
  }
}
