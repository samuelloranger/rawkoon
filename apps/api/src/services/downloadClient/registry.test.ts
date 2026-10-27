import { describe, expect, it } from "bun:test";
import { buildAdapter } from "./registry";

const config = {
  website_url: "http://client.invalid",
  username: "u",
  password: "p",
  label: "Client",
};

describe("buildAdapter", () => {
  it("offers torrent adoption only on qBittorrent", () => {
    expect(buildAdapter("qbittorrent", config).claimExisting).toBeFunction();
    // rdt-client reuses the qBittorrent adapter but its torrents are not claimable.
    expect(buildAdapter("rdtclient", config).claimExisting).toBeUndefined();
    expect(buildAdapter("transmission", config).claimExisting).toBeUndefined();
    expect(buildAdapter("deluge", config).claimExisting).toBeUndefined();
  });
});
