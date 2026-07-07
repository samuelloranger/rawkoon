import { mock } from "bun:test";
mock.module("../ssrf", () => ({
  validateSafeUrl: async (url: string) => url,
  // Passthrough so request-construction assertions still see the original URL
  // and headers; the real safeFetch's IP-pinning is covered by ssrf tests.
  safeFetch: (url: string, init?: RequestInit) =>
    fetch(url, init as RequestInit),
}));

import { describe, it, expect, beforeEach } from "bun:test";
import {
  dispatchNtfy,
  dispatchTelegram,
  dispatchDiscord,
  dispatchGotify,
  dispatchPushover,
  dispatchSlack,
  dispatchWebhook,
  dispatchToChannel,
  parseNtfyConfig,
  parseTelegramConfig,
  parseDiscordConfig,
  parseGotifyConfig,
  parsePushoverConfig,
  parseSlackConfig,
  parseWebhookConfig,
} from "./channelDispatchers";
import type {
  NotificationChannel,
  NtfyChannelConfig,
  TelegramChannelConfig,
  DiscordChannelConfig,
  GotifyChannelConfig,
  PushoverChannelConfig,
  SlackChannelConfig,
  WebhookChannelConfig,
} from "@rawkoon/shared";

const payload = {
  title: "Test Title",
  body: "Test body",
  url: "https://example.com",
};

const mockFetch = mock(() =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
);

// @ts-expect-error test assigns global fetch mock
global.fetch = mockFetch;

beforeEach(() => mockFetch.mockClear());

describe("dispatchNtfy", () => {
  const config: NtfyChannelConfig = {
    url: "https://ntfy.example.com",
    topic: "rawkoon",
  };

  it("POSTs to {url}/{topic} with Title, Priority, and Click headers", async () => {
    await dispatchNtfy(config, payload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://ntfy.example.com/rawkoon");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("Test body");
    const headers = init.headers as Record<string, string>;
    expect(headers["Title"]).toBe("Test Title");
    expect(headers["Priority"]).toBe("3");
    expect(headers["Click"]).toBe("https://example.com");
  });

  it("adds Authorization header when token is set", async () => {
    await dispatchNtfy({ ...config, token: "mytoken" }, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer mytoken",
    );
  });

  it("respects custom priority", async () => {
    await dispatchNtfy({ ...config, priority: 5 }, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["Priority"]).toBe("5");
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 }),
    );
    await expect(dispatchNtfy(config, payload)).rejects.toThrow("ntfy 400");
  });
});

describe("dispatchTelegram", () => {
  const config: TelegramChannelConfig = {
    bot_token: "123456:ABC-DEF",
    chat_id: "-1001234567890",
  };

  it("POSTs to the correct Telegram API URL", async () => {
    await dispatchTelegram(config, payload);
    const [url] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123456:ABC-DEF/sendMessage");
  });

  it("sends HTML-formatted text with bold title", async () => {
    await dispatchTelegram(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-1001234567890");
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toBe("<b>Test Title</b>\nTest body");
  });

  it("includes inline keyboard button with click URL when url is provided", async () => {
    await dispatchTelegram(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: "Open in Rawkoon", url: "https://example.com" }],
      ],
    });
  });

  it("omits reply_markup when no url is provided", async () => {
    await dispatchTelegram(config, { title: "T", body: "B" });
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.reply_markup).toBeUndefined();
  });

  it("escapes HTML special characters in title and body", async () => {
    await dispatchTelegram(config, {
      title: "Chore <Kitchen> & Bath",
      body: "Don't forget: clean <sink> & floor",
    });
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe(
      "<b>Chore &lt;Kitchen&gt; &amp; Bath</b>\nDon't forget: clean &lt;sink&gt; &amp; floor",
    );
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(dispatchTelegram(config, payload)).rejects.toThrow(
      "telegram 401",
    );
  });
});

