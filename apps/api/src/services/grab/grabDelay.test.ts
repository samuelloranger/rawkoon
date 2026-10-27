import { beforeEach, describe, expect, it, mock } from "bun:test";

type Row = {
  targetKey: string;
  releaseGuid: string;
  score: number;
  grabAfter: Date;
  createdAt: Date;
  [k: string]: unknown;
};
let rows: Row[] = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    pendingRelease: {
      findMany: mock(async ({ where }: { where: { targetKey: string } }) =>
        rows.filter((r) => r.targetKey === where.targetKey),
      ),
      upsert: mock(
        async (a: {
          where: {
            targetKey_releaseGuid: { targetKey: string; releaseGuid: string };
          };
          create: Row;
          update: Partial<Row>;
        }) => {
          const k = a.where.targetKey_releaseGuid;
          const hit = rows.find(
            (r) =>
              r.targetKey === k.targetKey && r.releaseGuid === k.releaseGuid,
          );
          if (hit) Object.assign(hit, a.update);
          else rows.push({ ...a.create, createdAt: new Date() });
        },
      ),
      deleteMany: mock(async ({ where }: { where: { targetKey: string } }) => {
        rows = rows.filter((r) => r.targetKey !== where.targetKey);
      }),
    },
  },
}));

const { evaluateDelay, meetsCutoff, targetKey, delaySettingsOf, clearPending } =
  await import("./grabDelay");

const NOW = new Date("2026-01-01T12:00:00Z");
const minutesAgo = (m: number) =>
  new Date(NOW.getTime() - m * 60_000).toISOString();

const cand = (
  guid: string,
  score: number,
  resolution: number,
  publishedAt: string | null,
) => ({
  release: {
    guid,
    title: `Show.S01E01.${resolution}p.WEB-DL-GRP`,
    publishedAt,
  } as never,
  score,
  resolution,
});

const target = { mediaId: 1, episodeId: 7, season: null };
const settings = { minutes: 60, bypassIfCutoffMet: true };

beforeEach(() => {
  rows = [];
});

describe("targetKey", () => {
  it("distinguishes movie, episode and season-pack targets", () => {
    expect(targetKey({ mediaId: 1, episodeId: null, season: null })).toBe(
      "m:1",
    );
    expect(targetKey({ mediaId: 1, episodeId: 7, season: null })).toBe("e:7");
    expect(targetKey({ mediaId: 1, episodeId: null, season: 2 })).toBe("s:1:2");
  });
});

describe("meetsCutoff", () => {
  it("needs a cutoff and a resolution at or above it", () => {
    expect(meetsCutoff(1080, 1080)).toBe(true);
    expect(meetsCutoff(2160, 1080)).toBe(true);
    expect(meetsCutoff(720, 1080)).toBe(false);
    expect(meetsCutoff(1080, null)).toBe(false);
    expect(meetsCutoff(null, 1080)).toBe(false);
  });
});

describe("delaySettingsOf", () => {
  it("defaults to no delay with bypass on", () => {
    expect(delaySettingsOf(null)).toEqual({
      minutes: 0,
      bypassIfCutoffMet: true,
    });
  });
});

