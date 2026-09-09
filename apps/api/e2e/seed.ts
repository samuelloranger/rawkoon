import { prisma } from "@rawkoon/api/db";
import { hashPassword } from "@rawkoon/api/utils/password";
import { assertE2eDatabase } from "./boot";
import type { Context } from "./context";
import { request } from "./httpClient";

export const ADMIN = { email: "admin@e2e.test", password: "Password123!" };
export const USER = { email: "user@e2e.test", password: "Password123!" };

// Extract the `better-auth.session_token=<value>` pair from a Set-Cookie header
// so it can be replayed as a Cookie request header over HTTP.
function extractSessionCookie(setCookie: string | null): string {
  if (!setCookie) throw new Error("no set-cookie header from sign-in");
  const m = setCookie.match(/better-auth\.session_token=[^;]+/);
  if (!m) throw new Error(`no session token in set-cookie: ${setCookie}`);
  return m[0];
}

async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows
    .map((r: { tablename: string }) => `"${r.tablename}"`)
    .join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

async function createUser(
  email: string,
  password: string,
  isAdmin: boolean,
): Promise<string> {
  const pwdHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      name: email,
      emailVerified: true,
      passwordHash: pwdHash,
      firstName: "E2E",
      lastName: isAdmin ? "Admin" : "User",
      isAdmin,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.baAccount.create({
    data: {
      id: crypto.randomUUID(),
      // better-auth keys the credential account by the user id, not the email.
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: pwdHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return user.id;
}

// Cookies are minted through the dispatch client (the better-auth sign-in route
// tolerates the model-vs-mapped-table schema check that the direct api throws on).
export async function acquireCookies(ctx: Context): Promise<void> {
  ctx.cookies.admin = await signIn(ADMIN.email, ADMIN.password);
  ctx.cookies.user = await signIn(USER.email, USER.password);
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await request("POST", "/api/auth/sign-in/email", {
    body: { email, password },
  });
  if (res.status !== 200) {
    throw new Error(`sign-in failed for ${email}: ${res.status} ${res.text}`);
  }
  return extractSessionCookie(res.headers.get("set-cookie"));
}

// Minimal library dataset seeded inline (the baseline script races its own author
// upserts under concurrency, so we control the rows directly). One movie, one show
// + episode, one author + book + ebook edition — enough for :id-bearing fixtures.
async function seedLibrary(ctx: Context): Promise<void> {
  const movie = await prisma.libraryMedia.create({
    data: { tmdbId: 990_000_001, type: "movie", title: "E2E Movie" },
  });
  const show = await prisma.libraryMedia.create({
    data: { tmdbId: 990_000_002, type: "show", title: "E2E Show" },
  });
  const episode = await prisma.libraryEpisode.create({
    data: { mediaId: show.id, season: 1, episode: 1 },
  });
  const author = await prisma.author.create({
    data: { googleAuthorName: "E2E Author", sortName: "E2E Author" },
  });
  const book = await prisma.libraryBook.create({
    data: {
      googleVolumeId: "e2e-vol-1",
      title: "E2E Book",
      authors: ["E2E Author"],
    },
  });
  const edition = await prisma.bookEdition.create({
    data: { bookId: book.id, kind: "ebook" },
  });
  ctx.set("libraryMediaId", String(movie.id));
  ctx.set("libraryShowId", String(show.id));
  ctx.set("libraryEpisodeId", String(episode.id));
  ctx.set("authorId", String(author.id));
  ctx.set("bookId", String(book.id));
  ctx.set("editionId", String(edition.id));
}

async function seedExtras(ctx: Context, adminId: string): Promise<void> {
  // Integrations point at sentinel hosts the fetch shim recognises.
  const dc = await prisma.integration.create({
    data: {
      type: "qbittorrent",
      enabled: true,
      config: {
        website_url: "http://mock-qbittorrent.local",
        username: "u",
        password: "p",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const indexer = await prisma.integration.create({
    data: {
      type: "prowlarr",
      enabled: true,
      config: { website_url: "http://mock-prowlarr.local", api_key: "k" },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.integration.create({
    data: {
      type: "tmdb",
      enabled: true,
      config: { api_key: "mock-tmdb-key" },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.integration.create({
    data: {
      type: "jellyfin",
      enabled: true,
      config: { website_url: "http://mock-jellyfin.local", api_key: "k" },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const qp = await prisma.qualityProfile.create({
    data: {
      name: "E2E Profile",
      preferredSources: ["bluray", "web"],
      preferredCodecs: ["h265"],
      updatedAt: new Date(),
    },
  });
  const cf = await prisma.customFormat.create({
    data: {
      name: "E2E Format",
      conditions: [{ type: "release_title", pattern: "REMUX" }],
      updatedAt: new Date(),
    },
  });
  const req = await prisma.mediaRequest.create({
    data: {
      type: "movie",
      title: "E2E Requested Movie",
      tmdbId: 999000001,
      requestedById: adminId,
    },
  });
  ctx.set("integrationDownloadClientType", dc.type);
  ctx.set("integrationIndexerType", indexer.type);
  ctx.set("qualityProfileId", String(qp.id));
  ctx.set("customFormatId", String(cf.id));
  ctx.set("requestId", String(req.id));
}

export async function resetAndSeed(ctx: Context): Promise<void> {
  assertE2eDatabase(process.env.DATABASE_URL ?? "");
  await truncateAll();
  const adminId = await createUser(ADMIN.email, ADMIN.password, true);
  await createUser(USER.email, USER.password, false);
  await seedLibrary(ctx);
  await seedExtras(ctx, adminId);
  // Cookies are acquired separately via acquireCookies() once the server is up.
}
