import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";

const createCall = mock<
  (args: { data: Record<string, unknown> }) => Promise<unknown>
>(async () => ({}));
let integration: { enabled: boolean; config: unknown } | null = null;
let blocklisted: string[] = [];
mock.module("@rawkoon/api/db", () => ({
  prisma: {
    aiCall: { create: createCall },
    grabBlocklist: {
      findMany: async () =>
        blocklisted.map((releaseTitle) => ({ releaseTitle })),
    },
    integration: { findFirst: async () => integration },
  },
}));

const { pickBookCandidate } = await import(
  "@rawkoon/api/services/books/bookAiPick"
);
const { invalidateIntegrationConfigCache } = await import(
  "@rawkoon/api/services/integrationConfigCache"
);
const { buildAiBookPickPrompt } = await import(
  "@rawkoon/api/utils/books/buildAiBookPickPrompt"
);

const SECRET_URL = "https://tracker.test/dl?apikey=SECRET&id=";

const edition = {
  editionId: 42,
  kind: "audiobook" as const,
  bookTitle: "Le Nom du vent",
  authors: ["Patrick Rothfuss"],
  bookLanguage: "fr",
  seriesName: "Chronique du tueur de roi",
  seriesPosition: 1,
  profile: {} as never,
};

const releases = [
  { id: "a", title: "Tome 2 audiobook", score: 900 },
  { id: "b", title: "Tome 1 audiobook", score: 800 },
];

const describe_ = (r: (typeof releases)[number]) => ({
  url: `${SECRET_URL}${r.id}`,
  title: r.title,
  sizeBytes: 1e9,
  seeders: 5,
  score: r.score,
  format: "m4b",
  kind: "audiobook",
  language: "fr",
  audioBitrate: 64,
});

const realFetch = globalThis.fetch;
let bodies: string[] = [];

function reply(content: string) {
  globalThis.fetch = (async (_i: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return new Response(
      JSON.stringify({
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  bodies = [];
  blocklisted = [];
  createCall.mockClear();
  invalidateIntegrationConfigCache();
  integration = {
    enabled: true,
    config: { base_url: "http://ai.test", model: "m" },
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("buildAiBookPickPrompt", () => {
  it("carries series position, kind, language and bitrate", () => {
    const prompt = buildAiBookPickPrompt(
      {
        title: "T",
        authors: ["A"],
        kind: "audiobook",
        language: "fr",
        seriesName: "S",
        seriesPosition: 2,
      },
      [
        {
          key: "r0",
          title: "rel",
          size_bytes: 1e9,
          seeders: 3,
          score: 10,
          format: "m4b",
          kind: "audiobook",
          language: "fr",
          audio_bitrate: 64,
        },
      ],
    );
    expect(prompt).toContain("Series: S #2");
    expect(prompt).toContain("Wanted: audiobook");
    expect(prompt).toContain("Language: fr");
    expect(prompt).toContain("bitrate:64kbps");
  });
});

describe("pickBookCandidate", () => {
  it("grabs the AI pick first and flags it", async () => {
    reply('{"release_key":"r1","reasoning":"right tome"}');
    const out = await pickBookCandidate(
      edition,
      releases,
      "scheduled",
      describe_,
    );
    expect(out.pick.id).toBe("b");
    expect(out.aiPicked).toBe(true);
  });

  it("never sends download URLs and includes series context", async () => {
    reply('{"release_key":"r0","reasoning":"ok"}');
    await pickBookCandidate(edition, releases, "rss", describe_);
    expect(bodies[0]).not.toContain("SECRET");
    expect(bodies[0]).not.toContain("tracker.test");
    expect(bodies[0]).toContain("Chronique du tueur de roi #1");
  });

  it("falls back to the classic best when the pick is invalid", async () => {
    reply('{"release_key":"nope","reasoning":"x"}');
    const out = await pickBookCandidate(
      edition,
      releases,
      "scheduled",
      describe_,
    );
    expect(out).toEqual({ pick: releases[0], aiPicked: false });
  });

  it("falls back when the provider errors", async () => {
    globalThis.fetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const out = await pickBookCandidate(
      edition,
      releases,
      "upgrade",
      describe_,
    );
    expect(out).toEqual({ pick: releases[0], aiPicked: false });
  });

  it("skips the model when AI is disabled or one candidate remains", async () => {
    reply('{"release_key":"r1","reasoning":"x"}');
    integration = { enabled: false, config: null };
    expect(
      (await pickBookCandidate(edition, releases, "rss", describe_)).aiPicked,
    ).toBe(false);
    integration = {
      enabled: true,
      config: { base_url: "http://ai.test", model: "m" },
    };
    invalidateIntegrationConfigCache();
    await pickBookCandidate(edition, [releases[0]!], "rss", describe_);
    expect(bodies).toHaveLength(0);
  });

  it("never offers the judge a blocklisted release", async () => {
    const three = [
      ...releases,
      { id: "c", title: "Tome 1 retail", score: 700 },
    ];
    blocklisted = ["Tome 1 audiobook"];
    reply('{"release_key":"r1","reasoning":"retail"}');
    const out = await pickBookCandidate(edition, three, "rss", describe_);
    expect(bodies[0]).not.toContain("Tome 1 audiobook");
    expect(out).toEqual({ pick: three[2], aiPicked: true });
  });

  it("uses the classic best when blocklisting leaves one candidate", async () => {
    blocklisted = ["Tome 1 audiobook"];
    reply('{"release_key":"r0","reasoning":"x"}');
    const out = await pickBookCandidate(edition, releases, "rss", describe_);
    expect(bodies).toHaveLength(0);
    expect(out).toEqual({ pick: releases[0], aiPicked: false });
  });

  it("records the ledger context", async () => {
    reply('{"release_key":"r1","reasoning":"right tome"}');
    await pickBookCandidate(edition, releases, "manual_search", describe_);
    const row = createCall.mock.calls[0]![0].data;
    expect(row.feature).toBe("book_release_pick");
    expect(row.trigger).toBe("manual_search");
    expect(row.bookEditionId).toBe(42);
    expect(row.classicTitle).toBe("Tome 2 audiobook");
    expect(row.pickedTitle).toBe("Tome 1 audiobook");
    expect(row.agreedWithClassic).toBe(false);
  });
});
