import { z } from "zod";
import { innerRequest } from "./dispatcher";
import { capList } from "./shape";
import {
  asArray,
  asRecord,
  inner,
  num,
  str,
  ToolFailure,
  type McpTool,
} from "./toolShared";

export const qualityProfilesTool: McpTool = {
  name: "quality_profiles",
  scope: "read",
  action: false,
  description:
    "Lists the quality profiles (id, name, minimum resolution, preferred languages) and which " +
    "one is the default for movies and shows (default_for; null when this key's owner can't read the defaults). Use it to find the quality_profile_id " +
    "that decide_request (approve) and request_title need; prefer the default for the title's kind.",
  inputSchema: { type: "object", properties: {} },
  args: z.object({}),
  async run(_raw, ctx) {
    const [res, settings] = await Promise.all([
      inner(innerRequest("/api/quality-profiles"), ctx.owner),
      inner(innerRequest("/api/library/post-processing/settings"), ctx.owner),
    ]);
    if (!res.ok) throw new ToolFailure(res.text);
    // Defaults are best-effort: the settings route may refuse a non-admin owner.
    const s = settings.ok ? asRecord(asRecord(settings.body).settings) : {};
    const movieDefault = num(s.default_movie_quality_profile_id);
    const showDefault = num(s.default_show_quality_profile_id);
    return capList(
      asArray(asRecord(res.body).profiles).map((item) => {
        const r = asRecord(item);
        const id = num(r.id);
        return {
          id,
          name: str(r.name),
          // null = unknown (the settings route refused this owner), not "no default".
          default_for: settings.ok
            ? [
                ...(id != null && id === movieDefault ? ["movie"] : []),
                ...(id != null && id === showDefault ? ["show"] : []),
              ]
            : null,
          min_resolution: num(r.min_resolution),
          cutoff_resolution: num(r.cutoff_resolution),
          preferred_languages: r.preferred_languages,
        };
      }),
    );
  },
};
