/**
 * Placement decisions for assigning a download into the library.
 *
 * Pure on purpose. Every defect this module exists to prevent was a decision
 * bug at the boundary between "does a file exist here" and "can I prove which
 * file it is", not an I/O bug — and each was reachable only when the runtime
 * could not report a usable inode, which real temp files never reproduce.
 * Keeping the rules free of the filesystem makes that matrix directly testable.
 *
 * The invariant behind all of them: an unprovable inode is not evidence of
 * anything. It must never read as "no file here", and never as "same file".
 */

export type InodeParts = { dev: string; ino: string };

/** What a stat told us: whether a regular file is there, and if we can identify it. */
export type FileIdentity = {
  exists: boolean;
  /** Null when the runtime could not report a trustworthy inode. */
  ino: InodeParts | null;
};

export type DestinationClass =
  | "absent"
  | "same_hardlink_as_source"
  | "collision_other_file";

export function inodeMatch(
  a: InodeParts | null,
  b: InodeParts | null,
): boolean {
  // An unusable inode must never count as a match.
  if (a === null || b === null) return false;
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Classify what sits at the destination before we touch it.
 *
 * A file we cannot identify is a collision, not an absence: reporting it as
 * absent would let the caller place over it.
 */
export function classifyDestination(
  dest: FileIdentity,
  srcIno: InodeParts | null,
): DestinationClass {
  if (!dest.exists) return "absent";
  if (inodeMatch(dest.ino, srcIno)) return "same_hardlink_as_source";
  return "collision_other_file";
}

export type PlacementVerdict = "ok" | "missing" | "collision";

/**
 * How the file at the destination got there.
 *
 * - `found`   — it already existed; this invocation did not write it.
 * - `linked`  — hardlinked or renamed, so it shares the source's inode.
 * - `copied`  — the EXDEV fallback copied it, so it has an inode of its own
 *               and can never match the source. That is expected, not a
 *               collision.
 */
export type PlacementMethod = "found" | "linked" | "copied";

/**
 * Judge the destination after the placement step.
 *
 * The tension here: identity is a real integrity check — an external process
 * can replace the file between our stat and our write, and the per-destination
 * lock only serializes this process — but it is not always available, and it is
 * not always meaningful.
 *
 * So a mismatch is only a collision when identity was knowable AND the write
 * should have preserved it. `identityKnown` false means we have no evidence
 * either way; `copied` means a differing inode is the expected outcome.
 *
 * Getting this wrong in the rejecting direction is costly: that path returns
 * before persistence, leaving an untracked file at the destination and, in
 * move mode, no source to retry from.
 */
export function judgePlacement(
  post: DestinationClass,
  method: PlacementMethod,
  identityKnown: boolean,
): PlacementVerdict {
  if (post === "absent") return "missing";
  if (post !== "collision_other_file") return "ok";
  if (method === "found") return "collision";
  if (method === "copied") return "ok";
  // Linked or renamed: the destination should share the source's inode. If we
  // can see that it does not, something replaced it — do not persist it.
  return identityKnown ? "collision" : "ok";
}

export type TrackedFileVerdict =
  | null
  | "already_linked_elsewhere"
  | "different_tracked_file";

/**
 * Judge an already-tracked file for this movie/episode that lives somewhere
 * other than the destination we are about to write.
 *
 * Gated on existence, not identity. A tracked file we cannot identify is still
 * a tracked file: skipping the check would add a second one for the same
 * movie/episode, and in move mode consume the download source doing it.
 */
export function judgeTrackedFile(
  other: FileIdentity,
  srcIno: InodeParts | null,
  isSamePathAsDestination: boolean,
): TrackedFileVerdict {
  if (!other.exists || isSamePathAsDestination) return null;
  return inodeMatch(other.ino, srcIno)
    ? "already_linked_elsewhere"
    : "different_tracked_file";
}
