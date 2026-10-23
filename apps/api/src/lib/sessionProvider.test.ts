import { describe, expect, it } from "bun:test";
import { sessionProviderId } from "@rawkoon/api/lib/sessionProvider";

describe("sessionProviderId", () => {
  it("marks Jellyfin sign-in sessions", () => {
    expect(sessionProviderId("/sign-in/jellyfin")).toBe("jellyfin");
  });

  it("keeps the credential and OIDC marks", () => {
    expect(sessionProviderId("/sign-in/email")).toBe("credential");
    expect(sessionProviderId("/callback/acme", { providerId: "acme" })).toBe(
      "acme",
    );
    expect(sessionProviderId("/callback/acme")).toBe("acme");
  });

  it("marks nothing else", () => {
    expect(sessionProviderId("/sign-up/email")).toBeNull();
  });
});
