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
 * Judge the destination after the placement step.
 *
 * `placedHere` means this invocation wrote the file, inside the per-destination
 * lock, so the file there is the one it wrote — existence is the whole
 * postcondition. Demanding identity would reject our own write whenever the
 * inode is unusable, and that rejection path returns before persistence,
 * leaving an untracked file behind (and in move mode, no source either).
 */
export function judgePlacement(
  post: DestinationClass,
  placedHere: boolean,
): PlacementVerdict {
  if (post === "absent") return "missing";
  if (post === "collision_other_file" && !placedHere) return "collision";
  return "ok";
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
