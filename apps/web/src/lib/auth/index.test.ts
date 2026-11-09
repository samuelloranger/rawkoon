import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { setQueryClient } from "@/lib/api/queryClient";
import { clearUser, resetUserCache } from "@/lib/auth";

describe("auth cache reset", () => {
  it.each([
    ["resetUserCache (sign-in)", resetUserCache],
    ["clearUser (sign-out)", clearUser],
  ])("%s drops the previous session's data", (_name, reset) => {
    const client = new QueryClient();
    setQueryClient(client);
    client.setQueryData(["library", "list"], [{ id: 1 }]);
    reset();
    expect(client.getQueryData(["library", "list"])).toBeUndefined();
  });
});
