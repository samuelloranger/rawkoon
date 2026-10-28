/**
 * Metadata for a notification that absorbs another one of the same group: the
 * count goes up, the newest episode code wins, and the fields a client lays the
 * row out from (subject, media id) survive the merge.
 */
export function mergeGroupedMetadata(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>,
  groupKey: string,
): Record<string, string | number> & { group_count: number } {
  const count =
    typeof previous.group_count === "number" ? previous.group_count + 1 : 2;
  const latestCode =
    typeof incoming.latest_code === "string"
      ? incoming.latest_code
      : typeof previous.latest_code === "string"
        ? previous.latest_code
        : "";
  const show = typeof incoming.show === "string" ? incoming.show : "";
  const subject = typeof incoming.subject === "string" ? incoming.subject : "";
  const mediaId =
    typeof incoming.media_id === "number" ? incoming.media_id : null;

  return {
    group_key: groupKey,
    group_count: count,
    ...(latestCode ? { latest_code: latestCode, code: latestCode } : {}),
    ...(show ? { show } : {}),
    ...(subject ? { subject } : {}),
    ...(mediaId != null ? { media_id: mediaId } : {}),
  };
}
