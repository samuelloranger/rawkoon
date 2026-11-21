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

const searchArgs = z.object({
  query: z.string().min(1),
  kind: z.enum(["movie", "show", "book", "all"]).optional(),
});

const searchTool: McpTool = {
  name: "search",
  scope: "read",
  action: false,
  description:
    "Searches for movies, shows and books by title, like Rawkoon's add flow. " +
    "Returns matching titles with their TMDB id (movies/shows) or Google volume id (books), " +
    "plus whether each is already in the library. Use it before request_title to find the right id.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Title to search for." },
      kind: {
        type: "string",
        enum: ["movie", "show", "book", "all"],
        description: "What to search (default: all kinds).",
      },
    },
    required: ["query"],
  },
  args: searchArgs,
  async run(raw, ctx) {
    const args = searchArgs.parse(raw);
    const kind = args.kind ?? "all";
    const result: Record<string, unknown> = {};

    if (kind !== "book") {
      const media = await inner(
        innerRequest(
          `/api/medias/tmdb-search?q=${encodeURIComponent(args.query)}&kind=${
            kind === "movie" ? "movie" : kind === "show" ? "tv" : "any"
          }`,
        ),
        ctx.owner,
      );
      if (!media.ok) throw new ToolFailure(media.text);
      const items = asArray(asRecord(media.body).items);
      result.movies_and_shows = capList(
        items.map((item) => {
          const r = asRecord(item);
          return {
            tmdb_id: num(r.tmdb_id),
            kind: str(r.media_type) === "tv" ? "show" : "movie",
            title: str(r.title),
            year: num(r.release_year),
            overview: str(r.overview),
            already_in_library: r.already_exists === true,
            library_id: num(r.library_id) ?? null,
            library_status: str(r.library_status),
          };
        }),
      );
    }

    if (kind === "book" || kind === "all") {
      const features = await inner(
        innerRequest("/api/system/features"),
        ctx.owner,
      );
      const booksEnabled =
        features.ok && asRecord(features.body).books_enabled === true;
      if (booksEnabled) {
        const books = await inner(
          innerRequest(`/api/books/search?q=${encodeURIComponent(args.query)}`),
          ctx.owner,
        );
        if (!books.ok) throw new ToolFailure(books.text);
        const found = asArray(asRecord(books.body).results);
        result.books = capList(
          found.map((item) => {
            const r = asRecord(item);
            return {
              google_volume_id: str(r.google_volume_id),
              title: str(r.title),
              authors: asArray(r.authors),
              published_year: num(r.published_year),
              language: str(r.language),
              already_in_library: r.in_library === true,
            };
          }),
        );
      }
    }

    return result;
  },
};

const libraryLookupArgs = z.object({
  query: z.string().min(1),
  kind: z.enum(["movie", "show"]).optional(),
});

const libraryLookupTool: McpTool = {
  name: "library_lookup",
  scope: "read",
  action: false,
  description:
    "Checks which titles matching a query are in the Rawkoon library, with their " +
    "status, missing episodes, file quality and audio languages. Use it to answer " +
    '"do we have X?" and "is it any good?" questions.',
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Title (or partial title) to find.",
      },
      kind: {
        type: "string",
        enum: ["movie", "show"],
        description: "Restrict to movies or shows.",
      },
    },
    required: ["query"],
  },
  args: libraryLookupArgs,
  async run(raw, ctx) {
    const args = libraryLookupArgs.parse(raw);
    const params = new URLSearchParams({ q: args.query, limit: "25" });
    if (args.kind) params.set("type", args.kind);
    const res = await inner(
      innerRequest(`/api/library?${params.toString()}`),
      ctx.owner,
    );
    if (!res.ok) throw new ToolFailure(res.text);

    const body = asRecord(res.body);
    const items = asArray(body.items).map((item) => {
      const r = asRecord(item);
      const episodeCount = num(r.episode_count);
      const downloaded = num(r.downloaded_episode_count);
      return {
        id: num(r.id),
        tmdb_id: num(r.tmdb_id),
        title: str(r.title),
        kind: str(r.type),
        year: num(r.year),
        status: str(r.status),
        monitored: r.monitored === true,
        airing_state: str(r.airing_state),
        episode_count: episodeCount,
        downloaded_episode_count: downloaded,
        missing_episodes:
          episodeCount != null && downloaded != null
            ? Math.max(0, episodeCount - downloaded)
            : null,
        season_count: num(r.season_count),
        quality_profile: r.quality_profile,
        resolution: num(r.resolution),
        hdr_format: str(r.hdr_format),
        audio_format: str(r.audio_format),
        audio_languages: r.language_tags,
      };
    });
    return { ...capList(items), has_more: body.has_more === true };
  },
};

