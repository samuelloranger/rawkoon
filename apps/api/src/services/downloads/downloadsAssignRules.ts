/** Pure placement rules; an unprovable inode is never "no file here" and never "same file". */

export type InodeParts = { dev: string; ino: string };

export type FileIdentity = {
  exists: boolean;
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

/** An unidentifiable file is a collision, not an absence, so the caller never places over it. */
export function classifyDestination(
  dest: FileIdentity,
  srcIno: InodeParts | null,
): DestinationClass {
  if (!dest.exists) return "absent";
  if (inodeMatch(dest.ino, srcIno)) return "same_hardlink_as_source";
  return "collision_other_file";
}

export type PlacementVerdict = "ok" | "missing" | "collision";

/** `copied` (EXDEV fallback) has its own inode, so a mismatch with the source is expected there. */
export type PlacementMethod = "found" | "linked" | "copied";

/** Mismatch is a collision only when identity is knowable and the write should have preserved it; a false reject leaves an untracked file and no source in move mode. */
export function judgePlacement(
  post: DestinationClass,
  method: PlacementMethod,
  identityKnown: boolean,
): PlacementVerdict {
  if (post === "absent") return "missing";
  if (post !== "collision_other_file") return "ok";
  if (method === "found") return "collision";
  if (method === "copied") return "ok";
  // Linked or renamed should share the source inode; a mismatch means something replaced it.
  return identityKnown ? "collision" : "ok";
}

export type TrackedFileVerdict =
  | null
  | "already_linked_elsewhere"
  | "different_tracked_file";

/** Gated on existence, not identity, so an unidentifiable tracked file still blocks a duplicate. */
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
