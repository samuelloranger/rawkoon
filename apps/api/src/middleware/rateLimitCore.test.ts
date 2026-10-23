import { describe, expect, it } from "bun:test";
import { strictAuthRateLimitSkip } from "@rawkoon/api/middleware/rateLimitCore";

const req = (path: string, method = "POST") =>
  new Request(`http://localhost${path}`, { method });

describe("strictAuthRateLimitSkip", () => {
  it("applies the strict limiter to Jellyfin sign-in", () => {
    expect(strictAuthRateLimitSkip(req("/api/auth/sign-in/jellyfin"))).toBe(
      false,
    );
  });

  it("applies it to linking a Jellyfin account, which takes a password", () => {
    expect(strictAuthRateLimitSkip(req("/api/profile/jellyfin"))).toBe(false);
  });

  it("leaves reads and unlinking on the global limiter", () => {
    expect(strictAuthRateLimitSkip(req("/api/profile/jellyfin", "GET"))).toBe(
      true,
    );
    expect(
      strictAuthRateLimitSkip(req("/api/profile/jellyfin", "DELETE")),
    ).toBe(true);
  });
});
