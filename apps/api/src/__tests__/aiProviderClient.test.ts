import { describe, it, expect, afterEach } from "bun:test";
import {
  validateAiPick,
  pickReleaseWithAi,
} from "@rawkoon/api/services/aiProvider/client";

const candidates = [
  { key: "guid-a", title: "A", size_bytes: null, seeders: null, score: 100 },
  { key: "guid-b", title: "B", size_bytes: null, seeders: null, score: 200 },
];

const config = { base_url: "http://ai-provider.test", model: "test-model" };
const media = { title: "Movie", year: 2024, type: "movie" };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Wraps content in an OpenAI chat-completion envelope. */
function completion(content: string) {
  return JSON.stringify({
    id: "c1",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

type Reply = { content?: string; status?: number; raw?: string };

/**
 * Replies with each entry in turn, repeating the last, and records every
 * outgoing request body so the wire format can be asserted.
 */
function mockSequence(replies: Reply[]) {
  const bodies: Array<Record<string, unknown>> = [];
  let i = 0;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    if (init?.body) {
      const parsed = JSON.parse(init.body as string);
      parsed.__headers = new Headers(init.headers).get("authorization");
      bodies.push(parsed);
    }
    const reply = replies[Math.min(i++, replies.length - 1)] ?? {};
    const status = reply.status ?? 200;
    const body =
      reply.raw ?? (status === 200 ? completion(reply.content ?? "") : "error");
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return bodies;
}

const mockCompletion = (content: string) => mockSequence([{ content }]);

const responseFormatOf = (body?: Record<string, unknown>) =>
  body?.response_format as { type: string } | undefined;

describe("validateAiPick", () => {
  it("accepts a key present in the candidate set", () => {
    expect(
      validateAiPick(
        { release_key: "guid-b", reasoning: "Best seeds" },
        candidates,
      ),
    ).toEqual({ release_key: "guid-b", reasoning: "Best seeds" });
  });

  it("rejects an invented release_key", () => {
    expect(
      validateAiPick({ release_key: "missing", reasoning: "nope" }, candidates),
    ).toBeNull();
  });

  it("truncates reasoning at a word boundary to 150 chars", () => {
    const long = `${"word ".repeat(40)}tail`;
    const result = validateAiPick(
      { release_key: "guid-a", reasoning: long },
      candidates,
    );
    expect(result?.reasoning.length).toBeLessThanOrEqual(150);
    expect(result?.reasoning.endsWith(" ")).toBe(false);
    expect(result?.reasoning).toBe(long.slice(0, 150).trimEnd());
  });

  it("keeps reasoning under the limit untouched", () => {
    expect(
      validateAiPick({ release_key: "guid-a", reasoning: "ok" }, candidates)
        ?.reasoning,
    ).toBe("ok");
  });
});

describe("pickReleaseWithAi", () => {
  it("returns the model's pick on a well-formed response", async () => {
    mockCompletion('{"release_key":"r0","reasoning":"Best seeds"}');
    expect(await pickReleaseWithAi(config, media, candidates)).toEqual({
      release_key: "guid-b",
      reasoning: "Best seeds",
    });
  });

  it("still parses a response wrapped in markdown fences", async () => {
    mockCompletion('```json\n{"release_key":"r0","reasoning":"ok"}\n```');
    const result = await pickReleaseWithAi(config, media, candidates);
    // r0 is the highest-scoring candidate, which is guid-b.
    expect(result?.release_key).toBe("guid-b");
  });

  it("returns null when the model invents a release_key", async () => {
    mockCompletion('{"release_key":"nope","reasoning":"x"}');
    expect(await pickReleaseWithAi(config, media, candidates)).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    mockCompletion("not json at all");
    expect(await pickReleaseWithAi(config, media, candidates)).toBeNull();
  });

  it("returns null when the response omits a required field", async () => {
    mockCompletion('{"reasoning":"missing the key"}');
    expect(await pickReleaseWithAi(config, media, candidates)).toBeNull();
  });

  it("returns null when the server errors", async () => {
    globalThis.fetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;
    expect(await pickReleaseWithAi(config, media, candidates)).toBeNull();
  });

  it("returns null when the transport throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await pickReleaseWithAi(config, media, candidates)).toBeNull();
  });

  it("sends at most 10 candidates, highest-scoring first, as opaque ids", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    const many = Array.from({ length: 25 }, (_, i) => ({
      key: `https://tracker.test/dl?apikey=SECRET${i}`,
      title: `Release ${i}`,
      size_bytes: null,
      seeders: 10,
      score: i,
    }));

    const result = await pickReleaseWithAi(config, media, many);

    // The model answered "r0"; the caller gets the real key back.
    expect(result?.release_key).toBe("https://tracker.test/dl?apikey=SECRET24");

    const prompt = (bodies[0]?.messages as Array<{ content: string }>)
      .map((m) => m.content)
      .join("\n");
    expect(prompt).toContain('key="r0"');
    expect(prompt).toContain('key="r9"');
    expect(prompt).not.toContain('key="r10"');
    // Highest score first, and the top ten are 24..15.
    expect(prompt).toContain("Release 24");
    expect(prompt).not.toContain("Release 14");
  });

  it("never puts a download URL or tracker credential in the prompt", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    await pickReleaseWithAi(config, media, [
      {
        key: "https://tracker.test/torznab?t=get&token=TOKEN123&apikey=KEY456",
        title: "Some Release 1080p",
        size_bytes: null,
        seeders: 5,
        score: 10,
      },
      {
        key: "magnet:?xt=urn:btih:DEADBEEF&tr=udp%3A%2F%2Ftracker.test",
        title: "Some Release 2160p",
        size_bytes: null,
        seeders: 4,
        score: 9,
      },
    ]);

    const prompt = JSON.stringify(bodies[0]?.messages);
    for (const secret of [
      "TOKEN123",
      "KEY456",
      "apikey",
      "magnet:",
      "https://",
    ]) {
      expect(prompt).not.toContain(secret);
    }
  });

  it("drops zero-seeder releases before the model sees them", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    const result = await pickReleaseWithAi(config, media, [
      {
        key: "dead",
        title: "Dead 2160p",
        size_bytes: null,
        seeders: 0,
        score: 999,
      },
      {
        key: "alive",
        title: "Alive 1080p",
        size_bytes: null,
        seeders: 12,
        score: 10,
      },
    ]);

    // The top-scored release is undownloadable, so it is never offered.
    expect(result?.release_key).toBe("alive");
    const prompt = JSON.stringify(bodies[0]?.messages);
    expect(prompt).toContain("Alive 1080p");
    expect(prompt).not.toContain("Dead 2160p");
  });

  it("keeps releases with unknown seeders, as usenet has none", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    const result = await pickReleaseWithAi(config, media, [
      {
        key: "nzb",
        title: "Usenet 1080p",
        size_bytes: null,
        seeders: null,
        score: 50,
      },
    ]);

    expect(result?.release_key).toBe("nzb");
    expect(JSON.stringify(bodies[0]?.messages)).toContain("Usenet 1080p");
  });

  it("returns null when every release is undownloadable", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    const result = await pickReleaseWithAi(config, media, [
      { key: "a", title: "A", size_bytes: null, seeders: 0, score: 5 },
      { key: "b", title: "B", size_bytes: null, seeders: 0, score: 4 },
    ]);

    expect(result).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it("does not call the model when there are no releases", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"x"}');
    expect(await pickReleaseWithAi(config, media, [])).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it("constrains the model with a strict json_schema response_format", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    await pickReleaseWithAi(config, media, candidates);

    expect(bodies).toHaveLength(1);
    const rf = bodies[0]?.response_format as {
      type: string;
      json_schema: { strict: boolean; schema: Record<string, unknown> };
    };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema.required).toEqual([
      "release_key",
      "reasoning",
    ]);
  });

  it("sends no Authorization header when no api_key is configured", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    await pickReleaseWithAi(config, media, candidates);
    expect(bodies[0]?.__headers).toBeNull();
  });

  it("sends the api_key as a bearer token when one is configured", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    await pickReleaseWithAi(
      { ...config, api_key: "gsk-secret" },
      media,
      candidates,
    );
    expect(bodies[0]?.__headers).toBe("Bearer gsk-secret");
  });

  it("posts to the configured base_url with the configured model", async () => {
    const bodies = mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    await pickReleaseWithAi(config, media, candidates);
    expect(bodies[0]?.model).toBe("test-model");
  });
});

