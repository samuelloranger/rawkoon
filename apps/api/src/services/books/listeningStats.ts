import { loadConfig } from "@rawkoon/api/config";
import { prisma } from "@rawkoon/api/db";
import {
  buildSeriesStats,
  calendarDateInTz,
  creditSeconds,
  isoWeekDays,
  streakDays,
  type SeriesBookInput,
} from "@rawkoon/api/services/books/listeningStatsMath";
import type { BookListeningStats } from "@rawkoon/shared/types";

export function ymdToUtcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export async function incrementDaily(
  userId: string,
  receivedAt: Date,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) return;
  const day = ymdToUtcDate(calendarDateInTz(receivedAt, loadConfig().TZ));
  await prisma.bookListeningDaily.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, seconds },
    update: { seconds: { increment: seconds } },
  });
}

export async function applyListeningCredit(input: {
  userId: string;
  created: boolean;
  previous: { positionSecs: number; receivedAt: Date } | null;
  newPosition: number;
  receivedAt: Date;
}): Promise<void> {
  if (input.created || !input.previous) return;
  const elapsed =
    (input.receivedAt.getTime() - input.previous.receivedAt.getTime()) / 1000;
  const credited = creditSeconds(
    input.previous.positionSecs,
    input.newPosition,
    elapsed,
  );
  if (credited <= 0) return;
  try {
    await incrementDaily(input.userId, input.receivedAt, credited);
  } catch (error) {
    console.error("[listeningStats] credit failed:", error);
  }
}

export async function getListeningStats(
  userId: string,
  now = new Date(),
): Promise<BookListeningStats> {
  const timezone = loadConfig().TZ;
  const todayYmd = calendarDateInTz(now, timezone);

  const [dailyRows, books] = await Promise.all([
    prisma.bookListeningDaily.findMany({
      where: { userId },
      orderBy: { day: "asc" },
    }),
    prisma.libraryBook.findMany({
      select: {
        title: true,
        seriesName: true,
        editions: {
          where: { kind: "audiobook" },
          select: {
            progress: {
              where: { userId },
              select: {
                finished: true,
                positionSecs: true,
                totalDurationSecs: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const dailyMap = new Map<string, number>();
  for (const row of dailyRows) {
    const ymd = row.day.toISOString().slice(0, 10);
    dailyMap.set(ymd, row.seconds);
  }

  const since =
    dailyRows.length > 0
      ? dailyRows[0].day.toISOString().slice(0, 10)
      : null;

  const week = isoWeekDays(todayYmd).map((day) => ({
    day,
    seconds: dailyMap.get(day) ?? 0,
  }));
  const today_secs = dailyMap.get(todayYmd) ?? 0;
  const week_secs = week.reduce((sum, entry) => sum + entry.seconds, 0);

  const daysWithSeconds = new Set(
    [...dailyMap.entries()]
      .filter(([, seconds]) => seconds > 0)
      .map(([day]) => day),
  );
  const streak_days = streakDays(daysWithSeconds, todayYmd);

  const seriesBooks: SeriesBookInput[] = books.map((book) => {
    const progress = book.editions[0]?.progress[0];
    return {
      seriesName: book.seriesName,
      title: book.title,
      hasAudiobook: book.editions.length > 0,
      finished: progress?.finished ?? false,
      positionSecs: progress?.positionSecs ?? 0,
      totalDurationSecs: progress?.totalDurationSecs ?? 0,
      updatedAtMs: progress?.updatedAt.getTime() ?? null,
    };
  });

  return {
    timezone,
    today_secs,
    week_secs,
    streak_days,
    since,
    week,
    series: buildSeriesStats(seriesBooks),
  };
}