const downloadsTool: McpTool = {
  name: "downloads",
  scope: "read",
  action: false,
  description:
    "Lists the current download queue per title: progress_percent (0-100), state, " +
    "download_speed_bytes_per_s (bytes per second) and eta_seconds. " +
    "The owner of this API key must be an admin (titles and release names are admin-only in Rawkoon).",
  inputSchema: { type: "object", properties: {} },
  args: z.object({}),
  async run(_raw, ctx) {
    const res = await inner(
      innerRequest("/api/dashboard/downloads/active"),
      ctx.owner,
    );
    if (!res.ok) throw new ToolFailure(res.text);
    const body = asRecord(res.body);
    if (body.enabled === false || body.connected === false) {
      return {
        enabled: body.enabled === true,
        connected: body.connected === true,
        items: [],
        note: "No download client is configured or reachable.",
      };
    }
    return capList(
      asArray(body.items).map((item) => {
        const r = asRecord(item);
        return {
          title: str(r.media_title),
          kind: str(r.media_type),
          season: num(r.season),
          episode: num(r.episode),
          release: str(r.release_title),
          progress_percent:
            num(r.progress) != null ? Math.round(num(r.progress)! * 100) : null,
          state: str(r.state),
          download_speed_bytes_per_s: num(r.download_speed),
          eta_seconds: num(r.eta_seconds),
        };
      }),
    );
  },
};

const qualityProfilesTool: McpTool = {
  name: "quality_profiles",
  scope: "read",
  action: false,
  description:
    "Lists the quality profiles (id, name, minimum resolution, preferred languages) and which " +
    "one is the default for movies and shows (default_for). Use it to find the quality_profile_id " +
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
    const s = settings.ok ? asRecord(settings.body) : {};
    const movieDefault = num(s.default_movie_quality_profile_id);
    const showDefault = num(s.default_show_quality_profile_id);
    return capList(
      asArray(asRecord(res.body).profiles).map((item) => {
        const r = asRecord(item);
        const id = num(r.id);
        return {
          id,
          name: str(r.name),
          default_for: [
            ...(id != null && id === movieDefault ? ["movie"] : []),
            ...(id != null && id === showDefault ? ["show"] : []),
          ],
          min_resolution: num(r.min_resolution),
          cutoff_resolution: num(r.cutoff_resolution),
          preferred_languages: r.preferred_languages,
        };
      }),
    );
  },
};

const calendarArgs = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Days ahead to include (default 7, max 30)."),
});

const calendarTool: McpTool = {
  name: "calendar",
  scope: "read",
  action: false,
  description:
    "Upcoming movie releases and new TV episodes for the next N days " +
    '(default 7, max 30), for titles Rawkoon knows about. Use it for "what\'s coming out this week?".',
  inputSchema: {
    type: "object",
    properties: {
      days: {
        type: "integer",
        minimum: 1,
        maximum: 30,
        description: "Days ahead to include (default 7, max 30).",
      },
    },
  },
  args: calendarArgs,
  async run(raw, ctx) {
    const args = calendarArgs.parse(raw);
    const days = args.days ?? 7;
    const res = await inner(innerRequest("/api/dashboard/upcoming"), ctx.owner);
    if (!res.ok) throw new ToolFailure(res.text);
    const body = asRecord(res.body);
    if (body.enabled === false) {
      return {
        enabled: false,
        items: [],
        note: "TMDB is not configured, so no upcoming releases are available.",
      };
    }
    const today = new Date();
    const until = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
    const items = asArray(body.items)
      .map((item) => {
        const r = asRecord(item);
        return {
          title: str(r.title),
          kind: str(r.media_type) === "tv" ? "show" : "movie",
          release_date: str(r.release_date),
          season: num(r.season_number),
          episode: num(r.episode_number),
          in_library: num(r.library_id) != null,
          overview: str(r.overview),
        };
      })
      .filter((item) => {
        const date = item.release_date ? new Date(item.release_date) : null;
        return date != null && date >= today && date <= until;
      })
      .sort(
        (a, b) =>
          new Date(a.release_date ?? 0).getTime() -
          new Date(b.release_date ?? 0).getTime(),
      );
    return { ...capList(items), days };
  },
};

