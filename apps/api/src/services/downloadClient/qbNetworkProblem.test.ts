import { describe, expect, it } from "bun:test";
import { qbNetworkProblem } from "./qbittorrentAdapter";

const healthy = {
  connection_status: "connected",
  dht_nodes: 194,
  last_external_address_v4: "203.0.113.7",
  last_external_address_v6: "",
};

describe("qbNetworkProblem", () => {
  it("reports nothing for a connected client", () => {
    expect(qbNetworkProblem(healthy)).toBeNull();
  });

  it("reports a disconnected client", () => {
    expect(
      qbNetworkProblem({ ...healthy, connection_status: "disconnected" }),
    ).toBe("download client is disconnected");
  });

  it("reports a firewalled client that has reached no DHT node and learned no external address", () => {
    expect(
      qbNetworkProblem({
        connection_status: "firewalled",
        dht_nodes: 0,
        last_external_address_v4: "",
        last_external_address_v6: "",
      }),
    ).toBe("download client cannot reach any peer");
  });

  it("trusts a firewalled client that still reaches peers", () => {
    expect(
      qbNetworkProblem({ ...healthy, connection_status: "firewalled" }),
    ).toBeNull();
    expect(
      qbNetworkProblem({
        connection_status: "firewalled",
        dht_nodes: 0,
        last_external_address_v4: "203.0.113.7",
        last_external_address_v6: "",
      }),
    ).toBeNull();
  });

  it("reports nothing when an older client omits the address fields", () => {
    expect(
      qbNetworkProblem({ connection_status: "firewalled", dht_nodes: 0 }),
    ).toBeNull();
  });
});
