# Artwork Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin pick a library item's poster and backdrop from a grid of candidates sourced from TMDB and fanart.tv, filtered by image language.

**Architecture:** Two independent image providers behind a common candidate type, merged by one service and served by `GET /api/library/:id/images`. Selection writes through the existing `PATCH /api/library/:id/overrides`, which `mapLibraryMedia` already applies for `poster_url`; `backdrop_url` is added the same way. fanart.tv is a new integration row, optional and failure-tolerant.

**Tech Stack:** Bun, Hono, Zod (`queryV`/`jsonV`), Prisma 7, Redis (`getJsonCache`/`setJsonCache`), React 19 + TanStack Query, Radix, Tailwind 4, i18next.

**Spec:** `docs/superpowers/specs/2026-09-14-localized-titles-and-image-picker-design.md` (sections 2.1–2.5)

**Independence:** This plan does not depend on the localized-titles plan. Either may ship first.

## Global Constraints

- No new third-party dependencies.
- `media_stills`, `TmdbImageStill` and the `medias:tmdb-details-v4:*` cache are **not** to be modified. The picker gets its own fetcher; widening the shared details response would change an already-cached, widely-consumed shape.
- fanart.tv is optional. No API key, an HTTP error, a rate limit, or a show with no TVDB id must all yield an empty candidate list — never a failed request and never a 500.
- Integration secrets are stored with `encrypt()` and read back through the normalizers' `normalizeSecret` (which decrypts and fails closed). Never store a raw key.
- Errors are helper returns, not throws: `badRequest`/`notFound`/`serverError` from `@rawkoon/api/errors`.
- API code imports itself as `@rawkoon/api/<path>`.
- TS is strict: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`.
- Run the **full** `apps/api` test suite (`bun run --filter @rawkoon/api test`), never a single file — the suite is order-dependent.
- Web tests must run as `env -u NODE_ENV bun run --filter @rawkoon/web test`; this shell exports `NODE_ENV=production`, which removes `React.act` and makes the suite pass while faking failures.

---

### Task 1: Artwork candidate type

**Files:**
- Create: `apps/shared/src/types/artwork.ts`
- Modify: `apps/shared/src/types/index.ts` (re-export)

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type ArtworkKind = "poster" | "backdrop";
export type ArtworkSource = "tmdb" | "fanart";

export interface ArtworkCandidate {
  /** Full-resolution image URL, used when the candidate is selected. */
  url: string;
  /** Small URL for the grid. Equals `url` when the source offers no thumbnail. */
  thumb_url: string;
  width: number | null;
  height: number | null;
  /** ISO 639-1, or null for a language-neutral (textless) image. */
  language: string | null;
  /** Source-relative popularity; higher is better. Null when unknown. */
  vote: number | null;
  source: ArtworkSource;
}

export interface ArtworkCandidatesResponse {
  candidates: ArtworkCandidate[];
}
```

- [ ] **Step 1: Create the type module**

Create `apps/shared/src/types/artwork.ts` with exactly the block above, each field keeping its comment.

- [ ] **Step 2: Re-export it**

In `apps/shared/src/types/index.ts`, add the re-export alongside the existing ones, matching the file's existing style (`export * from "./artwork";` or the explicit form the file already uses — follow what is there).

- [ ] **Step 3: Typecheck and commit**

```bash
bun run typecheck
git add apps/shared/src/types/artwork.ts apps/shared/src/types/index.ts
git commit -m "feat(shared): add artwork candidate types"
```

---

### Task 2: TMDB image provider

**Files:**
- Create: `apps/api/src/services/images/tmdbImageProvider.ts`
- Create: `apps/api/src/services/images/tmdbImageProvider.test.ts`

**Interfaces:**
- Consumes: `ArtworkCandidate`, `ArtworkKind` (Task 1); `tmdbApiFetch` from `@rawkoon/api/utils/medias/libraryHelpers`.
- Produces:

```ts
export function parseTmdbImages(raw: unknown, kind: ArtworkKind): ArtworkCandidate[];

export async function fetchTmdbArtwork(input: {
  apiKey: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]>;
```

`parseTmdbImages` is exported separately so it can be tested without a network mock.

Sizes: posters use `https://image.tmdb.org/t/p/w342` for `thumb_url` and `https://image.tmdb.org/t/p/original` for `url`. Backdrops use `w780` and `original`. These bases are already declared in `@rawkoon/api/utils/medias/tmdbFetcherTypes` as `IMG_POSTER_STILL` and `IMG_BACKDROP_STILL` — import them rather than re-typing the strings, and add a local `IMG_ORIGINAL = "https://image.tmdb.org/t/p/original"`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/images/tmdbImageProvider.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseTmdbImages } from "@rawkoon/api/services/images/tmdbImageProvider";

const raw = {
  posters: [
    {
      file_path: "/a.jpg",
      width: 2000,
      height: 3000,
      iso_639_1: "en",
      vote_average: 5.6,
    },
    {
      file_path: "/b.jpg",
      width: 1000,
      height: 1500,
      iso_639_1: null,
      vote_average: 8.1,
    },
    { file_path: null, width: 1, height: 1, iso_639_1: "fr", vote_average: 9 },
  ],
  backdrops: [
    {
      file_path: "/c.jpg",
      width: 3840,
      height: 2160,
      iso_639_1: "fr",
      vote_average: 3.2,
    },
  ],
};

