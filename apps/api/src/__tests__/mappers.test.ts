import { describe, it, expect } from "bun:test";
import { mapUser } from "@rawkoon/api/utils/mappers";

const baseUser = {
  id: "u1",
  email: "a@b.com",
  firstName: "A",
  lastName: "B",
  isAdmin: false,
  locale: null,
  lastLogin: null,
  createdAt: new Date("2024-01-01"),
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
};

describe("mapUser", () => {
  it("returns nav_position as null when not set", () => {
    const result = mapUser(baseUser);
    expect(result.nav_position).toBe(null);
  });

  it("returns nav_position value when set", () => {
    const result = mapUser({ ...baseUser, navPosition: "bottom" });
    expect(result.nav_position).toBe("bottom");
  });
});
