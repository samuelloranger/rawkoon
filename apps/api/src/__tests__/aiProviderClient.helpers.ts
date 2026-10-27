import { afterEach, beforeEach, mock } from "bun:test";

export const createCall = mock<
  (args: { data: Record<string, unknown> }) => Promise<unknown>
>(async () => ({}));
mock.module("@rawkoon/api/db", () => ({
  prisma: { aiCall: { create: createCall } },
}));

const { validateAiPick, pickReleaseWithAi: pickReleaseWithAiCtx } =
  await import("@rawkoon/api/services/aiProvider/client");
export { validateAiPick, pickReleaseWithAiCtx };

export const ctx = { feature: "release_pick_rss" as const, mediaId: 7 };
export const pickReleaseWithAi = (
  c: Parameters<typeof pickReleaseWithAiCtx>[0],
  m: Parameters<typeof pickReleaseWithAiCtx>[1],
  r: Parameters<typeof pickReleaseWithAiCtx>[2],
) => pickReleaseWithAiCtx(c, m, r, ctx);

export const rows = () => createCall.mock.calls.map((c) => c[0].data);

export const candidates = [
  { key: "guid-a", title: "A", size_bytes: null, seeders: null, score: 100 },
  { key: "guid-b", title: "B", size_bytes: null, seeders: null, score: 200 },
];

export const config = {
  base_url: "http://ai-provider.test",
  model: "test-model",
};
export const media = { title: "Movie", year: 2024, type: "movie" };

const realFetch = globalThis.fetch;

/** Wraps content in an OpenAI chat-completion envelope. */
export function completion(content: string) {
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

export type Reply = { content?: string; status?: number; raw?: string };

/**
 * Replies with each entry in turn, repeating the last, and records every
 * outgoing request body so the wire format can be asserted.
 */
export function mockSequence(replies: Reply[]) {
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

export const mockCompletion = (content: string) => mockSequence([{ content }]);

export const responseFormatOf = (body?: Record<string, unknown>) =>
  body?.response_format as { type: string } | undefined;

/** Registers the per-test resets; call once at the top of each test file. */
export function useAiClientHooks() {
  beforeEach(() => {
    createCall.mockClear();
    createCall.mockImplementation(async () => ({}));
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
}
