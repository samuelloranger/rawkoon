import { describe, it, expect } from "bun:test";
import {
  mockFetch,
  payload,
  useMockFetchReset,
} from "./channelDispatchers.helpers";
import {
  dispatchDiscord,
  dispatchGotify,
  dispatchPushover,
  parseDiscordConfig,
  parseGotifyConfig,
  parsePushoverConfig,
} from "./channelDispatchers";
import type {
  DiscordChannelConfig,
  GotifyChannelConfig,
  PushoverChannelConfig,
} from "@rawkoon/shared";

useMockFetchReset();

describe("dispatchDiscord", () => {
  const config: DiscordChannelConfig = {
    webhook_url: "https://discord.com/api/webhooks/123/abc",
  };

  it("POSTs to the webhook URL with an embed", async () => {
    await dispatchDiscord(config, payload);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://discord.com/api/webhooks/123/abc");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.username).toBe("Rawkoon");
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toBe("Test Title");
    expect(body.embeds[0].description).toBe("Test body");
    expect(body.embeds[0].color).toBe(0x5865f2);
  });

  it("sets embed url when click URL is provided", async () => {
    await dispatchDiscord(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].url).toBe("https://example.com");
  });

  it("omits embed url when no click URL is provided", async () => {
    await dispatchDiscord(config, { title: "T", body: "B" });
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.embeds[0].url).toBeUndefined();
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 }),
    );
    await expect(dispatchDiscord(config, payload)).rejects.toThrow(
      "discord 400",
    );
  });
});

describe("parseDiscordConfig", () => {
  it("returns a typed config when webhook_url is present", () => {
    const parsed = parseDiscordConfig({
      webhook_url: "https://discord.com/api/webhooks/123/abc",
    });
    expect(parsed).toEqual({
      webhook_url: "https://discord.com/api/webhooks/123/abc",
    });
  });

  it("rejects non-object input", () => {
    expect(() => parseDiscordConfig(null)).toThrow(
      "discord config must be an object",
    );
    expect(() => parseDiscordConfig("string")).toThrow(
      "discord config must be an object",
    );
  });

  it("rejects missing webhook_url", () => {
    expect(() => parseDiscordConfig({})).toThrow(
      "discord config: webhook_url is required",
    );
  });

  it("rejects empty webhook_url", () => {
    expect(() => parseDiscordConfig({ webhook_url: "" })).toThrow(
      "discord config: webhook_url is required",
    );
  });
});

