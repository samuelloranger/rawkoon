import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  authenticateJellyfinUser,
  JellyfinUnreachableError,
  jellyfinSessionWhere,
} from "@rawkoon/api/services/jellyfinUsers";

const config = {
  website_url: "http://jellyfin.test",
  api_key: "admin-key",
  sign_in_enabled: true,
  open_sign_in: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const authBody = {
  AccessToken: "jf-access-token",
  User: { Id: "jf-1", Name: "viewer", Policy: { IsDisabled: false } },
};

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

afterEach(() => fetchSpy?.mockRestore());

describe("authenticateJellyfinUser", () => {
  it("returns the user and ends the Jellyfin session it opened", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      url: string | URL | Request,
    ) =>
      String(url).endsWith("/Users/AuthenticateByName")
        ? json(authBody)
        : new Response(null, { status: 204 })) as typeof fetch);

    const user = await authenticateJellyfinUser(config, "viewer", "pw");

    expect(user).toEqual({ id: "jf-1", name: "viewer", disabled: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [authUrl, authInit] = fetchSpy.mock.calls[0]!;
    expect(String(authUrl)).toBe(
      "http://jellyfin.test/Users/AuthenticateByName",
    );
    expect(JSON.parse(String((authInit as RequestInit).body))).toEqual({
      Username: "viewer",
      Pw: "pw",
    });
    expect(
      ((authInit as RequestInit).headers as Record<string, string>)
        .Authorization,
    ).toContain('Client="Rawkoon"');
    const [logoutUrl, logoutInit] = fetchSpy.mock.calls[1]!;
    expect(String(logoutUrl)).toBe("http://jellyfin.test/Sessions/Logout");
    expect((logoutInit as RequestInit).method).toBe("POST");
    expect(
      ((logoutInit as RequestInit).headers as Record<string, string>)
        .Authorization,
    ).toContain('Token="jf-access-token"');
  });

  it("reports a disabled Jellyfin user", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
      json({
        ...authBody,
        User: { ...authBody.User, Policy: { IsDisabled: true } },
      })) as unknown as typeof fetch);
    const user = await authenticateJellyfinUser(config, "viewer", "pw");
    expect(user?.disabled).toBe(true);
  });

  it("returns null on 401 without calling logout", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (async () =>
        new Response(null, { status: 401 })) as unknown as typeof fetch,
    );
    expect(await authenticateJellyfinUser(config, "viewer", "bad")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws on a server error", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      (async () =>
        new Response(null, { status: 500 })) as unknown as typeof fetch,
    );
    await expect(authenticateJellyfinUser(config, "v", "p")).rejects.toThrow(
      JellyfinUnreachableError,
    );
  });

  it("throws when the request fails", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch);
    await expect(authenticateJellyfinUser(config, "v", "p")).rejects.toThrow(
      JellyfinUnreachableError,
    );
  });

  it("throws the unreachable error when Jellyfin returns no user", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
      json({ AccessToken: "t" })) as unknown as typeof fetch);
    await expect(authenticateJellyfinUser(config, "v", "p")).rejects.toThrow(
      JellyfinUnreachableError,
    );
  });

  it("still signs in when the logout call fails", async () => {
    let calls = 0;
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
      calls++;
      if (calls === 1) return json(authBody);
      throw new Error("network");
    }) as unknown as typeof fetch);
    expect(await authenticateJellyfinUser(config, "v", "p")).not.toBeNull();
  });
});

describe("jellyfinSessionWhere", () => {
  it("matches both the provider mark and the TV-exchange agent", () => {
    expect(jellyfinSessionWhere("u1")).toEqual({
      userId: "u1",
      OR: [
        { providerId: "jellyfin" },
        { userAgent: { startsWith: "Jellyfin: " } },
      ],
    });
    expect(jellyfinSessionWhere(["u1", "u2"]).userId).toEqual({
      in: ["u1", "u2"],
    });
  });
});