describe("dispatchToChannel", () => {
  it("routes to ntfy dispatcher based on channel type", async () => {
    const channel: NotificationChannel = {
      id: 1,
      type: "ntfy",
      label: "My Phone",
      config: { url: "https://ntfy.example.com", topic: "rawkoon" },
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await dispatchToChannel(channel, payload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/rawkoon");
  });

  it("routes to telegram dispatcher based on channel type", async () => {
    const channel: NotificationChannel = {
      id: 2,
      type: "telegram",
      label: "My Telegram",
      config: { bot_token: "123:ABC", chat_id: "42" },
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await dispatchToChannel(channel, payload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
  });

  it("throws on unknown channel type", async () => {
    await expect(
      dispatchToChannel({ type: "unknown", label: "Bad", config: {} }, payload),
    ).rejects.toThrow("Unknown notification channel type: unknown");
  });

  it("throws when ntfy config is malformed", async () => {
    await expect(
      dispatchToChannel(
        { type: "ntfy", label: "Broken", config: { topic: "x" } },
        payload,
      ),
    ).rejects.toThrow("ntfy config: url is required");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when telegram config is malformed", async () => {
    await expect(
      dispatchToChannel(
        { type: "telegram", label: "Broken", config: { bot_token: "123" } },
        payload,
      ),
    ).rejects.toThrow("telegram config: chat_id is required");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("routes to gotify dispatcher based on channel type", async () => {
    const channel: NotificationChannel = {
      id: 3,
      type: "gotify",
      label: "My Gotify",
      config: { url: "https://gotify.example.com", token: "A_abc123" },
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await dispatchToChannel(channel, payload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gotify.example.com/message?token=A_abc123");
  });

  it("throws when gotify config is malformed", async () => {
    await expect(
      dispatchToChannel(
        {
          type: "gotify",
          label: "Broken",
          config: { url: "https://gotify.example.com" },
        },
        payload,
      ),
    ).rejects.toThrow("gotify config: token is required");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("parseNtfyConfig", () => {
  it("returns a typed config when url + topic are present", () => {
    const parsed = parseNtfyConfig({
      url: "https://ntfy.example.com",
      topic: "rawkoon",
    });
    expect(parsed).toEqual({
      url: "https://ntfy.example.com",
      topic: "rawkoon",
    });
  });

  it("carries token and priority through when provided", () => {
    const parsed = parseNtfyConfig({
      url: "https://ntfy.example.com",
      topic: "rawkoon",
      token: "abc",
      priority: 4,
    });
    expect(parsed).toEqual({
      url: "https://ntfy.example.com",
      topic: "rawkoon",
      token: "abc",
      priority: 4,
    });
  });

  it("rejects non-object input", () => {
    expect(() => parseNtfyConfig("not an object")).toThrow(
      "ntfy config must be an object",
    );
    expect(() => parseNtfyConfig(null)).toThrow(
      "ntfy config must be an object",
    );
    expect(() => parseNtfyConfig([])).toThrow("ntfy config must be an object");
  });

  it("rejects out-of-range priority", () => {
    expect(() =>
      parseNtfyConfig({
        url: "https://ntfy.example.com",
        topic: "rawkoon",
        priority: 9,
      }),
    ).toThrow("priority must be an integer from 1 to 5");
  });
});

describe("parseTelegramConfig", () => {
  it("returns a typed config when bot_token and chat_id are present", () => {
    const parsed = parseTelegramConfig({
      bot_token: "123456:ABC-DEF",
      chat_id: "-1001234567890",
    });
    expect(parsed).toEqual({
      bot_token: "123456:ABC-DEF",
      chat_id: "-1001234567890",
    });
  });

  it("rejects non-object input", () => {
    expect(() => parseTelegramConfig("not an object")).toThrow(
      "telegram config must be an object",
    );
    expect(() => parseTelegramConfig(null)).toThrow(
      "telegram config must be an object",
    );
  });

  it("rejects missing bot_token", () => {
    expect(() => parseTelegramConfig({ chat_id: "42" })).toThrow(
      "telegram config: bot_token is required",
    );
  });

  it("rejects empty bot_token", () => {
    expect(() => parseTelegramConfig({ bot_token: "", chat_id: "42" })).toThrow(
      "telegram config: bot_token is required",
    );
  });

  it("rejects missing chat_id", () => {
    expect(() => parseTelegramConfig({ bot_token: "123:ABC" })).toThrow(
      "telegram config: chat_id is required",
    );
  });

  it("rejects empty chat_id", () => {
    expect(() =>
      parseTelegramConfig({ bot_token: "123:ABC", chat_id: "" }),
    ).toThrow("telegram config: chat_id is required");
  });
});

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

describe("dispatchSlack", () => {
  const config: SlackChannelConfig = {
    webhook_url: "https://hooks.slack.com/services/T000/B000/XXXX",
  };

  it("POSTs to the webhook URL", async () => {
    await dispatchSlack(config, payload);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://hooks.slack.com/services/T000/B000/XXXX");
    expect(init.method).toBe("POST");
  });

  it("sends mrkdwn text with bold title", async () => {
    await dispatchSlack(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe("*Test Title*\nTest body");
    expect(body.blocks[0].text.text).toBe("*Test Title*\nTest body");
    expect(body.blocks[0].text.type).toBe("mrkdwn");
  });

  it("includes action button when click URL is provided", async () => {
    await dispatchSlack(config, payload);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.blocks).toHaveLength(2);
    expect(body.blocks[1].type).toBe("actions");
    expect(body.blocks[1].elements[0].url).toBe("https://example.com");
    expect(body.blocks[1].elements[0].text.text).toBe("Open in Rawkoon");
  });

  it("omits action block when no click URL is provided", async () => {
    await dispatchSlack(config, { title: "T", body: "B" });
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.blocks).toHaveLength(1);
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("channel_not_found", { status: 404 }),
    );
    await expect(dispatchSlack(config, payload)).rejects.toThrow("slack 404");
  });
});

describe("parseSlackConfig", () => {
  it("returns a typed config when webhook_url is present", () => {
    const parsed = parseSlackConfig({
      webhook_url: "https://hooks.slack.com/services/T000/B000/XXXX",
    });
    expect(parsed).toEqual({
      webhook_url: "https://hooks.slack.com/services/T000/B000/XXXX",
    });
  });

  it("rejects non-object input", () => {
    expect(() => parseSlackConfig(null)).toThrow(
      "slack config must be an object",
    );
  });

  it("rejects missing webhook_url", () => {
    expect(() => parseSlackConfig({})).toThrow(
      "slack config: webhook_url is required",
    );
  });

  it("rejects empty webhook_url", () => {
    expect(() => parseSlackConfig({ webhook_url: "" })).toThrow(
      "slack config: webhook_url is required",
    );
  });
});

describe("dispatchWebhook", () => {
  const config: WebhookChannelConfig = {
    url: "https://my-server.example.com/notify",
  };

  it("defaults to POST and sends title/body/url as JSON", async () => {
    await dispatchWebhook(config, payload);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://my-server.example.com/notify");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe("Test Title");
    expect(body.body).toBe("Test body");
    expect(body.url).toBe("https://example.com");
  });

  it("omits url field in body when no click URL provided", async () => {
    await dispatchWebhook(config, { title: "T", body: "B" });
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.url).toBeUndefined();
  });

  it("sends GET with no body and substitutes URL template vars", async () => {
    await dispatchWebhook(
      {
        url: "https://my-server.example.com/alert?msg={{body}}&title={{title}}",
        method: "GET",
      },
      payload,
    );
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://my-server.example.com/alert?msg=Test+body&title=Test+Title"
        // template substitution is literal, not URL-encoded
        .replace("Test+body", "Test body")
        .replace("Test+Title", "Test Title"),
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("substitutes URL template vars for GET requests", async () => {
    await dispatchWebhook(
      { url: "https://example.com/ping?msg={{body}}", method: "GET" },
      { title: "T", body: "Hello world" },
    );
    const [url] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/ping?msg=Hello world");
  });

  it("uses body_template for POST when provided", async () => {
    await dispatchWebhook(
      {
        ...config,
        body_template: '{"message": "{{body}}", "subject": "{{title}}"}',
      },
      payload,
    );
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.message).toBe("Test body");
    expect(body.subject).toBe("Test Title");
  });

  it("substitutes {{url}} in body_template", async () => {
    await dispatchWebhook(
      {
        ...config,
        body_template: '{"text": "{{body}}", "link": "{{url}}"}',
      },
      payload,
    );
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.link).toBe("https://example.com");
  });

  it("substitutes {{url}} as empty string when no click URL provided", async () => {
    await dispatchWebhook(
      { ...config, body_template: '{"link": "{{url}}"}' },
      { title: "T", body: "B" },
    );
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.link).toBe("");
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );
    await expect(dispatchWebhook(config, payload)).rejects.toThrow(
      "webhook 500",
    );
  });
});

describe("parseWebhookConfig", () => {
  it("returns a typed config when url is present", () => {
    const parsed = parseWebhookConfig({
      url: "https://my-server.example.com/notify",
    });
    expect(parsed).toEqual({ url: "https://my-server.example.com/notify" });
  });

  it("carries method and body_template through when provided", () => {
    const parsed = parseWebhookConfig({
      url: "https://example.com/hook",
      method: "GET",
      body_template: '{"msg": "{{body}}"}',
    });
    expect(parsed.method).toBe("GET");
    expect(parsed.body_template).toBe('{"msg": "{{body}}"}');
  });

  it("rejects non-object input", () => {
    expect(() => parseWebhookConfig(null)).toThrow(
      "webhook config must be an object",
    );
  });

  it("rejects missing url", () => {
    expect(() => parseWebhookConfig({})).toThrow(
      "webhook config: url is required",
    );
  });

  it("rejects empty url", () => {
    expect(() => parseWebhookConfig({ url: "" })).toThrow(
      "webhook config: url is required",
    );
  });

  it("rejects invalid method", () => {
    expect(() =>
      parseWebhookConfig({ url: "https://example.com", method: "DELETE" }),
    ).toThrow("webhook config: method must be GET or POST");
  });

  it("rejects body_template that is not valid JSON", () => {
    expect(() =>
      parseWebhookConfig({
        url: "https://example.com",
        body_template: "not json {{body}}",
      }),
    ).toThrow("webhook config: body_template must be valid JSON");
  });

  it("accepts body_template with {{...}} placeholders in valid JSON structure", () => {
    expect(() =>
      parseWebhookConfig({
        url: "https://example.com",
        body_template: '{"message": "{{body}}", "title": "{{title}}"}',
      }),
    ).not.toThrow();
  });
});

describe("image attachment (imageUrl)", () => {
  const img = "https://image.tmdb.org/t/p/w500/poster.jpg";
  const withImg = { ...payload, imageUrl: img };

  it("ntfy attaches the image via the Attach header when present", async () => {
    await dispatchNtfy(
      { url: "https://ntfy.example.com", topic: "rawkoon" },
      withImg,
    );
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((init.headers as Record<string, string>)["Attach"]).toBe(img);
  });

  it("ntfy omits the Attach header when no image", async () => {
    await dispatchNtfy(
      { url: "https://ntfy.example.com", topic: "rawkoon" },
      payload,
    );
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect("Attach" in (init.headers as Record<string, string>)).toBe(false);
  });

  it("discord sets embed.thumbnail when present, omits when absent", async () => {
    const config: DiscordChannelConfig = {
      webhook_url: "https://discord.com/api/webhooks/x/y",
    };
    await dispatchDiscord(config, withImg);
    let body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body.embeds[0].thumbnail).toEqual({ url: img });

    mockFetch.mockClear();
    await dispatchDiscord(config, payload);
    body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body.embeds[0].thumbnail).toBeUndefined();
  });

  it("slack adds an image accessory when present, omits when absent", async () => {
    const config: SlackChannelConfig = {
      webhook_url: "https://hooks.slack.com/services/x/y/z",
    };
    await dispatchSlack(config, withImg);
    let body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body.blocks[0].accessory).toEqual({
      type: "image",
      image_url: img,
      alt_text: payload.title,
    });

    mockFetch.mockClear();
    await dispatchSlack(config, payload);
    body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body.blocks[0].accessory).toBeUndefined();
  });

  it("webhook default payload includes image when present, omits when absent", async () => {
    const config: WebhookChannelConfig = { url: "https://example.com/hook" };
    await dispatchWebhook(config, withImg);
    let body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body.image).toBe(img);

    mockFetch.mockClear();
    await dispatchWebhook(config, payload);
    body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect("image" in body).toBe(false);
  });

  it("webhook substitutes {{image}} in a body_template", async () => {
    const config: WebhookChannelConfig = {
      url: "https://example.com/hook",
      body_template: '{"poster": "{{image}}"}',
    };
    await dispatchWebhook(config, withImg);
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body.poster).toBe(img);
  });

  it("telegram ignores imageUrl (stays sendMessage)", async () => {
    const config: TelegramChannelConfig = {
      bot_token: "token",
      chat_id: "123",
    };
    await dispatchTelegram(config, withImg);
    const [url] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/sendMessage");
    expect(url).not.toContain("/sendPhoto");
  });
});