describe("dispatchGotify", () => {
  const config: GotifyChannelConfig = {
    url: "https://gotify.example.com",
    token: "A_abc123",
  };

  it("POSTs to {url}/message?token={token}", async () => {
    await dispatchGotify(config, payload);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gotify.example.com/message?token=A_abc123");
    expect(init.method).toBe("POST");
  });

  it("sends title and message in JSON body", async () => {
    await dispatchGotify(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe("Test Title");
    expect(body.message).toBe("Test body\n\nhttps://example.com");
  });

  it("appends click URL to message body when provided", async () => {
    await dispatchGotify(config, {
      title: "T",
      body: "B",
      url: "https://x.com",
    });
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe("B\n\nhttps://x.com");
  });

  it("omits URL suffix when no click URL provided", async () => {
    await dispatchGotify(config, { title: "T", body: "B" });
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe("B");
  });

  it("includes priority when set", async () => {
    await dispatchGotify({ ...config, priority: 7 }, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.priority).toBe(7);
  });

  it("omits priority when not set", async () => {
    await dispatchGotify(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.priority).toBeUndefined();
  });

  it("strips trailing slash from server URL", async () => {
    await dispatchGotify(
      { ...config, url: "https://gotify.example.com/" },
      payload,
    );
    const [url] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gotify.example.com/message?token=A_abc123");
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(dispatchGotify(config, payload)).rejects.toThrow("gotify 401");
  });
});

describe("parseGotifyConfig", () => {
  it("returns a typed config when url and token are present", () => {
    const parsed = parseGotifyConfig({
      url: "https://gotify.example.com",
      token: "A_abc123",
    });
    expect(parsed).toEqual({
      url: "https://gotify.example.com",
      token: "A_abc123",
    });
  });

  it("carries priority through when provided", () => {
    const parsed = parseGotifyConfig({
      url: "https://gotify.example.com",
      token: "A_abc123",
      priority: 5,
    });
    expect(parsed).toEqual({
      url: "https://gotify.example.com",
      token: "A_abc123",
      priority: 5,
    });
  });

  it("rejects non-object input", () => {
    expect(() => parseGotifyConfig(null)).toThrow(
      "gotify config must be an object",
    );
    expect(() => parseGotifyConfig("string")).toThrow(
      "gotify config must be an object",
    );
  });

  it("rejects missing url", () => {
    expect(() => parseGotifyConfig({ token: "A_abc123" })).toThrow(
      "gotify config: url is required",
    );
  });

  it("rejects empty url", () => {
    expect(() => parseGotifyConfig({ url: "", token: "A_abc123" })).toThrow(
      "gotify config: url is required",
    );
  });

  it("rejects missing token", () => {
    expect(() =>
      parseGotifyConfig({ url: "https://gotify.example.com" }),
    ).toThrow("gotify config: token is required");
  });

  it("rejects empty token", () => {
    expect(() =>
      parseGotifyConfig({ url: "https://gotify.example.com", token: "" }),
    ).toThrow("gotify config: token is required");
  });

  it("rejects out-of-range priority", () => {
    expect(() =>
      parseGotifyConfig({
        url: "https://gotify.example.com",
        token: "A_abc123",
        priority: 11,
      }),
    ).toThrow("priority must be an integer from 1 to 10");
  });
});

describe("dispatchPushover", () => {
  const config: PushoverChannelConfig = {
    token: "azGDORePK8gMaC0QOYAMyEEuzJnyUi",
    user: "uQiRzpo4DXghDmr9QzzfQu27cmVRsG",
  };

  it("POSTs to the Pushover API URL", async () => {
    await dispatchPushover(config, payload);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.pushover.net/1/messages.json");
    expect(init.method).toBe("POST");
  });

  it("sends token, user, title, and message in JSON body", async () => {
    await dispatchPushover(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.token).toBe("azGDORePK8gMaC0QOYAMyEEuzJnyUi");
    expect(body.user).toBe("uQiRzpo4DXghDmr9QzzfQu27cmVRsG");
    expect(body.title).toBe("Test Title");
    expect(body.message).toBe("Test body");
  });

  it("defaults priority to 0", async () => {
    await dispatchPushover(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.priority).toBe(0);
  });

  it("respects custom priority", async () => {
    await dispatchPushover({ ...config, priority: 1 }, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.priority).toBe(1);
  });

  it("includes url and url_title when click URL is provided", async () => {
    await dispatchPushover(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.url).toBe("https://example.com");
    expect(body.url_title).toBe("Open in Rawkoon");
  });

  it("omits url and url_title when no click URL is provided", async () => {
    await dispatchPushover(config, { title: "T", body: "B" });
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.url).toBeUndefined();
    expect(body.url_title).toBeUndefined();
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 }),
    );
    await expect(dispatchPushover(config, payload)).rejects.toThrow(
      "pushover 400",
    );
  });
});

describe("parsePushoverConfig", () => {
  it("returns a typed config when token and user are present", () => {
    const parsed = parsePushoverConfig({
      token: "azGDORePK8gMaC0QOYAMyEEuzJnyUi",
      user: "uQiRzpo4DXghDmr9QzzfQu27cmVRsG",
    });
    expect(parsed).toEqual({
      token: "azGDORePK8gMaC0QOYAMyEEuzJnyUi",
      user: "uQiRzpo4DXghDmr9QzzfQu27cmVRsG",
    });
  });

  it("carries priority through when provided", () => {
    const parsed = parsePushoverConfig({
      token: "tok",
      user: "usr",
      priority: -1,
    });
    expect(parsed.priority).toBe(-1);
  });

  it("rejects non-object input", () => {
    expect(() => parsePushoverConfig(null)).toThrow(
      "pushover config must be an object",
    );
  });

  it("rejects missing token", () => {
    expect(() =>
      parsePushoverConfig({ user: "uQiRzpo4DXghDmr9QzzfQu27cmVRsG" }),
    ).toThrow("pushover config: token is required");
  });

  it("rejects empty token", () => {
    expect(() => parsePushoverConfig({ token: "", user: "usr" })).toThrow(
      "pushover config: token is required",
    );
  });

  it("rejects missing user", () => {
    expect(() => parsePushoverConfig({ token: "tok" })).toThrow(
      "pushover config: user is required",
    );
  });

  it("rejects out-of-range priority", () => {
    expect(() =>
      parsePushoverConfig({ token: "tok", user: "usr", priority: 2 }),
    ).toThrow("pushover config: priority must be -2, -1, 0, or 1");
  });
});
