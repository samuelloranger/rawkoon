import { describe, it, expect } from "bun:test";
import {
  candidates,
  config,
  ctx,
  createCall,
  media,
  mockCompletion,
  mockSequence,
  pickReleaseWithAi,
  pickReleaseWithAiCtx,
  responseFormatOf,
  rows,
  useAiClientHooks,
  validateAiPick,
} from "./aiProviderClient.helpers";

useAiClientHooks();

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

describe("pickReleaseWithAi usage ledger", () => {
  const at = (host: string) => ({ base_url: `http://${host}`, model: "m" });

  it("records an ok row with tokens, the picked title and the context", async () => {
    mockCompletion('{"release_key":"r0","reasoning":"Best seeds"}');
    await pickReleaseWithAi(at("ledger-ok"), media, candidates);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      feature: "release_pick_rss",
      model: "m",
      structured: true,
      status: "ok",
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      mediaId: 7,
      bookEditionId: null,
      pickedTitle: "B",
      reasoning: "Best seeds",
      error: null,
    });
    expect(typeof rows()[0]?.durationMs).toBe("number");
  });

  it("records invalid_pick when the model names a key outside the shortlist", async () => {
    mockCompletion('{"release_key":"nope","reasoning":"x"}');
    await pickReleaseWithAi(at("ledger-invalid"), media, candidates);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      status: "invalid_pick",
      totalTokens: 2,
      pickedTitle: null,
    });
  });

  it("records a sanitised error row when the provider fails", async () => {
    mockSequence([{ status: 401 }]);
    await pickReleaseWithAi(at("ledger-error"), media, candidates);

    // Structured attempt and its json_object retry both failed.
    expect(rows().map((r) => r.status)).toEqual(["error", "error"]);
    expect(rows()[0]?.error).toContain("HTTP 401");
    expect(rows()[0]?.inputTokens).toBeNull();
  });

  it("writes one row per attempt when the structured call falls back", async () => {
    mockSequence([
      { status: 400 },
      { content: '{"release_key":"r0","reasoning":"ok"}' },
    ]);
    await pickReleaseWithAi(at("ledger-fallback"), media, candidates);

    expect(rows().map((r) => [r.status, r.structured])).toEqual([
      ["error", true],
      ["ok", false],
    ]);
  });

  it("never lets a failing ledger write break or fail the pick", async () => {
    createCall.mockImplementation(async () => {
      throw new Error("db down");
    });
    mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    const result = await pickReleaseWithAi(
      at("ledger-down"),
      media,
      candidates,
    );
    expect(result?.release_key).toBe("guid-b");

    createCall.mockImplementation(() => {
      throw new Error("sync boom");
    });
    mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    const again = await pickReleaseWithAi(
      at("ledger-down2"),
      media,
      candidates,
    );
    expect(again?.release_key).toBe("guid-b");
  });

  it("records rate_limited for a 429 and agreement with the classic pick", async () => {
    mockSequence([{ status: 429 }]);
    await pickReleaseWithAiCtx(at("ledger-429"), media, candidates, ctx);
    expect(rows()[0]?.status).toBe("rate_limited");

    createCall.mockClear();
    mockCompletion('{"release_key":"r0","reasoning":"ok"}');
    const withClassic = (classicTitle: string) =>
      pickReleaseWithAiCtx(at("ledger-agree"), media, candidates, {
        ...ctx,
        trigger: "rss",
        classicTitle,
      });
    await withClassic("B");
    await withClassic("A");
    await pickReleaseWithAi(at("ledger-agree"), media, candidates);
    expect(rows().map((r) => [r.trigger, r.agreedWithClassic])).toEqual([
      ["rss", true],
      ["rss", false],
      [null, null],
    ]);
  });

  it("scrubs URLs out of stored error text", async () => {
    const { sanitizeAiError } = await import(
      "@rawkoon/api/services/aiProvider/usageLedger"
    );
    expect(
      sanitizeAiError(new Error("fetch https://x.test/v1?key=SECRET failed")),
    ).toBe("fetch [url] failed");
  });
});
