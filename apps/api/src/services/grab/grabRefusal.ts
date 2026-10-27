import type { GrabRefusal } from "@rawkoon/api/services/mediaGrabber/mediaGrabberGrab";

/** Refusals that say nothing about the release, so an automatic search must not count them as a miss. */
export function isNoMissRefusal(refusal: GrabRefusal | undefined): boolean {
  return refusal === "no_space" || refusal === "show_grab_active";
}
