import { beforeEach, describe, expect, it } from "bun:test";
import {
  admin,
  call,
  resetHarness,
  seedShelf,
  sendJson,
  session,
  state,
  user,
} from "../../../test/helpers/shelvesHarness";

beforeEach(resetHarness);

describe("shelves routes", () => {
  it("lets any signed-in user read the list and refuses a user the admin-only view", async () => {
    seedShelf({ name: "Horror" });
    expect((await call("/")).status).toBe(200);

    session.user = { ...user };
    expect((await call("/")).status).toBe(200);
    expect((await call("/?all=1")).status).toBe(403);
  });

  it("hides shelves outside their window unless an admin asks for all", async () => {
    seedShelf({ name: "Christmas", visibleFrom: "11-01", visibleTo: "01-15" });

    const visible = (await (await call("/")).json()) as { shelves: unknown[] };
    const all = (await (await call("/?all=1")).json()) as {
      shelves: unknown[];
    };
    expect(all.shelves).toHaveLength(1);
    // The suite runs on a real date, so this asserts the flag and the computed
    // window agree; the window math has its own suite.
    const now = (all.shelves[0] as { visible_now: boolean }).visible_now;
    expect(visible.shelves).toHaveLength(now ? 1 : 0);
  });

  it("keeps a shelf outside its window for admins, by id too", async () => {
    const hidden = seedShelf({
      name: "Christmas",
      visibleFrom: "11-01",
      visibleTo: "01-15",
    });
    // A window that is never now: one day, far from any real date's month-day pair
    const closed = seedShelf({
      name: "Closed",
      visibleFrom: "02-29",
      visibleTo: "02-29",
    });
    const now = new Date();
    const today = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    const outside = today === "02-29" ? hidden : closed;

    session.user = { ...user };
    expect((await call(`/${outside.id}`)).status).toBe(404);

    session.user = { ...admin };
    expect((await call(`/${outside.id}`)).status).toBe(200);
  });

  it("rejects writes from a non-admin and accepts them from an admin", async () => {
    session.user = { ...user };
    expect((await sendJson("POST", "/", { name: "Mine" })).status).toBe(403);

    session.user = { ...admin };
    const res = await sendJson("POST", "/", { name: "Mine" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      shelf: { name: string; entries: unknown[]; visible_now: boolean };
    };
    expect(body.shelf.name).toBe("Mine");
    expect(body.shelf.entries).toEqual([]);
    expect(body.shelf.visible_now).toBe(true);
  });

  it("edits and deletes a shelf", async () => {
    const shelf = seedShelf({ name: "Old" });
    const patched = await sendJson("PATCH", `/${shelf.id}`, {
      name: "New",
      home_row: true,
      visible_from: "12-01",
      visible_to: "12-31",
    });
    expect(patched.status).toBe(200);
    expect(state.shelves[0]).toMatchObject({
      name: "New",
      homeRow: true,
      visibleFrom: "12-01",
      visibleTo: "12-31",
    });

    expect((await call(`/${shelf.id}`, { method: "DELETE" })).status).toBe(200);
    expect(state.shelves).toHaveLength(0);
    expect((await call(`/${shelf.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("reorders shelves in the given order", async () => {
    const a = seedShelf({ name: "A", position: 0 });
    const b = seedShelf({ name: "B", position: 1 });
    const res = await sendJson("PUT", "/order", { ids: [b.id, a.id] });
    expect(res.status).toBe(200);

    const list = (await (await call("/")).json()) as {
      shelves: Array<{ name: string }>;
    };
    expect(list.shelves.map((shelf) => shelf.name)).toEqual(["B", "A"]);
    expect((await sendJson("PUT", "/order", { ids: [999] })).status).toBe(400);
  });

  it("serves the seed catalogue in the caller's language", async () => {
    const en = (await (await call("/seeds?lang=en")).json()) as {
      seeds: Array<{ key: string; name: string }>;
    };
    const fr = (await (await call("/seeds?lang=fr")).json()) as {
      seeds: Array<{ key: string; name: string }>;
    };
    expect(en.seeds.map((seed) => seed.key)).toContain("christmas");
    expect(en.seeds.find((seed) => seed.key === "christmas")?.name).toBe(
      "Christmas movies",
    );
    expect(fr.seeds.find((seed) => seed.key === "christmas")?.name).toBe(
      "Films de Noël",
    );
  });

  it("keeps the seed catalogue admin-only", async () => {
    session.user = { ...user };
    expect((await call("/seeds")).status).toBe(403);
  });

  it("fails a seed creation clearly when TMDB is not configured", async () => {
    const res = await sendJson("POST", "/", { seed: "christmas" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "TMDB is not configured",
    );
    expect(state.shelves).toHaveLength(0);
  });

  it("rejects an unknown seed and an invalid window", async () => {
    expect((await sendJson("POST", "/", { seed: "nope" })).status).toBe(400);
    expect(
      (await sendJson("POST", "/", { name: "X", visible_from: "13-01" }))
        .status,
    ).toBe(400);
    expect((await sendJson("POST", "/", {})).status).toBe(400);
  });
});
