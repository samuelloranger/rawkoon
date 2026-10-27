import { describe, it, expect } from "bun:test";
import {
  mockFetch,
  payload,
  useMockFetchReset,
} from "./channelDispatchers.helpers";
import {
  dispatchNtfy,
  dispatchTelegram,
  dispatchDiscord,
  dispatchSlack,
  dispatchWebhook,
  parseSlackConfig,
  parseWebhookConfig,
} from "./channelDispatchers";
import type {
  TelegramChannelConfig,
  DiscordChannelConfig,
  SlackChannelConfig,
  WebhookChannelConfig,
} from "@rawkoon/shared";

useMockFetchReset();

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
