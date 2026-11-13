import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  admin,
  call,
  callCover,
  resetHarness,
  seedShelf,
  tmdb,
  sendJson,
  session,
  user,
} from "../../../test/helpers/shelvesHarness";

// A 1×1 PNG: the smallest real image sharp will accept.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let storageDir = "";

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "shelves-cover-"));
  Bun.env.IMAGE_STORAGE_DIR = storageDir;
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
});

beforeEach(resetHarness);

const upload = (id: number, name = "cover.png") => {
  const form = new FormData();
  form.set("cover", new File([PNG], name, { type: "image/png" }));
  return call(`/${id}/cover`, { method: "POST", body: form });
};

describe("shelf covers", () => {
  it("stores an uploaded cover and serves it without a token", async () => {
    const shelf = seedShelf();
    const res = await upload(shelf.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shelf: { cover: { style: string; url: string } };
    };
    expect(body.shelf.cover.style).toBe("upload");
    expect(body.shelf.cover.url).toStartWith(
      "http://localhost/api/shelves/covers/",
    );

    // The TV and the phones draw it with no session at all
    session.user = null;
    const path = new URL(body.shelf.cover.url).pathname.replace(
      "/api/shelves/covers",
      "",
    );
    const image = await callCover(path);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect((await image.arrayBuffer()).byteLength).toBe(PNG.byteLength);
  });

  it("refuses an upload from a non-admin and a file that is not an image", async () => {
    const shelf = seedShelf();
    session.user = { ...user };
    expect((await upload(shelf.id)).status).toBe(403);

    session.user = { ...admin };
    const form = new FormData();
    form.set(
      "cover",
      new File(["not an image"], "notes.png", { type: "image/png" }),
    );
    const res = await call(`/${shelf.id}/cover`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("That file is not an image");
  });

  it("refuses a cover with no file and a shelf that does not exist", async () => {
    const shelf = seedShelf();
    expect(
      (
        await call(`/${shelf.id}/cover`, {
          method: "POST",
          body: new FormData(),
        })
      ).status,
    ).toBe(400);
    expect((await upload(9999)).status).toBe(404);
  });

  it("drops the uploaded file when the cover moves to another style", async () => {
    const shelf = seedShelf();
    expect((await upload(shelf.id)).status).toBe(200);

    const res = await sendJson("PATCH", `/${shelf.id}`, {
      cover_style: "mosaic",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shelf: { cover: { style: string }; cover_tmdb_id: number | null };
    };
    expect(body.shelf.cover.style).toBe("mosaic");
    expect(body.shelf.cover_tmdb_id).toBeNull();
  });

  it("uses a picked backdrop image and drops it with another style", async () => {
    const shelf = seedShelf();
    const picked = "https://image.tmdb.org/t/p/w1280/picked.jpg";
    const res = await sendJson("PATCH", `/${shelf.id}`, {
      cover_style: "backdrop",
      cover_url: picked,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shelf: { cover: { style: string; backdrop_url: string | null } };
    };
    expect(body.shelf.cover.backdrop_url).toBe(picked);

    await sendJson("PATCH", `/${shelf.id}`, { cover_style: "mosaic" });
    const list = (await (await call("/?all=1")).json()) as {
      shelves: Array<{
        cover: { style: string; backdrop_url?: string | null };
      }>;
    };
    expect(list.shelves[0]?.cover.style).toBe("mosaic");
  });

  it("lists TMDB backdrops for the cover picker, admins only", async () => {
    session.user = { ...user };
    expect(
      (await call("/cover-candidates?tmdb_id=550&type=movie")).status,
    ).toBe(403);

    session.user = { ...admin };
    // The picker needs a configured key; the route says so plainly when there is none
    expect(
      (await call("/cover-candidates?tmdb_id=550&type=movie")).status,
    ).toBe(400);
    tmdb.key = "test-key";
    const res = await call("/cover-candidates?tmdb_id=550&type=movie");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      backdrops: Array<{ url: string; thumb_url: string }>;
    };
    expect(body.backdrops[0]?.url).toBe(
      "https://image.tmdb.org/t/p/w1280/back.jpg",
    );
  });

  it("never serves a file that is not one of ours", async () => {
    session.user = null;
    expect((await callCover("/../../etc/passwd")).status).toBe(404);
    expect((await callCover("/not-a-cover.png")).status).toBe(404);
  });
});
