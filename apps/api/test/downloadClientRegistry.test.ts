import { describe, expect, it } from "bun:test";
import { buildAdapter } from "@rawkoon/api/services/downloadClient/registry";

const config = {
  website_url: "http://localhost",
  username: "u",
  password: "p",
  label: "rawkoon",
};

describe("buildAdapter", () => {
  it("builds the selected client adapter", () => {
    expect(buildAdapter("qbittorrent", config).type).toBe("qbittorrent");
    expect(buildAdapter("transmission", config).type).toBe("transmission");
    expect(buildAdapter("deluge", config).type).toBe("deluge");
  });
});