const myRequestsTool: McpTool = {
  name: "my_requests",
  scope: "read",
  action: false,
  description:
    "Lists the API key owner's own title requests and their state " +
    "(pending, approved, denied, with the deny reason). Use it before asking for a new request.",
  inputSchema: { type: "object", properties: {} },
  args: z.object({}),
  async run(_raw, ctx) {
    const res = await inner(innerRequest("/api/requests?mine=1"), ctx.owner);
    if (!res.ok) throw new ToolFailure(res.text);
    const requests = asArray(asRecord(res.body).requests);
    return capList(
      requests.map((item) => {
        const r = asRecord(item);
        return {
          id: num(r.id),
          title: str(r.title),
          kind: str(r.type),
          year: num(r.year),
          status: str(r.status),
          seasons: r.seasons,
          season_mode: str(r.season_mode),
          deny_reason: str(r.deny_reason),
          created_at: str(r.created_at),
          decided_at: str(r.decided_at),
        };
      }),
    );
  },
};

const listeningProgressArgs = z.object({
  query: z.string().optional(),
});

const listeningProgressTool: McpTool = {
  name: "listening_progress",
  scope: "read",
  action: false,
  description:
    "Where the API key owner is in their audiobooks and ebooks: position, " +
    "duration and finished flags. Optionally filters by a title substring. " +
    "Use it to resume a book or see what's in progress.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Optional title substring to filter by.",
      },
    },
  },
  args: listeningProgressArgs,
  async run(raw, ctx) {
    const args = listeningProgressArgs.parse(raw);
    const filter = args.query?.trim().toLowerCase();

    const [listeningRes, readingRes] = await Promise.all([
      inner(innerRequest("/api/books/progress"), ctx.owner),
      inner(innerRequest("/api/books/reading-progress"), ctx.owner),
    ]);
    if (!listeningRes.ok) throw new ToolFailure(listeningRes.text);
    if (!readingRes.ok) throw new ToolFailure(readingRes.text);

    const titleMatch = (title: unknown) =>
      !filter ||
      (typeof title === "string" && title.toLowerCase().includes(filter));

    const listening = asArray(asRecord(listeningRes.body).progress)
      .filter((item) => titleMatch(asRecord(item).title))
      .map((item) => {
        const r = asRecord(item);
        const position = num(r.position_secs);
        const total = num(r.total_duration_secs);
        return {
          book_id: num(r.book_id),
          edition_id: num(r.edition_id),
          title: str(r.title),
          authors: r.authors,
          format: "audiobook",
          position_secs: position,
          total_duration_secs: total,
          percent:
            position != null && total
              ? Math.round((position / total) * 100)
              : null,
          finished: r.finished === true,
          updated_at: str(r.updated_at),
        };
      });

    const reading = asArray(asRecord(readingRes.body).progress)
      .filter((item) => titleMatch(asRecord(item).title))
      .map((item) => {
        const r = asRecord(item);
        return {
          book_id: num(r.book_id),
          edition_id: num(r.edition_id),
          title: str(r.title),
          authors: r.authors,
          format: "ebook",
          scroll_fraction: num(r.scroll_fraction),
          spine_index: num(r.spine_index),
          finished: r.finished === true,
          updated_at: str(r.updated_at),
        };
      });

    return { listening: capList(listening), reading: capList(reading) };
  },
};

const healthTool: McpTool = {
  name: "health",
  scope: "admin",
  action: false,
  description:
    "Runs Rawkoon's doctor self-check and returns the report: each check's " +
    "status, summary and suggested fix. Use it when the person asks whether " +
    "Rawkoon is healthy or something seems broken. Requires an admin owner.",
  inputSchema: { type: "object", properties: {} },
  args: z.object({}),
  async run(_raw, ctx) {
    const res = await inner(innerRequest("/api/admin/doctor"), ctx.owner);
    if (!res.ok) throw new ToolFailure(res.text);
    return res.body;
  },
};

export const readTools: McpTool[] = [
  searchTool,
  libraryLookupTool,
  downloadsTool,
  qualityProfilesTool,
  calendarTool,
  myRequestsTool,
  listeningProgressTool,
];

export { healthTool };
