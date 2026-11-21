import { describe, expect, it } from "vitest";
import { HttpError, apiErrorMessage } from "@/lib/api/httpClient";

describe("apiErrorMessage", () => {
  it("prefers the server's error string", () => {
    const err = new HttpError("x", 400, undefined, { error: "Bad URL" });
    expect(apiErrorMessage(err, "fallback")).toBe("Bad URL");
  });

  it("falls back when the error carries no API message", () => {
    expect(apiErrorMessage(new HttpError("x", 500), "fallback")).toBe(
      "fallback",
    );
    expect(apiErrorMessage(new Error("x"), "fallback")).toBe("fallback");
  });
});
