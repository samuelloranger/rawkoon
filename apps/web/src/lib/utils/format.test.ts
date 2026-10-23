import { describe, expect, it } from "vitest";
import type { User } from "@rawkoon/shared/types";
import { formatDisplayName, getUserFirstName } from "./format";

const user = (over: Partial<User>): User =>
  ({
    id: "1",
    email: "abc@jellyfin.invalid",
    first_name: null,
    last_name: null,
    ...over,
  }) as User;

describe("display names", () => {
  it("uses the first name when present", () => {
    expect(getUserFirstName(user({ first_name: "ada" }))).toBe("Ada");
    expect(formatDisplayName(user({ first_name: "ada" }))).toBe("Ada");
  });

  it("never falls back to a Jellyfin placeholder address", () => {
    expect(getUserFirstName(user({}))).toBe("");
    expect(formatDisplayName(user({}), "You")).toBe("You");
  });

  it("still falls back to a real email", () => {
    expect(getUserFirstName(user({ email: "a@example.com" }))).toBe(
      "a@example.com",
    );
  });
});
