// Seeds the database with a demo admin + a realistic media library for README
// screenshots. Mock data only — never point DATABASE_URL at a real deployment.
// Run AFTER `prisma migrate deploy`, BEFORE starting the API:
//   DATABASE_URL=... bun scripts/screenshot/seed.ts
import { prisma } from "../../apps/api/src/db";
import { DEMO_USER } from "./demoUser";

const IMG = "https://image.tmdb.org/t/p/w500";
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

// tmdbId, type, title, year, status, poster path, extras
const LIBRARY: Array<{
  tmdbId: number;
  type: "movie" | "show";
  title: string;
  year: number;
  status: string;
  poster: string;
  digitalReleaseDate?: Date;
}> = [
  { tmdbId: 693134, type: "movie", title: "Dune: Part Two", year: 2024, status: "downloading", poster: "/heM4XKC0jA8fTSNe8F7oUkcJV7Z.jpg" },
  { tmdbId: 872585, type: "movie", title: "Oppenheimer", year: 2023, status: "downloaded", poster: "/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg" },
  { tmdbId: 414906, type: "movie", title: "The Batman", year: 2022, status: "downloaded", poster: "/74xTEgt7R36Fpooo50r9T25onhq.jpg" },
  { tmdbId: 157336, type: "movie", title: "Interstellar", year: 2014, status: "downloaded", poster: "/yQvGrMoipbRoddT0ZR8tPoR7NfX.jpg" },
  { tmdbId: 335984, type: "movie", title: "Blade Runner 2049", year: 2017, status: "downloaded", poster: "/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg" },
  { tmdbId: 329865, type: "movie", title: "Arrival", year: 2016, status: "wanted", poster: "/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg", digitalReleaseDate: daysFromNow(9) },
  { tmdbId: 76341, type: "movie", title: "Mad Max: Fury Road", year: 2015, status: "downloaded", poster: "/hA2ple9q4qnwxp3hKVNhroipsir.jpg" },
  { tmdbId: 286217, type: "movie", title: "The Martian", year: 2015, status: "downloaded", poster: "/fASz8A0yFE3QB6LgGoOfwvFSseV.jpg" },
  { tmdbId: 95396, type: "show", title: "Severance", year: 2022, status: "downloaded", poster: "/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg" },
  { tmdbId: 136315, type: "show", title: "The Bear", year: 2022, status: "downloaded", poster: "/eKfVzzEazSIjJMrw9ADa2x8ksLz.jpg" },
  { tmdbId: 70523, type: "show", title: "Dark", year: 2017, status: "downloaded", poster: "/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg" },
  { tmdbId: 83867, type: "show", title: "Andor", year: 2022, status: "returning", poster: "/khZqmwHQicTYoS7Flreb9EddFZC.jpg" },
  { tmdbId: 106379, type: "show", title: "Fallout", year: 2024, status: "downloading", poster: "/c15BtJxCXMrISLVmysdsnZUPQft.jpg" },
  { tmdbId: 125988, type: "show", title: "Silo", year: 2023, status: "wanted", poster: "/gMYZZvnkVNTqSVnVCphWbPXwWwb.jpg" },
];

// ── Demo admin (credential account; public sign-up is disabled) ────────────
const user = await prisma.user.create({
  data: {
    email: DEMO_USER.email,
    name: DEMO_USER.name,
    emailVerified: true,
    isAdmin: true,
    createdAt: new Date(),
  },
});
await prisma.baAccount.create({
  data: {
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await Bun.password.hash(DEMO_USER.password),
  },
});

// ── Quality profile ─────────────────────────────────────────────────────────
const profile = await prisma.qualityProfile.create({
  data: {
    name: "HD-1080p+",
    minResolution: 1080,
    preferredSources: ["bluray", "web"],
    preferredCodecs: ["x265", "x264"],
    cutoffResolution: 2160,
  },
});

// ── Library ─────────────────────────────────────────────────────────────────
const idByTmdb = new Map<number, number>();
for (const m of LIBRARY) {
  const row = await prisma.libraryMedia.create({
    data: {
      tmdbId: m.tmdbId,
      type: m.type,
      title: m.title,
      sortTitle: m.title.toLowerCase(),
      year: m.year,
      status: m.status,
      monitored: true,
      posterUrl: `${IMG}${m.poster}`,
      digitalReleaseDate: m.digitalReleaseDate,
      qualityProfileId: profile.id,
      addedAt: hoursAgo(Math.floor(Math.random() * 24 * 30)),
    },
  });
  idByTmdb.set(m.tmdbId, row.id);
}

// Files for a couple of downloaded movies (quality chips on cards)
const file = (mediaId: number, name: string, res: number, codec: string) =>
  prisma.mediaFile.create({
    data: {
      mediaId,
      filePath: `/mnt/storage/movies/${name}`,
      fileName: name,
      sizeBytes: BigInt(Math.floor(8 + Math.random() * 40) * 1024 ** 3),
      videoCodec: codec,
      resolution: res,
      source: "bluray",
      audioFormat: "TrueHD Atmos",
      languageTags: ["en"],
    },
  });
await file(idByTmdb.get(872585)!, "Oppenheimer.2023.2160p.BluRay.x265-GROUP.mkv", 2160, "x265");
await file(idByTmdb.get(157336)!, "Interstellar.2014.2160p.BluRay.x265-GROUP.mkv", 2160, "x265");
await file(idByTmdb.get(414906)!, "The.Batman.2022.1080p.BluRay.x264-GROUP.mkv", 1080, "x264");

// Episodes for one show (library detail). Keep them all-downloaded with past
// air dates: a mixed wanted/future-air-date season makes the SPA's library
// views spin into a render loop that crashes the tab (see repo issue notes) —
// screenshots don't need that shape anyway.
const severance = idByTmdb.get(95396)!;
for (let e = 1; e <= 3; e++) {
  await prisma.libraryEpisode.create({
    data: {
      mediaId: severance,
      season: 1,
      episode: e,
      title: `Episode ${e}`,
      status: "downloaded",
      airDate: daysFromNow(-(30 - e)),
      downloadedAt: daysFromNow(-(29 - e)),
    },
  });
}

// Recent grab activity (dashboard feed)
const grab = (mediaId: number, releaseTitle: string, agoH: number, opts: Partial<{ completed: boolean; aiPicked: boolean }> = {}) =>
  prisma.downloadHistory.create({
    data: {
      mediaId,
      releaseTitle,
      indexer: "demo-indexer",
      torrentHash: `demo${mediaId}${agoH}`,
      grabbedAt: hoursAgo(agoH),
      completedAt: opts.completed ? hoursAgo(agoH - 1) : null,
      aiPicked: opts.aiPicked ?? false,
    },
  });
await grab(idByTmdb.get(693134)!, "Dune.Part.Two.2024.2160p.WEB-DL.DV.HDR.x265-GROUP", 2);
await grab(idByTmdb.get(106379)!, "Fallout.S02E01.1080p.WEB.h264-GROUP", 5, { aiPicked: true });
await grab(idByTmdb.get(872585)!, "Oppenheimer.2023.2160p.BluRay.x265-GROUP", 26, { completed: true });
await grab(idByTmdb.get(414906)!, "The.Batman.2022.1080p.BluRay.x264-GROUP", 49, { completed: true });

console.log(`[seed] demo user ${DEMO_USER.email} + ${LIBRARY.length} titles seeded`);
process.exit(0);
