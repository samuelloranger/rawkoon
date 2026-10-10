import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { normalizeTitleLanguage } from "@rawkoon/shared/constants";
import type { CalendarSubscription } from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { getBaseUrl } from "@rawkoon/api/config";
import { notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { buildLibraryCalendar } from "@rawkoon/api/services/calendarFeed";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const generateCalendarToken = () => randomBytes(32).toString("base64url");

function subscriptionFor(token: string): CalendarSubscription {
  const url = `${getBaseUrl().replace(/\/+$/, "")}/api/calendar/${token}.ics`;
  return { url, webcal_url: url.replace(/^https?:/, "webcal:") };
}

// Guards are per route: the feed itself is public and authenticates by its token.
export const calendarRoutes = new Hono<Env>()
  .get("/subscription", requireUser, async (c) => {
    try {
      const userId = c.get("user").id;
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { calendarToken: true },
      });
      if (existing?.calendarToken) {
        return ok(subscriptionFor(existing.calendarToken));
      }
      const token = generateCalendarToken();
      // Only fills an empty slot, so two first views at once can't each mint a token.
      await prisma.user.updateMany({
        where: { id: userId, calendarToken: null },
        data: { calendarToken: token },
      });
      const stored = await prisma.user.findUnique({
        where: { id: userId },
        select: { calendarToken: true },
      });
      if (!stored?.calendarToken) return serverError("Calendar unavailable");
      return ok(subscriptionFor(stored.calendarToken));
    } catch (error) {
      console.error("Error creating calendar subscription:", error);
      return serverError("Failed to load calendar subscription");
    }
  })
  .post("/subscription/regenerate", requireUser, async (c) => {
    try {
      const token = generateCalendarToken();
      await prisma.user.update({
        where: { id: c.get("user").id },
        data: { calendarToken: token },
      });
      return ok(subscriptionFor(token));
    } catch (error) {
      console.error("Error regenerating calendar subscription:", error);
      return serverError("Failed to regenerate calendar subscription");
    }
  })
  .get("/:file", async (c) => {
    const file = c.req.param("file");
    const token = file.endsWith(".ics") ? file.slice(0, -4) : "";
    if (!TOKEN_PATTERN.test(token)) return notFound("Not found");
    try {
      const user = await prisma.user.findUnique({
        where: { calendarToken: token },
        select: { locale: true },
      });
      if (!user) return notFound("Not found");
      const body = await buildLibraryCalendar(
        normalizeTitleLanguage(user.locale),
        getBaseUrl(),
      );
      return c.body(body, 200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="rawkoon.ics"',
        "Cache-Control": "private, max-age=300",
      });
    } catch (error) {
      console.error("Error building calendar feed:", error);
      return serverError("Failed to build calendar");
    }
  });