describe("parseTmdbImages", () => {
  it("maps posters to candidates", () => {
    const out = parseTmdbImages(raw, "poster");
    expect(out).toHaveLength(2);
    const first = out[0];
    expect(first.source).toBe("tmdb");
    expect(first.url).toBe("https://image.tmdb.org/t/p/original/b.jpg");
    expect(first.thumb_url).toBe("https://image.tmdb.org/t/p/w342/b.jpg");
  });

  it("sorts by vote descending", () => {
    expect(parseTmdbImages(raw, "poster").map((c) => c.vote)).toEqual([
      8.1, 5.6,
    ]);
  });

  it("keeps the image language, null included", () => {
    const out = parseTmdbImages(raw, "poster");
    expect(out.map((c) => c.language)).toEqual([null, "en"]);
  });

  it("uses the backdrop thumbnail size for backdrops", () => {
    const out = parseTmdbImages(raw, "backdrop");
    expect(out[0].thumb_url).toBe("https://image.tmdb.org/t/p/w780/c.jpg");
    expect(out[0].url).toBe("https://image.tmdb.org/t/p/original/c.jpg");
  });

  it("skips entries with no file_path", () => {
    expect(parseTmdbImages(raw, "poster").every((c) => c.url.length > 0)).toBe(
      true,
    );
  });

  it("does not cap the list at 12", () => {
    const many = {
      posters: Array.from({ length: 30 }, (_, i) => ({
        file_path: `/p${i}.jpg`,
        width: 1,
        height: 1,
        iso_639_1: "en",
        vote_average: i,
      })),
    };
    expect(parseTmdbImages(many, "poster")).toHaveLength(30);
  });

  it("returns an empty list for a malformed payload", () => {
    expect(parseTmdbImages(null, "poster")).toEqual([]);
    expect(parseTmdbImages({ posters: "nope" }, "poster")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/images/tmdbImageProvider.ts`:

```ts
import type { ArtworkCandidate, ArtworkKind } from "@rawkoon/shared/types";
import { tmdbApiFetch } from "@rawkoon/api/utils/medias/libraryHelpers";
import {
  IMG_BACKDROP_STILL,
  IMG_POSTER_STILL,
} from "@rawkoon/api/utils/medias/tmdbFetcherTypes";

const IMG_ORIGINAL = "https://image.tmdb.org/t/p/original";

/** Languages requested from TMDB; `null` is the textless variant. */
const INCLUDE_IMAGE_LANGUAGE = "en,fr,null";

const toRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

const toNumberOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function parseTmdbImages(
  raw: unknown,
  kind: ArtworkKind,
): ArtworkCandidate[] {
  const root = toRecord(raw);
  if (!root) return [];
  const list = root[kind === "poster" ? "posters" : "backdrops"];
  if (!Array.isArray(list)) return [];

  const thumbBase = kind === "poster" ? IMG_POSTER_STILL : IMG_BACKDROP_STILL;
  const out: ArtworkCandidate[] = [];

  for (const entry of list) {
    const r = toRecord(entry);
    if (!r) continue;
    const path = typeof r.file_path === "string" ? r.file_path.trim() : "";
    if (!path) continue;
    const language = typeof r.iso_639_1 === "string" ? r.iso_639_1 : null;
    out.push({
      url: `${IMG_ORIGINAL}${path}`,
      thumb_url: `${thumbBase}${path}`,
      width: toNumberOrNull(r.width),
      height: toNumberOrNull(r.height),
      language,
      vote: toNumberOrNull(r.vote_average),
      source: "tmdb",
    });
  }

  out.sort((a, b) => (b.vote ?? 0) - (a.vote ?? 0));
  return out;
}

/** Uncapped, language-tagged artwork for the picker — not `media_stills`. */
export async function fetchTmdbArtwork(input: {
  apiKey: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]> {
  try {
    const raw = await tmdbApiFetch<unknown>(
      `${input.mediaType}/${input.tmdbId}/images`,
      input.apiKey,
      { include_image_language: INCLUDE_IMAGE_LANGUAGE },
    );
    return parseTmdbImages(raw, input.kind);
  } catch (e) {
    console.warn(
      `[tmdbImageProvider] images for ${input.mediaType}/${input.tmdbId} failed:`,
      e,
    );
    return [];
  }
}
```

Note: the request deliberately omits `language`. Passing both `language` and `include_image_language` makes TMDB intersect them and drop the textless variants.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
git add apps/api/src/services/images/tmdbImageProvider.ts apps/api/src/services/images/tmdbImageProvider.test.ts
git commit -m "feat(api): fetch uncapped language-tagged artwork from TMDB"
```

---

### Task 3: fanart.tv integration record

**Files:**
- Modify: `apps/api/src/utils/integrations/types.ts` (add `FanartIntegrationConfig`)
- Modify: `apps/api/src/utils/integrations/normalizers.ts` (add `normalizeFanartConfig`)
- Create: `apps/api/src/routes/integrations/fanart/index.ts`
- Modify: `apps/api/src/routes/integrations/index.ts`
- Modify: `apps/shared/src/types/integrations.ts` (add `FanartIntegration`)
- Create: `apps/api/src/utils/integrations/normalizers.fanart.test.ts`

**Interfaces:**
- Consumes: `normalizeSecret` (private to `normalizers.ts`), `encrypt` from `@rawkoon/api/services/crypto`, `getIntegrationConfigRecord` / `invalidateIntegrationConfigCache`.
- Produces:
  - `type FanartIntegrationConfig = { api_key: string }`
  - `normalizeFanartConfig(config: unknown): FanartIntegrationConfig | null`
  - `fanartIntegrationRoutes` — `GET /api/integrations/fanart`, `PUT /api/integrations/fanart`
  - `interface FanartIntegration { type: "fanart"; enabled: boolean; api_key: string }`

Model this task on `apps/api/src/routes/integrations/tmdb/index.ts` — read it first and mirror its structure exactly, minus `popularity_threshold`. The parent router already applies `requireAdmin`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/utils/integrations/normalizers.fanart.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";

mock.module("@rawkoon/api/services/crypto", () => ({
  decrypt: (v: string) => {
    if (v === "bad") throw new Error("cannot decrypt");
    return v.replace(/^enc:/, "");
  },
  encrypt: (v: string) => `enc:${v}`,
}));

const { normalizeFanartConfig } = await import(
  "@rawkoon/api/utils/integrations/normalizers"
);

describe("normalizeFanartConfig", () => {
  it("decrypts the stored key", () => {
    expect(normalizeFanartConfig({ api_key: "enc:abc" })).toEqual({
      api_key: "abc",
    });
  });

  it("returns null when there is no key", () => {
    expect(normalizeFanartConfig({ api_key: "" })).toBeNull();
    expect(normalizeFanartConfig({})).toBeNull();
  });

  it("returns null for a non-object config", () => {
    expect(normalizeFanartConfig(null)).toBeNull();
    expect(normalizeFanartConfig("nope")).toBeNull();
    expect(normalizeFanartConfig([])).toBeNull();
  });

  it("fails closed when the key cannot be decrypted", () => {
    expect(normalizeFanartConfig({ api_key: "bad" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — `normalizeFanartConfig` is not exported.

- [ ] **Step 3: Add the config type and normalizer**

In `apps/api/src/utils/integrations/types.ts`:

```ts
export type FanartIntegrationConfig = {
  api_key: string;
};
```

In `apps/api/src/utils/integrations/normalizers.ts`, add `FanartIntegrationConfig` to the type import block and append:

```ts
export const normalizeFanartConfig = (
  config: unknown,
): FanartIntegrationConfig | null => {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  const apiKey = normalizeSecret((config as Record<string, unknown>).api_key);
  return apiKey ? { api_key: apiKey } : null;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Add the shared response type**

In `apps/shared/src/types/integrations.ts`, next to `TmdbIntegration`:

```ts
export interface FanartIntegration {
  type: "fanart";
  enabled: boolean;
  /** Always "" on read — the stored key is never returned. */
  api_key: string;
}

export interface FanartIntegrationUpdateResponse {
  success: boolean;
  integration: FanartIntegration;
}
```

- [ ] **Step 6: Add the routes**

Create `apps/api/src/routes/integrations/fanart/index.ts`, mirroring the TMDB file:

- `GET /fanart` returns `{ integration: { type: "fanart", enabled: integration?.enabled || false, api_key: "" } }`. Never return the stored key.
- `PUT /fanart` validates `jsonV(z.object({ api_key: z.string(), enabled: z.boolean().optional() }))`, falls back to the existing key when `api_key` is blank (so the UI can toggle `enabled` without retyping the secret), rejects an empty resolved key with `badRequest("api_key is required")`, upserts with `config: { api_key: encrypt(apiKey) }`, calls `invalidateIntegrationConfigCache`, and calls `logActivity` the way the TMDB route does.

Register it in `apps/api/src/routes/integrations/index.ts`:

```ts
import { fanartIntegrationRoutes } from "./fanart";
// ...
  .route("/", fanartIntegrationRoutes)
```

Place the `.route()` call next to the TMDB one; ordering among sibling integration routers does not matter, but keep it grouped.

- [ ] **Step 7: Verify by hand**

```bash
curl -sS -X PUT localhost:3000/api/integrations/fanart \
  -H 'content-type: application/json' -H "Cookie: $RAWKOON_COOKIE" \
  -d '{"api_key":"testkey","enabled":true}' | jq
curl -sS localhost:3000/api/integrations/fanart -H "Cookie: $RAWKOON_COOKIE" | jq
docker compose -p rawkoon-dev exec db psql -U rawkoon -d rawkoon \
  -c "SELECT type, enabled, config FROM integrations WHERE type = 'fanart';"
```

Expected: the GET returns `api_key: ""`, and the stored `config.api_key` is ciphertext, not `testkey`.

- [ ] **Step 8: Typecheck, lint, test, commit**

```bash
bun run typecheck
bun run lint
bun run --filter @rawkoon/api test
git add apps/api/src/utils/integrations apps/api/src/routes/integrations apps/shared/src/types/integrations.ts
git commit -m "feat(api): add fanart.tv integration record and routes"
```

---

### Task 4: TVDB id on external ids

**Files:**
- Modify: `apps/api/src/utils/medias/tmdbFetcherTypes.ts` (`parseExternalIds`, and the `TmdbExternalIds` type it returns)
- Modify: `apps/shared/src/types/media.ts` (`TmdbExternalIds`)
- Create: `apps/api/src/utils/medias/parseExternalIds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TmdbExternalIds` gains `tvdb_id: number | null`. `parseExternalIds` populates it.

fanart.tv's TV endpoint is keyed by TVDB id, not TMDB id. The id arrives in the same `append_to_response=external_ids` payload already fetched — it is simply dropped today.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/utils/medias/parseExternalIds.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseExternalIds } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";

describe("parseExternalIds", () => {
  it("keeps the tvdb id", () => {
    expect(parseExternalIds({ imdb_id: "tt0903747", tvdb_id: 81189 })?.tvdb_id)
      .toBe(81189);
  });

  it("is null when the id is absent or not a number", () => {
    expect(parseExternalIds({ imdb_id: "tt1" })?.tvdb_id).toBeNull();
    expect(parseExternalIds({ tvdb_id: "81189" })?.tvdb_id).toBeNull();
    expect(parseExternalIds({ tvdb_id: null })?.tvdb_id).toBeNull();
  });

  it("still returns null for a non-object", () => {
    expect(parseExternalIds(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — `tvdb_id` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `apps/shared/src/types/media.ts`, add `tvdb_id: number | null;` to `TmdbExternalIds`.

In `apps/api/src/utils/medias/tmdbFetcherTypes.ts`, add to the object `parseExternalIds` returns:

```ts
    tvdb_id: toNumberOrNull(row.tvdb_id),
```

`toNumberOrNull` is already imported in that file.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Fix any newly-broken object literals**

Adding a required field to `TmdbExternalIds` breaks any literal that constructs one. Find them:

```bash
bun run typecheck
```

`apps/web/src/pages/medias/_component/LibraryItemSearchTab.tsx:36` already sets `tvdb_id: null` — check whether that is the same type or a different one before touching it. Add `tvdb_id: null` to any literal the typechecker flags.

- [ ] **Step 6: Typecheck, lint, test, commit**

```bash
bun run typecheck
bun run lint
bun run --filter @rawkoon/api test
git add apps/api/src/utils/medias/tmdbFetcherTypes.ts apps/api/src/utils/medias/parseExternalIds.test.ts apps/shared/src/types/media.ts
git commit -m "feat(api): keep the tvdb id from TMDB external ids"
```

---

### Task 5: fanart.tv image provider

**Files:**
- Create: `apps/api/src/services/images/fanartProvider.ts`
- Create: `apps/api/src/services/images/fanartProvider.test.ts`

**Interfaces:**
- Consumes: `ArtworkCandidate`, `ArtworkKind` (Task 1); `normalizeFanartConfig` (Task 3); `getIntegrationConfigRecord`.
- Produces:

```ts
export function parseFanartImages(raw: unknown, kind: ArtworkKind): ArtworkCandidate[];

export async function fetchFanartArtwork(input: {
  mediaType: "movie" | "tv";
  /** TMDB id for a movie, TVDB id for a show. */
  providerId: number | null;
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]>;
```

fanart.tv response shape: movies carry `movieposter` and `moviebackground`; shows carry `tvposter` and `showbackground`. Each entry is `{ id, url, lang, likes }` where `lang` is `""` for textless and `likes` is a numeric string. There are no dimensions, and no separate thumbnail — `thumb_url` equals `url`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/images/fanartProvider.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";

const getRecord = mock(async () => ({
  enabled: true,
  config: { api_key: "enc:k" },
}));
mock.module("@rawkoon/api/services/integrationConfigCache", () => ({
  getIntegrationConfigRecord: getRecord,
}));
mock.module("@rawkoon/api/utils/integrations/normalizers", () => ({
  normalizeFanartConfig: (c: unknown) =>
    (c as { api_key?: string })?.api_key ? { api_key: "k" } : null,
}));

const { parseFanartImages, fetchFanartArtwork } = await import(
  "@rawkoon/api/services/images/fanartProvider"
);

const movieRaw = {
  movieposter: [
    { id: "1", url: "https://f/p1.jpg", lang: "en", likes: "3" },
    { id: "2", url: "https://f/p2.jpg", lang: "", likes: "9" },
  ],
  moviebackground: [
    { id: "3", url: "https://f/b1.jpg", lang: "fr", likes: "1" },
  ],
};

const showRaw = {
  tvposter: [{ id: "4", url: "https://f/tp.jpg", lang: "fr", likes: "2" }],
  showbackground: [{ id: "5", url: "https://f/sb.jpg", lang: "", likes: "7" }],
};

describe("parseFanartImages", () => {
  it("maps movie posters, sorted by likes", () => {
    const out = parseFanartImages(movieRaw, "poster");
    expect(out.map((c) => c.url)).toEqual([
      "https://f/p2.jpg",
      "https://f/p1.jpg",
    ]);
    expect(out[0].source).toBe("fanart");
    expect(out[0].vote).toBe(9);
  });

  it("treats an empty lang as language-neutral", () => {
    expect(parseFanartImages(movieRaw, "poster")[0].language).toBeNull();
  });

  it("uses the url as its own thumbnail", () => {
    const c = parseFanartImages(movieRaw, "poster")[0];
    expect(c.thumb_url).toBe(c.url);
  });

  it("reports no dimensions", () => {
    const c = parseFanartImages(movieRaw, "poster")[0];
    expect(c.width).toBeNull();
    expect(c.height).toBeNull();
  });

  it("reads the show keys too", () => {
    expect(parseFanartImages(showRaw, "poster")[0].url).toBe(
      "https://f/tp.jpg",
    );
    expect(parseFanartImages(showRaw, "backdrop")[0].url).toBe(
      "https://f/sb.jpg",
    );
  });

  it("returns an empty list for a malformed payload", () => {
    expect(parseFanartImages(null, "poster")).toEqual([]);
    expect(parseFanartImages({ movieposter: "no" }, "poster")).toEqual([]);
  });
});

describe("fetchFanartArtwork", () => {
  it("returns nothing when the provider id is missing", async () => {
    const out = await fetchFanartArtwork({
      mediaType: "tv",
      providerId: null,
      kind: "poster",
    });
    expect(out).toEqual([]);
  });

  it("returns nothing when the integration is disabled", async () => {
    getRecord.mockImplementationOnce(async () => ({
      enabled: false,
      config: { api_key: "enc:k" },
    }));
    const out = await fetchFanartArtwork({
      mediaType: "movie",
      providerId: 238,
      kind: "poster",
    });
    expect(out).toEqual([]);
  });

  it("returns nothing when no key is configured", async () => {
    getRecord.mockImplementationOnce(async () => ({
      enabled: true,
      config: {},
    }));
    const out = await fetchFanartArtwork({
      mediaType: "movie",
      providerId: 238,
      kind: "poster",
    });
    expect(out).toEqual([]);
  });

  it("returns nothing and does not throw when the request fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      const out = await fetchFanartArtwork({
        mediaType: "movie",
        providerId: 238,
        kind: "poster",
      });
      expect(out).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns nothing on a non-2xx response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as typeof fetch;
    try {
      const out = await fetchFanartArtwork({
        mediaType: "movie",
        providerId: 999,
        kind: "poster",
      });
      expect(out).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/images/fanartProvider.ts`:

```ts
import type { ArtworkCandidate, ArtworkKind } from "@rawkoon/shared/types";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeFanartConfig } from "@rawkoon/api/utils/integrations/normalizers";

const FANART_BASE = "https://webservice.fanart.tv/v3";
const REQUEST_TIMEOUT_MS = 8000;

/** fanart.tv keys the same artwork differently per media type. */
const KEYS: Record<"movie" | "tv", Record<ArtworkKind, string[]>> = {
  movie: { poster: ["movieposter"], backdrop: ["moviebackground"] },
  tv: { poster: ["tvposter"], backdrop: ["showbackground"] },
};

const toRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

export function parseFanartImages(
  raw: unknown,
  kind: ArtworkKind,
): ArtworkCandidate[] {
  const root = toRecord(raw);
  if (!root) return [];

  const out: ArtworkCandidate[] = [];
  const keys = [...KEYS.movie[kind], ...KEYS.tv[kind]];
  for (const key of keys) {
    const list = root[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const r = toRecord(entry);
      if (!r) continue;
      const url = typeof r.url === "string" ? r.url.trim() : "";
      if (!url) continue;
      const lang = typeof r.lang === "string" ? r.lang.trim() : "";
      const likes = Number.parseInt(String(r.likes ?? ""), 10);
      out.push({
        url,
        thumb_url: url,
        width: null,
        height: null,
        language: lang || null,
        vote: Number.isFinite(likes) ? likes : null,
        source: "fanart",
      });
    }
  }

  out.sort((a, b) => (b.vote ?? 0) - (a.vote ?? 0));
  return out;
}

/**
 * Artwork from fanart.tv. Optional by design: a missing key, a missing TVDB id,
 * or any request failure yields an empty list rather than an error.
 */
export async function fetchFanartArtwork(input: {
  mediaType: "movie" | "tv";
  providerId: number | null;
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]> {
  if (input.providerId == null) return [];

  const integration = await getIntegrationConfigRecord("fanart");
  if (!integration?.enabled) return [];
  const config = normalizeFanartConfig(integration.config);
  if (!config) return [];

  const path = input.mediaType === "movie" ? "movies" : "tv";
  const url = `${FANART_BASE}/${path}/${input.providerId}?api_key=${encodeURIComponent(config.api_key)}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseFanartImages(await res.json(), input.kind);
  } catch (e) {
    console.warn(
      `[fanartProvider] ${input.mediaType}/${input.providerId} failed:`,
      e,
    );
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
git add apps/api/src/services/images/fanartProvider.ts apps/api/src/services/images/fanartProvider.test.ts
git commit -m "feat(api): add fanart.tv artwork provider"
```

---

### Task 6: Merge the sources

**Files:**
- Create: `apps/api/src/services/images/artworkService.ts`
- Create: `apps/api/src/services/images/artworkService.test.ts`

**Interfaces:**
- Consumes: `fetchTmdbArtwork` (Task 2), `fetchFanartArtwork` (Task 5), `getLibraryTmdbApiKey`, `fetchTmdbMediaDetails` (for the TVDB id — the details response already carries `external_ids`), `getJsonCache`/`setJsonCache` from `@rawkoon/api/services/cache`.
- Produces:

```ts
export function mergeArtworkCandidates(
  lists: ArtworkCandidate[][],
): ArtworkCandidate[];

export async function getArtworkCandidates(input: {
  tmdbId: number;
  mediaType: "movie" | "tv";
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]>;
```

`mergeArtworkCandidates` dedupes by `url` (first wins) and sorts by `vote` descending, then TMDB before fanart as a stable tiebreak (TMDB votes are 0–10, fanart likes are unbounded counts, so a raw cross-source vote comparison is not meaningful — sort within source, then interleave by source with TMDB first).

Cache key: `medias:artwork-v1:${mediaType}:${tmdbId}:${kind}`. Read the existing `getJsonCache`/`setJsonCache` signatures in `apps/api/src/services/cache.ts` before use — match how `tmdbFetcherDetails` calls them, including its TTL argument.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/images/artworkService.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mergeArtworkCandidates } from "@rawkoon/api/services/images/artworkService";
import type { ArtworkCandidate } from "@rawkoon/shared/types";

const c = (
  url: string,
  source: "tmdb" | "fanart",
  vote: number | null,
): ArtworkCandidate => ({
  url,
  thumb_url: url,
  width: null,
  height: null,
  language: null,
  vote,
  source,
});

describe("mergeArtworkCandidates", () => {
  it("puts TMDB candidates before fanart ones", () => {
    const out = mergeArtworkCandidates([
      [c("t1", "tmdb", 1)],
      [c("f1", "fanart", 999)],
    ]);
    expect(out.map((x) => x.url)).toEqual(["t1", "f1"]);
  });

  it("sorts by vote within each source", () => {
    const out = mergeArtworkCandidates([
      [c("t1", "tmdb", 1), c("t2", "tmdb", 8)],
      [c("f1", "fanart", 2), c("f2", "fanart", 40)],
    ]);
    expect(out.map((x) => x.url)).toEqual(["t2", "t1", "f2", "f1"]);
  });

  it("dedupes by url, first occurrence wins", () => {
    const out = mergeArtworkCandidates([
      [c("same", "tmdb", 5)],
      [c("same", "fanart", 99)],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("tmdb");
  });

  it("treats a null vote as lowest", () => {
    const out = mergeArtworkCandidates([
      [c("t1", "tmdb", null), c("t2", "tmdb", 1)],
    ]);
    expect(out.map((x) => x.url)).toEqual(["t2", "t1"]);
  });

  it("handles empty input", () => {
    expect(mergeArtworkCandidates([])).toEqual([]);
    expect(mergeArtworkCandidates([[], []])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/images/artworkService.ts`:

```ts
import type { ArtworkCandidate, ArtworkKind } from "@rawkoon/shared/types";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { getLibraryTmdbApiKey } from "@rawkoon/api/utils/medias/libraryHelpers";
import { fetchTmdbArtwork } from "@rawkoon/api/services/images/tmdbImageProvider";
import { fetchFanartArtwork } from "@rawkoon/api/services/images/fanartProvider";
import { fetchTmdbMediaDetails } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";

const CACHE_TTL_SECONDS = 60 * 60 * 6;

/**
 * TMDB votes (0-10) and fanart likes (unbounded counts) are not comparable, so
 * each source is sorted on its own scale and TMDB is listed first.
 */
export function mergeArtworkCandidates(
  lists: ArtworkCandidate[][],
): ArtworkCandidate[] {
  const bySource = (source: ArtworkCandidate["source"]) =>
    lists
      .flat()
      .filter((c) => c.source === source)
      .sort((a, b) => (b.vote ?? -1) - (a.vote ?? -1));

  const seen = new Set<string>();
  const out: ArtworkCandidate[] = [];
  for (const candidate of [...bySource("tmdb"), ...bySource("fanart")]) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    out.push(candidate);
  }
  return out;
}

/** Every poster or backdrop the configured sources know about, cached. */
export async function getArtworkCandidates(input: {
  tmdbId: number;
  mediaType: "movie" | "tv";
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]> {
  const cacheKey = `medias:artwork-v1:${input.mediaType}:${input.tmdbId}:${input.kind}`;
  const cached = await getJsonCache<ArtworkCandidate[]>(cacheKey);
  if (cached) return cached;

  const apiKey = await getLibraryTmdbApiKey();
  if (!apiKey) return [];

  // Shows need a TVDB id for fanart; it rides along on the cached details call.
  const details =
    input.mediaType === "tv"
      ? await fetchTmdbMediaDetails(apiKey, "tv", input.tmdbId)
      : null;
  const providerId =
    input.mediaType === "movie"
      ? input.tmdbId
      : (details?.external_ids?.tvdb_id ?? null);

  const [tmdb, fanart] = await Promise.all([
    fetchTmdbArtwork({
      apiKey,
      mediaType: input.mediaType,
      tmdbId: input.tmdbId,
      kind: input.kind,
    }),
    fetchFanartArtwork({
      mediaType: input.mediaType,
      providerId,
      kind: input.kind,
    }),
  ]);

  const merged = mergeArtworkCandidates([tmdb, fanart]);
  await setJsonCache(cacheKey, merged, CACHE_TTL_SECONDS);
  return merged;
}
```

Verify the exported name and signature of the details fetcher in `apps/api/src/utils/medias/tmdbFetcherDetails.ts` (the function taking `apiKey, mediaType, tmdbId, language`) and the `getJsonCache`/`setJsonCache` signatures in `apps/api/src/services/cache.ts` before running — adjust the call sites to match rather than assuming.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
git add apps/api/src/services/images/artworkService.ts apps/api/src/services/images/artworkService.test.ts
git commit -m "feat(api): merge TMDB and fanart artwork candidates"
```

---

### Task 7: GET /api/library/:id/images

**Files:**
- Create: `apps/api/src/routes/library/libraryImagesRoutes.ts`
- Modify: `apps/api/src/routes/library/index.ts`

**Interfaces:**
- Consumes: `getArtworkCandidates` (Task 6); `requireUser` from `@rawkoon/api/middleware/hono/auth`; `queryV` from `@rawkoon/api/middleware/validate`.
- Produces: `libraryImagesRoutes` — `GET /api/library/:id/images?kind=poster|backdrop` returning `{ candidates: ArtworkCandidate[] }`.

Read `apps/api/src/routes/library/index.ts` first: each sub-router carries its own prefix and the order of `.use()`/`.route()` matters because rate-limit and auth plugins sit between them. Mount this one beside `libraryMetaRoutes`.

`kind` defaults to `"poster"` when absent, and an unrecognized value is a `badRequest` — not a silent fallback, because a typo would otherwise return posters where the caller wanted backdrops.

- [ ] **Step 1: Write the failing cases**

Add to the library case file under `apps/api/e2e/` (find it with `rg -l 'api/library' apps/api/e2e`), following the file's existing case shape:

- `GET /api/library/:id/images` on a seeded media → 200, body has a `candidates` array.
- `GET /api/library/:id/images?kind=backdrop` → 200.
- `GET /api/library/:id/images?kind=nonsense` → 400.
- `GET /api/library/999999/images` → 404.
- `GET /api/library/:id/images` unauthenticated → 401.

Read `apps/api/e2e/README.md` before writing: the sweep dispatches in-process because the sandbox kills listening sockets, and it has its own seed/mock conventions.

- [ ] **Step 2: Run the sweep to verify it fails**

Run the sweep the way `apps/api/e2e/README.md` documents.
Expected: FAIL — route not mounted (404 on every case).

- [ ] **Step 3: Write the route**

Create `apps/api/src/routes/library/libraryImagesRoutes.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { queryV } from "@rawkoon/api/middleware/validate";
import { getArtworkCandidates } from "@rawkoon/api/services/images/artworkService";

const imagesQuery = z.object({
  kind: z.enum(["poster", "backdrop"]).optional(),
});

/**
 * Poster and backdrop candidates for the artwork picker.
 * GET /api/library/:id/images
 */
export const libraryImagesRoutes = new Hono<Env>().get(
  "/:id/images",
  requireUser,
  queryV(imagesQuery),
  async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return badRequest("Invalid id");
    const { kind = "poster" } = c.req.valid("query");

    try {
      const media = await prisma.libraryMedia.findUnique({
        where: { id },
        select: { tmdbId: true, type: true },
      });
      if (!media) return notFound("Library item not found");

      const candidates = await getArtworkCandidates({
        tmdbId: media.tmdbId,
        mediaType: media.type === "movie" ? "movie" : "tv",
        kind,
      });
      return ok({ candidates });
    } catch (error) {
      console.error("Error fetching artwork candidates:", error);
      return serverError("Failed to fetch artwork candidates");
    }
  },
);
```

`z.enum` rejects an unrecognized `kind`, and `queryV` turns that into the API's standard `400 { error }` — this is what makes the `?kind=nonsense` case pass.

Mount it in `apps/api/src/routes/library/index.ts` with `.route("/", libraryImagesRoutes)`, placed next to `libraryMetaRoutes`.

- [ ] **Step 4: Run the sweep to verify it passes**

Run the sweep again.
Expected: PASS on all five cases.

- [ ] **Step 5: Verify by hand**

```bash
curl -sS "localhost:3000/api/library/1/images?kind=poster" \
  -H "Cookie: $RAWKOON_COOKIE" | jq '.candidates | length, .[0]'
curl -sS "localhost:3000/api/library/1/images?kind=backdrop" \
  -H "Cookie: $RAWKOON_COOKIE" | jq '.candidates | length'
```

Expected: a non-empty list with `source: "tmdb"` even when fanart is unconfigured. Disable the fanart integration and confirm the call still succeeds.

- [ ] **Step 6: Typecheck, lint, test, commit**

```bash
bun run typecheck
bun run lint
bun run --filter @rawkoon/api test
git add apps/api/src/routes/library/libraryImagesRoutes.ts apps/api/src/routes/library/index.ts apps/api/e2e
git commit -m "feat(api): serve poster and backdrop candidates"
```

---

### Task 8: backdrop_url override

**Files:**
- Modify: `apps/api/src/routes/library/libraryHelpers.ts` (`mapLibraryMedia`)
- Modify: `apps/shared/src/types/media.ts` (`LibraryMedia`)
- Modify: `apps/web/src/pages/medias/_component/LibraryItemHero.tsx:57`
- Modify: `apps/web/src/pages/medias/_component/ExploreCardDetailDialog.tsx:142`
- Modify: `apps/api/src/routes/library/libraryHelpers.test.ts` (create if absent)

**Interfaces:**
- Consumes: the existing `overrides` JSON merge in `libraryMetaRoutes.ts:324` — no route change is needed; it already merges arbitrary fields and removes a key on `null`.
- Produces: `LibraryMedia.backdrop_url: string | null` in the API response, sourced from `overrides.backdrop_url`.

`poster_url` already works this way (`mapLibraryMedia` reads `ov.poster_url`). This task gives backdrops the same treatment.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routes/library/libraryHelpers.test.ts`:

```ts
describe("mapLibraryMedia backdrop override", () => {
  it("is null with no override", () => {
    expect(mapLibraryMedia(base).backdrop_url).toBeNull();
  });

  it("returns the override when set", () => {
    const item = { ...base, overrides: { backdrop_url: "https://x/b.jpg" } };
    expect(mapLibraryMedia(item).backdrop_url).toBe("https://x/b.jpg");
  });

  it("ignores a non-string override", () => {
    const item = { ...base, overrides: { backdrop_url: 42 } };
    expect(mapLibraryMedia(item).backdrop_url).toBeNull();
  });
});
```

If this file does not exist yet, create it with a `base` fixture built from the fields `mapLibraryMedia` requires (see the existing call sites for the shape).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @rawkoon/api test`
Expected: FAIL — `backdrop_url` is not in the response.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/routes/library/libraryHelpers.ts`, in the returned object, next to `poster_url`:

```ts
    backdrop_url:
      typeof ov.backdrop_url === "string" ? ov.backdrop_url : null,
```

In `apps/shared/src/types/media.ts`, add `backdrop_url: string | null;` to `LibraryMedia`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @rawkoon/api test`
Expected: PASS.

- [ ] **Step 5: Prefer the override in the UI**

`LibraryItemHero.tsx:57` currently reads:

```tsx
    detailsData?.media_stills?.backdrops?.[0]?.url ??
```

Put the override ahead of it in the same `??` chain:

```tsx
    item.backdrop_url ??
    detailsData?.media_stills?.backdrops?.[0]?.url ??
```

using whatever the component's library-item variable is actually named. Apply the same change at `ExploreCardDetailDialog.tsx:142` — but only if that component has a library item in scope; an explore card for a media not in the library has no overrides, so if there is no library item there, leave it alone.

- [ ] **Step 6: Verify by hand**

```bash
curl -sS -X PATCH localhost:3000/api/library/1/overrides \
  -H 'content-type: application/json' -H "Cookie: $RAWKOON_COOKIE" \
  -d '{"backdrop_url":"https://image.tmdb.org/t/p/original/test.jpg"}' | jq
curl -sS localhost:3000/api/library/item/1 -H "Cookie: $RAWKOON_COOKIE" \
  | jq '.item.backdrop_url'
curl -sS -X PATCH localhost:3000/api/library/1/overrides \
  -H 'content-type: application/json' -H "Cookie: $RAWKOON_COOKIE" \
  -d '{"backdrop_url":null}' | jq
curl -sS localhost:3000/api/library/item/1 -H "Cookie: $RAWKOON_COOKIE" \
  | jq '.item.backdrop_url'
```

Expected: the URL, then `null` after clearing.

- [ ] **Step 7: Typecheck, lint, test, commit**

```bash
bun run typecheck
bun run lint
bun run --filter @rawkoon/api test
env -u NODE_ENV bun run --filter @rawkoon/web test
git add apps/api/src/routes/library/libraryHelpers.ts apps/api/src/routes/library/libraryHelpers.test.ts apps/shared/src/types/media.ts apps/web/src/pages/medias/_component
git commit -m "feat: honor a backdrop_url override"
```

---

### Task 9: Artwork data hooks

**Files:**
- Create: `apps/web/src/features/medias/hooks/useArtworkCandidates.ts`
- Create: `apps/web/src/features/medias/hooks/useUpdateLibraryArtwork.ts`
- Modify: `apps/web/src/lib/endpoints/library.ts`
- Modify: `apps/web/src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: `GET /api/library/:id/images` (Task 7), `PATCH /api/library/:id/overrides` (existing, already at `LIBRARY_ENDPOINTS.UPDATE_OVERRIDES`), `ArtworkCandidate`/`ArtworkKind` (Task 1).
- Produces:
  - `useArtworkCandidates(id: number, kind: ArtworkKind, enabled: boolean)` → TanStack `useQuery<{ candidates: ArtworkCandidate[] }>`
  - `useUpdateLibraryArtwork()` → `useMutation<{ item: LibraryMedia }, Error, { id: number; kind: ArtworkKind; url: string | null }>`
  - `LIBRARY_ENDPOINTS.IMAGES: (id: number) => string`
  - `queryKeys.library.artwork: (id: number, kind: string) => readonly [...]`

Model both hooks on `apps/web/src/features/medias/hooks/useUpdateLibrarySearchTitle.ts` — `useFetcher` from `@/lib/api/context`, endpoints from `@/lib/endpoints`, and `invalidateQueries({ queryKey: queryKeys.library.all })` on success.

`useUpdateLibraryArtwork` maps `kind` to the override field: `poster` → `poster_url`, `backdrop` → `backdrop_url`. Passing `url: null` clears it, which the existing merge already handles.

- [ ] **Step 1: Add the endpoint and query key**

In `apps/web/src/lib/endpoints/library.ts`, next to `UPDATE_OVERRIDES`:

```ts
  IMAGES: (id: number) => `/api/library/${id}/images`,
```

In `apps/web/src/lib/queryKeys.ts`, in the `library` group:

```ts
    artwork: (id: number, kind: string) =>
      [...queryKeys.library.all, "artwork", id, kind] as const,
```

Match the group's existing style — if the other entries spread `queryKeys.library.all`, do that; if they write literal strings, do that.

- [ ] **Step 2: Write the query hook**

Create `apps/web/src/features/medias/hooks/useArtworkCandidates.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { ArtworkCandidate, ArtworkKind } from "@rawkoon/shared/types";

/** Candidates are only fetched once the picker for that kind is open. */
export function useArtworkCandidates(
  id: number,
  kind: ArtworkKind,
  enabled: boolean,
) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.artwork(id, kind),
    queryFn: () =>
      fetcher<{ candidates: ArtworkCandidate[] }>(
        `${LIBRARY_ENDPOINTS.IMAGES(id)}?kind=${kind}`,
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 3: Write the mutation hook**

Create `apps/web/src/features/medias/hooks/useUpdateLibraryArtwork.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { ArtworkKind, LibraryMedia } from "@rawkoon/shared/types";

const OVERRIDE_FIELD: Record<ArtworkKind, "poster_url" | "backdrop_url"> = {
  poster: "poster_url",
  backdrop: "backdrop_url",
};

export function useUpdateLibraryArtwork() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      kind,
      url,
    }: {
      id: number;
      kind: ArtworkKind;
      url: string | null;
    }) =>
      fetcher<{ item: LibraryMedia }>(LIBRARY_ENDPOINTS.UPDATE_OVERRIDES(id), {
        method: "PATCH",
        body: { [OVERRIDE_FIELD[kind]]: url },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
```

Check the `fetcher` signature in `@/lib/api/context` and the PATCH shape used by `useUpdateLibrarySearchTitle` — if `body` there is a pre-stringified value rather than an object, match that instead.

- [ ] **Step 4: Typecheck, lint and commit**

```bash
bun run typecheck
bun run lint
git add apps/web/src/features/medias/hooks/useArtworkCandidates.ts apps/web/src/features/medias/hooks/useUpdateLibraryArtwork.ts apps/web/src/lib/endpoints/library.ts apps/web/src/lib/queryKeys.ts
git commit -m "feat(web): add artwork candidate and override hooks"
```

---

### Task 10: Artwork picker section

**Files:**
- Create: `apps/web/src/pages/medias/_component/LibraryImagePickerSection.tsx`
- Create: `apps/web/src/pages/medias/_component/__tests__/LibraryImagePickerSection.test.tsx`
- Modify: `apps/web/src/pages/medias/_component/LibraryManagementPanel.tsx`
- Modify: `apps/web/src/locales/en/common.json`
- Modify: `apps/web/src/locales/fr/common.json`

**Interfaces:**
- Consumes: `useArtworkCandidates`, `useUpdateLibraryArtwork` (Task 9); `ManagementSection` from `./LibrarySharedUI`; `languageDisplayName` from `@/lib/utils/languageDisplayName`.
- Produces: `LibraryImagePickerSection({ libraryId, item }: { libraryId: number; item: LibraryMedia })`.

Read `LibrarySearchTitleSection.tsx` first — this component sits next to it in the same panel and must match its structure: `ManagementSection` wrapper with a lucide icon and a translated title, `useTranslation("common")`, `toast` from `sonner` on mutation failure, and `disabled` while the mutation is pending.

Behavior:
- Two tabs, Poster and Backdrop; the selected kind drives which query runs.
- Candidates are only fetched for the active kind (`enabled` on the query).
- Language filter chips: All, then one chip per distinct `language` present in the candidates (labelled through `languageDisplayName`), plus a "No language" chip when any candidate has `language === null`.
- Each grid cell shows `thumb_url`, a source badge (`TMDB` / `fanart`), and is marked when its `url` equals the item's current `poster_url`/`backdrop_url`.
- Clicking a cell calls the mutation with that `url`.
- A "Reset to default" button calls the mutation with `url: null`, shown only when an override is currently set.

New i18n keys, added to both `en` and `fr` catalogs under `library.management`:
`artwork` (section title), `artworkPoster`, `artworkBackdrop`, `artworkAllLanguages`, `artworkNoLanguage`, `artworkReset`, `artworkEmpty`, `artworkError`.

Note the standing gap: custom components in this codebase take `String`, not `LocalizedStringKey`, so pass already-translated strings down rather than keys.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/medias/_component/__tests__/LibraryImagePickerSection.test.tsx`. Follow the setup of a neighbouring test in that `__tests__` directory (query client wrapper, i18n mock). Cases:

```
- renders a grid cell per candidate returned for the active kind
- switching to the Backdrop tab requests kind=backdrop
- the language chips list each distinct candidate language plus All
- selecting a language chip narrows the grid to that language
- the "No language" chip shows only candidates with a null language
- the cell matching item.poster_url is marked as current
- clicking a cell calls the mutation with that candidate's full url
- "Reset to default" calls the mutation with null and is hidden when no override is set
- an empty candidate list renders the empty-state string, not a blank grid
```

Mock `useArtworkCandidates` and `useUpdateLibraryArtwork` at the module level so the test drives the component, not the network.

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV bun run --filter @rawkoon/web test`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

Create `LibraryImagePickerSection.tsx` implementing the behavior above. Keep it a single focused component: tab state, language-filter state, and the derived filtered list are all local `useState`/`useMemo`; everything else comes from the two hooks.

Grid: a responsive CSS grid that holds a sensible minimum cell width at phone width. Posters are 2:3, backdrops 16:9 — set `aspect-ratio` per kind so the grid does not reflow when switching tabs.

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV bun run --filter @rawkoon/web test`
Expected: PASS.

- [ ] **Step 5: Mount it in the panel**

In `LibraryManagementPanel.tsx`, import the component and render it next to `<LibrarySearchTitleSection ... />` (around line 55), passing `libraryId` and `item`.

- [ ] **Step 6: Add the translations**

Add all eight keys to `apps/web/src/locales/en/common.json` and `apps/web/src/locales/fr/common.json` under `library.management`. Write real French; do not copy the English string.

- [ ] **Step 7: Verify in the browser**

Start `bun run dev:api` and `bun run dev:web`, open a library item's management panel, and confirm: both tabs load, the language chips filter, the current artwork is marked, clicking a candidate changes the poster on the page, and Reset restores the TMDB default. Then narrow the window to ~400px and confirm the grid still fits without horizontal scroll.

- [ ] **Step 8: Typecheck, lint, test, commit**

```bash
bun run typecheck
bun run lint
env -u NODE_ENV bun run --filter @rawkoon/web test
git add apps/web/src/pages/medias/_component apps/web/src/locales
git commit -m "feat(web): add the poster and backdrop picker"
```

---

### Task 11: fanart settings UI

**Files:**
- Modify: the integrations settings page under `apps/web/src/features/integrations/` (find the TMDB card with `rg -l 'tmdb' apps/web/src/features/integrations`)
- Modify: `apps/web/src/locales/en/common.json`
- Modify: `apps/web/src/locales/fr/common.json`

**Interfaces:**
- Consumes: `GET`/`PUT /api/integrations/fanart` (Task 3); `FanartIntegration` (Task 3).
- Produces: no exports — a settings card.

Copy the TMDB integration card and strip the popularity-threshold field. The card needs: an enable toggle, an API key input that shows a "configured" state rather than the key (the GET returns `""` by design), and a save button. Add a one-line hint that a free personal key comes from fanart.tv and that the picker works without it, TMDB-only.

- [ ] **Step 1: Read the TMDB card**

```bash
rg -l 'tmdb' apps/web/src/features/integrations
```

Read the file the search names and note its structure: query hook, mutation hook, form state, and how it renders "key is set" without a value.

- [ ] **Step 2: Add the fanart card**

Mirror it. Reuse the same query/mutation hook pattern the TMDB card uses rather than inventing a new one.

- [ ] **Step 3: Add the translations**

Add the card's strings to both `en` and `fr` catalogs. Write real French.

- [ ] **Step 4: Verify in the browser**

Open Settings → Integrations, save a fanart key, reload, and confirm the card shows as configured with no key echoed back. Then open an item's picker and confirm fanart candidates appear alongside the TMDB ones.

- [ ] **Step 5: Typecheck, lint, test, commit**

```bash
bun run typecheck
bun run lint
env -u NODE_ENV bun run --filter @rawkoon/web test
git add apps/web/src/features/integrations apps/web/src/locales
git commit -m "feat(web): add the fanart.tv integration card"
```

---

### Task 12: Full gate

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Run every gate**

```bash
bun run typecheck
bun run lint
bun run knip
bun run --filter @rawkoon/api test
env -u NODE_ENV bun run --filter @rawkoon/web test
bun run --filter @rawkoon/shared test
bun run build
```

- [ ] **Step 2: Confirm the untouched surfaces**

```bash
git diff main --stat
```

Expected: no change to `parseImageStills`, to the `media_stills` shape, or to the `medias:tmdb-details-v4` cache key. The only edit in `tmdbFetcherTypes.ts` should be the one line added to `parseExternalIds`.

- [ ] **Step 3: Confirm fanart is genuinely optional**

Disable the fanart integration, then:

```bash
curl -sS "localhost:3000/api/library/1/images?kind=poster" \
  -H "Cookie: $RAWKOON_COOKIE" | jq '.candidates | map(.source) | unique'
```

Expected: `["tmdb"]`, status 200. Then delete the integration row entirely and repeat — same result, no error in the API log.
