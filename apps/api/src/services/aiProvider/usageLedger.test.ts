import { describe, it, expect, mock } from "bun:test";

mock.module("@rawkoon/api/db", () => ({ prisma: {} }));

const { sanitizeAiError } = await import(
  "@rawkoon/api/services/aiProvider/usageLedger"
);

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

describe("sanitizeAiError", () => {
  it("drops URLs and keeps the status", () => {
    expect(
      sanitizeAiError(
        httpError("Not found: https://api.test/v1/models?key=abc", 404),
      ),
    ).toBe("HTTP 404: Not found: [url]");
  });

  it("redacts the configured key wherever it appears", () => {
    const key = "short-key-1";
    expect(sanitizeAiError(new Error(`bad key ${key}`), key)).toBe(
      "bad key [redacted]",
    );
  });

  it("redacts key-shaped tokens the provider echoes back", () => {
    const out = sanitizeAiError(
      httpError(
        "Invalid API Key: gsk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 (Bearer sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX)",
        401,
      ),
    );
    expect(out).not.toContain("gsk_");
    expect(out).not.toContain("sk-proj");
    expect(out).toContain("HTTP 401: Invalid API Key: [redacted]");
  });

  it("keeps model and parameter names", () => {
    expect(
      sanitizeAiError(
        httpError(
          "Model meta-llama/Llama-3.3-70B-Instruct does not exist",
          404,
        ),
      ),
    ).toBe("HTTP 404: Model meta-llama/Llama-3.3-70B-Instruct does not exist");
    expect(
      sanitizeAiError(
        new Error(
          "Missing required parameter: response_format.json_schema.name",
        ),
      ),
    ).toBe("Missing required parameter: response_format.json_schema.name");
  });

  it("leaves ordinary error text readable", () => {
    expect(
      sanitizeAiError(new Error("The operation was aborted due to timeout")),
    ).toBe("The operation was aborted due to timeout");
    expect(
      sanitizeAiError(
        httpError("Rate limit reached for model qwen/qwen3-32b", 429),
      ),
    ).toBe("HTTP 429: Rate limit reached for model qwen/qwen3-32b");
  });
});
