import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/api/httpClient";
import { connectionFailureText } from "../connectionFailureText";

const t = (k: string) => `T(${k})`;

describe("connectionFailureText", () => {
  it("leads with the translated cause, then the server message", () => {
    expect(
      connectionFailureText(
        t,
        { success: false, cause: "dns", message: "Could not connect to h:1" },
        "fallback",
      ),
    ).toBe("T(settings.integrations.cause.dns) — Could not connect to h:1");
  });

  it("reads the body of a non-2xx response", () => {
    const err = new HttpError("bad", 502, undefined, {
      error: "x",
      cause: "auth",
      message: "msg",
    });
    expect(connectionFailureText(t, err, "fallback")).toContain("cause.auth");
  });

  it("falls back for servers without a cause", () => {
    expect(connectionFailureText(t, { error: "old" }, "fallback")).toBe("old");
    expect(connectionFailureText(t, {}, "fallback")).toBe("fallback");
  });
});