// The downgrade cache is module-level, so each of these uses its own endpoint
// to stay independent of test order.
describe("pickReleaseWithAi json_schema fallback", () => {
  const at = (host: string) => ({ base_url: `http://${host}`, model: "m" });

  it("retries with json_object when the server rejects the schema", async () => {
    const bodies = mockSequence([
      { status: 400 },
      { content: '{"release_key":"r0","reasoning":"ok"}' },
    ]);

    const result = await pickReleaseWithAi(at("rejects"), media, candidates);

    expect(result?.release_key).toBe("guid-b");
    expect(bodies).toHaveLength(2);
    expect(responseFormatOf(bodies[0])?.type).toBe("json_schema");
    expect(responseFormatOf(bodies[1])).toEqual({ type: "json_object" });
  });

  it("remembers the downgrade so later calls skip the schema attempt", async () => {
    const bodies = mockSequence([
      { status: 400 },
      { content: '{"release_key":"r0","reasoning":"ok"}' },
    ]);
    const endpoint = at("remembers");

    await pickReleaseWithAi(endpoint, media, candidates);
    expect(bodies).toHaveLength(2);

    await pickReleaseWithAi(endpoint, media, candidates);
    expect(bodies).toHaveLength(3);
    expect(responseFormatOf(bodies[2])).toEqual({ type: "json_object" });
  });

  it("does not remember a downgrade when the server was merely down", async () => {
    const bodies = mockSequence([
      { status: 500 },
      { content: '{"release_key":"r0","reasoning":"ok"}' },
    ]);
    const endpoint = at("flaky");

    await pickReleaseWithAi(endpoint, media, candidates);
    expect(bodies).toHaveLength(2);

    await pickReleaseWithAi(endpoint, media, candidates);
    expect(responseFormatOf(bodies[2])?.type).toBe("json_schema");
  });

  it("does not remember a downgrade when rate limited", async () => {
    const bodies = mockSequence([
      { status: 429 },
      { content: '{"release_key":"r0","reasoning":"ok"}' },
    ]);
    const endpoint = at("throttled");

    await pickReleaseWithAi(endpoint, media, candidates);
    expect(bodies).toHaveLength(2);

    // A quota failure says nothing about schema support.
    await pickReleaseWithAi(endpoint, media, candidates);
    expect(responseFormatOf(bodies[2])?.type).toBe("json_schema");
  });

  it("does not remember a downgrade when the key is rejected", async () => {
    const bodies = mockSequence([
      { status: 401 },
      { content: '{"release_key":"r0","reasoning":"ok"}' },
    ]);
    const endpoint = at("unauthorized");

    await pickReleaseWithAi(endpoint, media, candidates);
    await pickReleaseWithAi(endpoint, media, candidates);
    expect(responseFormatOf(bodies[2])?.type).toBe("json_schema");
  });

  it("returns null when both the schema and the json_object attempt fail", async () => {
    mockSequence([{ status: 400 }, { status: 500 }]);
    expect(
      await pickReleaseWithAi(at("hopeless"), media, candidates),
    ).toBeNull();
  });
});