describe("evaluateDelay", () => {
  it("never delays when the profile delay is 0", async () => {
    const d = await evaluateDelay({
      target,
      settings: { minutes: 0, bypassIfCutoffMet: true },
      cutoffResolution: null,
      candidates: [cand("a", 100, 720, minutesAgo(1))],
      now: NOW,
    });
    expect(d).toEqual({ delay: false });
    expect(rows).toHaveLength(0);
  });

  it("holds a release still inside its window and stores it as pending", async () => {
    const d = await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("a", 100, 720, minutesAgo(10))],
      now: NOW,
    });
    expect(d.delay).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.grabAfter.getTime()).toBe(NOW.getTime() + 50 * 60_000);
  });

  it("lets a release grab once its window has elapsed", async () => {
    const d = await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("a", 100, 720, minutesAgo(90))],
      now: NOW,
    });
    expect(d).toEqual({ delay: false });
    expect(rows).toHaveLength(0);
  });

  it("bypasses the delay when the best release meets the cutoff", async () => {
    const d = await evaluateDelay({
      target,
      settings,
      cutoffResolution: 1080,
      candidates: [
        cand("a", 100, 720, minutesAgo(5)),
        cand("b", 200, 1080, minutesAgo(5)),
      ],
      now: NOW,
    });
    expect(d).toEqual({ delay: false });
  });

  it("keeps the delay when bypass is off even if the cutoff is met", async () => {
    const d = await evaluateDelay({
      target,
      settings: { minutes: 60, bypassIfCutoffMet: false },
      cutoffResolution: 1080,
      candidates: [cand("b", 200, 1080, minutesAgo(5))],
      now: NOW,
    });
    expect(d.delay).toBe(true);
  });

  it("starts the clock at first sight when the release has no publish date", async () => {
    const first = await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("a", 100, 720, null)],
      now: NOW,
    });
    expect(first.delay).toBe(true);

    // Next poll, 61 minutes later: the first-seen time has elapsed, so the held
    // row is due for processPendingReleases rather than given a fresh window.
    rows[0]!.createdAt = NOW;
    const later = new Date(NOW.getTime() + 61 * 60_000);
    await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("a", 100, 720, null)],
      now: later,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.grabAfter.getTime()).toBe(NOW.getTime() + 60 * 60_000);
  });

  it("collects a better candidate arriving inside the window", async () => {
    await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("low", 100, 720, minutesAgo(20))],
      now: NOW,
    });
    const d = await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [
        cand("low", 100, 720, minutesAgo(20)),
        cand("high", 300, 1080, minutesAgo(2)),
      ],
      now: NOW,
    });
    expect(d.delay).toBe(true);
    expect(rows.map((r) => r.releaseGuid).sort()).toEqual(["high", "low"]);
    // Window is anchored on the earliest publish, not the newcomer.
    if (d.delay) {
      expect(d.grabAfter.getTime()).toBe(NOW.getTime() + 40 * 60_000);
    }
  });

  it("updates a candidate seen again instead of duplicating it", async () => {
    const c = cand("a", 100, 720, minutesAgo(10));
    await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [c],
      now: NOW,
    });
    await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [{ ...c, score: 150 }],
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(150);
  });
});

describe("held rows own the target", () => {
  it("keeps holding when a due held release meets a worse batch", async () => {
    // X1080 was held earlier and is already due; the poll only sees Y720.
    await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("x1080", 300, 1080, minutesAgo(30))],
      now: NOW,
    });
    const later = new Date(NOW.getTime() + 40 * 60_000);
    const d = await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("y720", 100, 720, minutesAgo(-35))],
      now: later,
    });
    expect(d.delay).toBe(true);
    expect(rows.map((r) => r.releaseGuid).sort()).toEqual(["x1080", "y720"]);
  });

  it("still lets a cutoff-meeting release through while rows are held", async () => {
    await evaluateDelay({
      target,
      settings,
      cutoffResolution: 1080,
      candidates: [cand("low", 100, 720, minutesAgo(10))],
      now: NOW,
    });
    const d = await evaluateDelay({
      target,
      settings,
      cutoffResolution: 1080,
      candidates: [cand("top", 300, 1080, minutesAgo(1))],
      now: NOW,
    });
    expect(d).toEqual({ delay: false });
  });

  it("clamps a future publish time to now", async () => {
    const future = new Date(NOW.getTime() + 6 * 3600_000).toISOString();
    const d = await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("a", 100, 720, future)],
      now: NOW,
    });
    expect(d.delay).toBe(true);
    expect(rows[0]!.grabAfter.getTime()).toBe(NOW.getTime() + 60 * 60_000);
  });
});

describe("clearPending", () => {
  it("drops every row for the target only", async () => {
    await evaluateDelay({
      target,
      settings,
      cutoffResolution: 2160,
      candidates: [cand("a", 100, 720, minutesAgo(10))],
      now: NOW,
    });
    await evaluateDelay({
      target: { mediaId: 2, episodeId: null, season: null },
      settings,
      cutoffResolution: 2160,
      candidates: [cand("z", 100, 720, minutesAgo(10))],
      now: NOW,
    });
    await clearPending(target);
    expect(rows.map((r) => r.targetKey)).toEqual(["m:2"]);
  });
});
