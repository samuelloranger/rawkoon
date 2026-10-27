import { describe, expect, it } from "bun:test";
import {
  classifyDestination,
  inodeMatch,
  judgePlacement,
  judgeTrackedFile,
  type FileIdentity,
  type InodeParts,
} from "./downloadsAssignRules";

const A: InodeParts = { dev: "39", ino: "14025933294369701739" };
const B: InodeParts = { dev: "39", ino: "17722766446874948061" };

const present = (ino: InodeParts | null): FileIdentity => ({
  exists: true,
  ino,
});
const missing: FileIdentity = { exists: false, ino: null };
/** A real file whose inode the runtime could not report (saturated / zero). */
const unidentifiable = present(null);

describe("inodeMatch", () => {
  it("matches identical parts", () => {
    expect(inodeMatch(A, { ...A })).toBe(true);
  });

  it("does not match different inodes", () => {
    expect(inodeMatch(A, B)).toBe(false);
  });

  it("never matches when either side is unknown", () => {
    expect(inodeMatch(A, null)).toBe(false);
    expect(inodeMatch(null, A)).toBe(false);
    // Two unknowns are not evidence of sameness.
    expect(inodeMatch(null, null)).toBe(false);
  });
});

describe("classifyDestination", () => {
  it("reports an empty destination as absent", () => {
    expect(classifyDestination(missing, A)).toBe("absent");
  });

  it("recognises the destination as an alias of the source", () => {
    expect(classifyDestination(present(A), A)).toBe("same_hardlink_as_source");
  });

  it("reports a different file as a collision", () => {
    expect(classifyDestination(present(B), A)).toBe("collision_other_file");
  });

  it("treats an existing but unidentifiable file as a collision, not absent", () => {
    // Reporting absent here would let the caller place over a real file.
    expect(classifyDestination(unidentifiable, A)).toBe("collision_other_file");
    expect(classifyDestination(unidentifiable, null)).toBe(
      "collision_other_file",
    );
  });

  it("is absent regardless of source identity when nothing is there", () => {
    expect(classifyDestination(missing, null)).toBe("absent");
  });
});

describe("judgePlacement", () => {
  it("accepts a destination that aliases the source", () => {
    expect(judgePlacement("same_hardlink_as_source", "found", true)).toBe("ok");
    expect(judgePlacement("same_hardlink_as_source", "linked", true)).toBe(
      "ok",
    );
  });

  it("reports a vanished destination as missing", () => {
    expect(judgePlacement("absent", "linked", true)).toBe("missing");
    expect(judgePlacement("absent", "found", false)).toBe("missing");
  });

  it("accepts a file we linked whose identity cannot be checked", () => {
    // Rejecting here returns before persistence and leaves an untracked file
    // behind — in move mode with the source already gone.
    expect(judgePlacement("collision_other_file", "linked", false)).toBe("ok");
  });

  it("rejects a mismatch we could actually see after linking", () => {
    // Identity was knowable and does not match, so something replaced the
    // file between the stat and the write. The keyed lock only serializes
    // this process, so that is possible — do not persist the wrong file.
    expect(judgePlacement("collision_other_file", "linked", true)).toBe(
      "collision",
    );
  });

  it("accepts a copied file, whose inode differs by definition", () => {
    // The EXDEV fallback copies instead of linking, so the destination has
    // its own inode. Treating that as a collision would reject a successful
    // placement — and in move mode the source is already gone.
    expect(judgePlacement("collision_other_file", "copied", true)).toBe("ok");
    expect(judgePlacement("collision_other_file", "copied", false)).toBe("ok");
  });

  it("still rejects a collision we did not create", () => {
    expect(judgePlacement("collision_other_file", "found", true)).toBe(
      "collision",
    );
    expect(judgePlacement("collision_other_file", "found", false)).toBe(
      "collision",
    );
  });
});

describe("judgeTrackedFile", () => {
  it("ignores a tracked file that is the destination itself", () => {
    expect(judgeTrackedFile(present(B), A, true)).toBeNull();
  });

  it("ignores a tracked row whose file is gone from disk", () => {
    expect(judgeTrackedFile(missing, A, false)).toBeNull();
  });

  it("rejects when the download is already linked elsewhere", () => {
    expect(judgeTrackedFile(present(A), A, false)).toBe(
      "already_linked_elsewhere",
    );
  });

  it("rejects when a different tracked file already exists", () => {
    expect(judgeTrackedFile(present(B), A, false)).toBe(
      "different_tracked_file",
    );
  });

  it("rejects an unidentifiable tracked file rather than skipping the check", () => {
    // The regression: gating on identity let this fall through, adding a
    // second tracked file for the same movie/episode and, in move mode,
    // consuming the download source to do it.
    expect(judgeTrackedFile(unidentifiable, A, false)).toBe(
      "different_tracked_file",
    );
    expect(judgeTrackedFile(unidentifiable, null, false)).toBe(
      "different_tracked_file",
    );
  });

  it("rejects when the source itself cannot be identified", () => {
    expect(judgeTrackedFile(present(B), null, false)).toBe(
      "different_tracked_file",
    );
  });
});
