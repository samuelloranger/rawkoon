import { loadConfig } from "@rawkoon/api/config";
import { prisma } from "@rawkoon/api/db";
import {
  calendarDateInTz,
  creditSeconds,
} from "@rawkoon/api/services/books/listeningStatsMath";

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
