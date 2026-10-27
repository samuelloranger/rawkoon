import { randomBytes } from "node:crypto";
import { prisma } from "@rawkoon/api/db";

const generateCalendarToken = () => randomBytes(32).toString("base64url");

const readToken = async (userId: string) =>
  (
    await prisma.user.findUnique({
      where: { id: userId },
      select: { calendarToken: true },
    })
  )?.calendarToken ?? null;

/** Returns the user's calendar token, minting one on first use; null if none could be stored. */
export async function getOrCreateCalendarToken(
  userId: string,
): Promise<string | null> {
  const existing = await readToken(userId);
  if (existing) return existing;
  // Only fills an empty slot, so two first views at once can't each mint a token.
  await prisma.user.updateMany({
    where: { id: userId, calendarToken: null },
    data: { calendarToken: generateCalendarToken() },
  });
  return readToken(userId);
}

export async function regenerateCalendarToken(userId: string): Promise<string> {
  const token = generateCalendarToken();
  await prisma.user.update({
    where: { id: userId },
    data: { calendarToken: token },
  });
  return token;
}

export const findLocaleByCalendarToken = (token: string) =>
  prisma.user.findUnique({
    where: { calendarToken: token },
    select: { locale: true },
  });
