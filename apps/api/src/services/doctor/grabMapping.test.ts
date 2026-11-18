import { describe, expect, it } from "bun:test";
import type { GrabReadinessCheck } from "@rawkoon/shared/types";
import { mapGrabReadiness } from "./grabMapping";

const check = (
  id: GrabReadinessCheck["id"],
  status: GrabReadinessCheck["status"],
  params: Record<string, unknown>,
): GrabReadinessCheck => ({ id, status, params });

describe("mapGrabReadiness", () => {
  it("maps a healthy probe set to ok with real summaries", () => {
    const drafts = mapGrabReadiness([
      check("indexer_manager", "ok", { manager: "prowlarr", indexers: 2 }),
      check("rss_indexers", "ok", { watched: 2, total: 2, unwatched: [] }),
      check("download_client", "ok", { client_type: "qbittorrent" }),
      check("default_movie_profile", "ok", { profile_name: "HD" }),
      check("default_show_profile", "ok", { profile_name: "Any" }),
      check("profiles_without_maximum", "ok", { profiles: [] }),
      check("search_on_add", "ok", { enabled: false }),
    ]);
    expect(drafts.every((d) => d.outcome.status === "ok")).toBe(true);
    expect(drafts.every((d) => d.outcome.fix === null)).toBe(true);
    expect(drafts.map((d) => d.id)).toEqual([
      "indexer_manager",
      "rss_indexers",
      "download_client",
      "default_movie_profile",
      "default_show_profile",
      "profiles_without_maximum",
      "search_on_add",
    ]);
    const byId = Object.fromEntries(drafts.map((d) => [d.id, d]));
    expect(byId.indexer_manager.outcome.summary).toContain(
      "2 indexers enabled on prowlarr",
    );
    expect(byId.rss_indexers.title).toBe("RSS indexers");
    expect(byId.search_on_add.outcome.summary).toContain("off");
  });

  it("maps error to fail with a fix, keeping the ids stable", () => {
    const drafts = mapGrabReadiness([
      check("indexer_manager", "error", { reason: "not_configured" }),
      check("download_client", "error", {
        reason: "unreachable",
        client_type: "deluge",
      }),
    ]);
    const [indexer, client] = drafts;
    expect(indexer.outcome.status).toBe("fail");
    expect(indexer.outcome.summary).toContain("No indexer manager");
    expect(indexer.outcome.fix).toContain("Settings → Integrations");
    expect(client.outcome.status).toBe("fail");
    expect(client.outcome.summary).toContain("deluge could not be reached");
    expect(client.outcome.fix).toContain("Download Client");
  });

  it("maps warns with their details", () => {
    const drafts = mapGrabReadiness([
      check("indexer_manager", "warn", { manager: "prowlarr", indexers: 0 }),
      check("rss_indexers", "warn", {
        manager: "prowlarr",
        watched: 0,
        total: 2,
        unwatched: ["a", "b"],
      }),
      check("default_movie_profile", "warn", {}),
      check("default_show_profile", "warn", {}),
      check("profiles_without_maximum", "warn", {
        profiles: [
          { id: 4, name: "Any" },
          { id: 5, name: "4K" },
        ],
      }),
    ]);
    expect(drafts.every((d) => d.outcome.status === "warn")).toBe(true);
    expect(drafts[0].outcome.summary).toContain("no enabled indexers");
    expect(drafts[1].outcome.summary).toContain("unwatched: a, b");
    expect(drafts[2].outcome.summary).toContain(
      "default movie quality profile",
    );
    expect(drafts[3].outcome.summary).toContain("default show quality profile");
    expect(drafts[4].outcome.summary).toContain("(Any, 4K)");
    expect(drafts[4].outcome.fix).toContain("Quality Profiles");
  });

  it("never fabricates data for unknown check ids", () => {
    const drafts = mapGrabReadiness([
      check("search_on_add", "ok", {}) as GrabReadinessCheck,
      {
        id: "future_thing" as GrabReadinessCheck["id"],
        status: "ok",
        params: {},
      },
    ]);
    expect(drafts[1].outcome.summary).toContain("Unrecognized");
    expect(drafts[1].title).toBe("future_thing");
  });
});
