import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
    // An encoded slash passes a bare prefix check and would walk out of the cover names
    expect((await callCover("/shelf-cover-%2F..%2Fx.png")).status).toBe(404);
    expect(
      (await callCover("/shelf-cover-%2F..%2F..%2F..%2Fetc%2Fx.png")).status,
    ).toBe(404);
  });

  it("serves a cover with nosniff, typed from the image bytes", async () => {
    const shelf = seedShelf();
    // The file name lies about the type; the bytes are a PNG
    const res = await upload(shelf.id, "cover.gif");
    const body = (await res.json()) as { shelf: { cover: { url: string } } };
    expect(body.shelf.cover.url).toEndWith(".png");
    session.user = null;
    const image = await callCover(
      new URL(body.shelf.cover.url).pathname.replace("/api/shelves/covers", ""),
    );
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("builds the cover URL from the forwarded scheme and host", async () => {
    const shelf = seedShelf();
    const form = new FormData();
    form.set("cover", new File([PNG], "c.png", { type: "image/png" }));
    const res = await call(`/${shelf.id}/cover`, {
      method: "POST",
      body: form,
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "media.example.com",
      },
    });
    const body = (await res.json()) as { shelf: { cover: { url: string } } };
    expect(body.shelf.cover.url).toStartWith(
      "https://media.example.com/api/shelves/covers/",
    );
  });

  it("deletes the stored file when the shelf is deleted, restyled or re-uploaded", async () => {
    const files = async () =>
      (await readdir(storageDir)).filter((n) => n.startsWith("shelf-cover-"));
    const before = (await files()).length;

    const a = seedShelf();
    await upload(a.id);
    expect((await files()).length).toBe(before + 1);
    await upload(a.id);
    expect((await files()).length).toBe(before + 1);
    await sendJson("PATCH", `/${a.id}`, { cover_style: "mosaic" });
    expect((await files()).length).toBe(before);

    const b = seedShelf();
    await upload(b.id);
    expect((await files()).length).toBe(before + 1);
    expect((await call(`/${b.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await files()).length).toBe(before);
  });

  it("refuses the upload style without a cover file and non-TMDB cover URLs", async () => {
    const shelf = seedShelf();
    expect(
      (await sendJson("PATCH", `/${shelf.id}`, { cover_style: "upload" }))
        .status,
    ).toBe(400);
    expect(
      (await sendJson("POST", "/", { name: "x", cover_style: "upload" }))
        .status,
    ).toBe(400);
    expect(
      (
        await sendJson("PATCH", `/${shelf.id}`, {
          cover_style: "backdrop",
          cover_url: "https://evil.example.com/x.jpg",
        })
      ).status,
    ).toBe(400);
  });

  it("refuses a body over the upload limit", async () => {
    const shelf = seedShelf();
    const form = new FormData();
    form.set("cover", new File([new Uint8Array(7 * 1024 * 1024)], "big.png"));
    const res = await call(`/${shelf.id}/cover`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });
});
