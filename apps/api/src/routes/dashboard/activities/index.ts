import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { formatIso } from "@rawkoon/api/utils";
import { serverError } from "@rawkoon/api/errors";

type ActivityRecord = {
  id: number;
  user_id?: string;
  task_type?: string;
  task_id?: number;
  completed_at?: string;
  task_name?: string;
  emotion?: string | null;
  username?: string;
  type?: string;
  service?: string;
  action?: string;
  reason?: string;
  from_version?: string;
  to_version?: string;
  event_id?: number;
  event_title?: string;
  item_name?: string;
  count?: number;
  integration_type?: string;
  job_id?: string;
  job_name?: string;
  success?: boolean;
  duration_ms?: number;
  message?: string;
  trigger?: string;
  media_id?: number;
  episode_id?: number;
  release_title?: string;
  grab_source?: string;
  ai_picked?: boolean;
};

const ACTIVITY_FEED_SOURCE_LIMIT = 500;

const parseString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
const parseBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;
const parseNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const parseIntNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

function getLogService(
  type: string,
  payload: Record<string, unknown> | null,
): string {
  if (type === "integration_updated") {
    return (
      parseString(payload?.integration_type)?.trim().toLowerCase() || "system"
    );
  }

  if (type === "admin_triggered_job") return "admin";
  if (type.startsWith("event_")) return "calendar";
  if (type === "media_grab") return "library";

  return "system";
}

function mapActivityLogToActivity(log: {
  id: number;
  userId: string | null;
  type: string;
  payload: unknown;
  createdAt: Date;
  user?: { firstName: string | null; email: string | null } | null;
}): ActivityRecord {
  const payload =
    log.payload &&
    typeof log.payload === "object" &&
    !Array.isArray(log.payload)
      ? (log.payload as Record<string, unknown>)
      : null;

  return {
    id: log.id,
    user_id: log.userId ?? undefined,
    completed_at: formatIso(log.createdAt) ?? undefined,
    username: log.user?.firstName || log.user?.email || undefined,
    type: log.type,
    service: getLogService(log.type, payload),
    action: parseString(payload?.action),
    reason: parseString(payload?.reason),
    from_version: parseString(payload?.from_version),
    to_version: parseString(payload?.to_version),
    event_id: parseIntNumber(payload?.event_id),
    event_title: parseString(payload?.event_title),
    item_name: parseString(payload?.item_name),
    count: parseNumber(payload?.count),
    integration_type: parseString(payload?.integration_type),
    job_id: parseString(payload?.job_id),
    job_name: parseString(payload?.job_name),
    success: parseBoolean(payload?.success),
    duration_ms: parseNumber(payload?.duration_ms),
    message: parseString(payload?.message),
    trigger: parseString(payload?.trigger),
    media_id: parseIntNumber(payload?.media_id),
    episode_id: parseIntNumber(payload?.episode_id),
    release_title: parseString(payload?.release_title),
    grab_source: parseString(payload?.grab_source),
    ai_picked: parseBoolean(payload?.ai_picked),
  };
}

function sortActivitiesDescending(
  activities: ActivityRecord[],
): ActivityRecord[] {
  return [...activities].sort((a, b) => {
    const at =
      typeof a.completed_at === "string"
        ? new Date(a.completed_at).getTime()
        : 0;
    const bt =
      typeof b.completed_at === "string"
        ? new Date(b.completed_at).getTime()
        : 0;
    return bt - at;
  });
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b));
}

function matchesActivityFilters(
  activity: ActivityRecord,
  filters: { service?: string; type?: string },
): boolean {
  if (filters.service && activity.service !== filters.service) return false;
  if (filters.type && activity.type !== filters.type) return false;
  return true;
}

export const dashboardActivitiesRoutes = new Elysia()
  .use(auth)
  .use(requireUser)
  .get(
    "/activities/feed",
    async ({ query, set }) => {
      try {
        const limit = query.limit ? parseInt(query.limit, 10) : 25;
        const safeLimit =
          Number.isFinite(limit) && limit > 0 ? Math.min(limit, 250) : 25;
        const filters = {
          service: query.service?.trim().toLowerCase() || undefined,
          type: query.type?.trim() || undefined,
        };

        const recentLogs = await prisma.activityLog.findMany({
          orderBy: { createdAt: "desc" },
          take: ACTIVITY_FEED_SOURCE_LIMIT,
          include: {
            user: {
              select: {
                firstName: true,
                email: true,
              },
            },
          },
        });

        const allActivities = sortActivitiesDescending(
          recentLogs
            .map(mapActivityLogToActivity)
            .filter((entry) => entry.completed_at),
        );

        const filteredActivities = allActivities.filter((activity) =>
          matchesActivityFilters(activity, filters),
        );

        return {
          activities: filteredActivities.slice(0, safeLimit),
          available_services: uniqueSorted(
            allActivities.map((activity) => activity.service),
          ),
          available_types: uniqueSorted(
            allActivities.map((activity) => activity.type),
          ),
          total: filteredActivities.length,
          limit: safeLimit,
          has_more: filteredActivities.length > safeLimit,
        };
      } catch (err) {
        console.error("Error getting dashboard activity feed:", err);
        return serverError(set, "Failed to get dashboard activity feed");
      }
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        service: t.Optional(t.String()),
        type: t.Optional(t.String()),
      }),
    },
  );
