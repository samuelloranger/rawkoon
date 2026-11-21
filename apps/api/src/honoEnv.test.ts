import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { honoOnError } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";

const app = new Hono()
  .post("/v", jsonV(z.object({ tmdb_id: z.number(), n: z.string() })), (c) =>
    c.json({ ok: true }),
  )
  .get("/boom", () => {
    throw new Error("secret");
  })
  .get("/teapot", () => {
    throw new HTTPException(418, { message: "short and stout" });
  })
  .get("/p2025", () => {
    throw Object.assign(new Error("not found"), { code: "P2025" });
  })
  .onError(honoOnError);

const post = (body: string) =>
  app.request("/v", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

describe("honoOnError", () => {
  test("malformed JSON is a 400 with a JSON body", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  });

  test("validation names the field and lists every issue", async () => {
    const res = await post(JSON.stringify({ tmdb_id: "x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toStartWith("tmdb_id: ");
    expect(body.issues.map((i: { path: string }) => i.path)).toEqual([
      "tmdb_id",
      "n",
    ]);
  });

  test("HTTPException keeps its status and message", async () => {
    const res = await app.request("/teapot");
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "short and stout" });
  });

  test("Prisma P2025 maps to 404", async () => {
    const res = await app.request("/p2025");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  test("other throws stay a neutral 500", async () => {
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
