import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  Wrench,
  SkipForward,
  Plug,
  XCircle,
  CheckCircle,
  Calendar,
  Download,
} from "lucide-react";
import type { TFunction } from "i18next";
import type { Activity } from "@rawkoon/shared/types";
import { formatRelativeTime } from "@/lib/utils/relativeTime";

export interface ActivityPresentation {
  Icon: LucideIcon;
  description: string;
  time: string;
  type: string;
  typeLabel: string;
  service: string;
  serviceLabel: string;
}

const SERVICE_LABEL_KEYS: Record<string, string> = {
  chores: "dashboard.activityPage.services.chores",
  calendar: "dashboard.activityPage.services.calendar",
  habits: "dashboard.activityPage.services.habits",
  system: "dashboard.activityPage.services.system",
  admin: "dashboard.activityPage.services.admin",
  tmdb: "dashboard.activityPage.services.tmdb",
  jellyfin: "dashboard.activityPage.services.jellyfin",
  qbittorrent: "dashboard.activityPage.services.qbittorrent",
  prowlarr: "dashboard.activityPage.services.prowlarr",
  library: "dashboard.activityPage.services.library",
};

const TYPE_LABEL_KEYS: Record<string, string> = {
  task_completed: "dashboard.activityPage.types.task_completed",
  chore_completed: "dashboard.activityPage.types.chore_completed",
  habit_completed: "dashboard.activityPage.types.habit_completed",
  integration_updated: "dashboard.activityPage.types.integration_updated",
  cron_job_ended: "dashboard.activityPage.types.cron_job_ended",
  cron_job_skipped: "dashboard.activityPage.types.cron_job_skipped",
  app_updated: "dashboard.activityPage.types.app_updated",
  admin_triggered_job: "dashboard.activityPage.types.admin_triggered_job",
  event_created: "dashboard.activityPage.types.event_created",
  event_updated: "dashboard.activityPage.types.event_updated",
  event_deleted: "dashboard.activityPage.types.event_deleted",
  media_grab: "dashboard.activityPage.types.media_grab",
};

function titleize(value: string): string {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getActivityType(activity: Activity): string {
  if (activity.type) return activity.type;

  switch (activity.task_type) {
    case "chore":
      return "chore_completed";
    default:
      return "task_completed";
  }
}

function getActivityService(activity: Activity): string {
  if (activity.service?.trim()) return activity.service.trim().toLowerCase();

  switch (activity.task_type) {
    case "chore":
      return "chores";
    default:
      return "system";
  }
}

export function getActivityTypeLabel(
  t: TFunction<"common">,
  type: string,
): string {
  const key = TYPE_LABEL_KEYS[type];
  if (key) return t(key);
  return titleize(type);
}

export function getActivityServiceLabel(
  t: TFunction<"common">,
  service: string,
): string {
  const normalized = service.trim().toLowerCase();
  const key = SERVICE_LABEL_KEYS[normalized];
  if (key) return t(key);
  return titleize(normalized);
}

export function getActivityPresentation(
  activity: Activity,
  t: TFunction<"common">,
  language: string,
): ActivityPresentation | null {
  const type = getActivityType(activity);
  const service = getActivityService(activity);

  if (type === "app_updated") {
    const time =
      formatRelativeTime(activity.completed_at ?? null, language) ?? "";
    const fromVersion = activity.from_version ?? "";
    const toVersion = activity.to_version ?? "";
    const description =
      fromVersion && toVersion
        ? t("dashboard.activity.appUpdated", {
            from: fromVersion,
            to: toVersion,
          })
        : t("dashboard.activity.appUpdatedGeneric");
    return {
      Icon: Sparkles,
      description,
      time,
      type,
      typeLabel: getActivityTypeLabel(t, type),
      service,
      serviceLabel: getActivityServiceLabel(t, service),
    };
  }

  if (type === "admin_triggered_job") {
    const time =
      formatRelativeTime(activity.completed_at ?? null, language) ?? "";
    const jobName =
      activity.job_name ||
      activity.job_id ||
      t("dashboard.activity.unknownJob");
    return {
      Icon: Wrench,
      description: t("dashboard.activity.adminTriggeredJob", { job: jobName }),
      time,
      type,
      typeLabel: getActivityTypeLabel(t, type),
      service,
      serviceLabel: getActivityServiceLabel(t, service),
    };
  }

  if (type === "cron_job_skipped") {
    const time =
      formatRelativeTime(activity.completed_at ?? null, language) ?? "";
    const jobName =
      activity.job_name ||
      activity.job_id ||
      t("dashboard.activity.unknownJob");
    const reason = activity.reason || t("dashboard.activity.unknownReason");
    return {
      Icon: SkipForward,
      description: t("dashboard.activity.cronSkipped", {
        job: jobName,
        reason,
      }),
      time,
      type,
      typeLabel: getActivityTypeLabel(t, type),
      service,
      serviceLabel: getActivityServiceLabel(t, service),
    };
  }

  if (type === "integration_updated") {
    const time =
      formatRelativeTime(activity.completed_at ?? null, language) ?? "";
    const integrationType =
      activity.integration_type || t("dashboard.activity.unknownIntegration");
    return {
      Icon: Plug,
      description: t("dashboard.activity.integrationUpdated", {
        integration: integrationType,
      }),
      time,
      type,
      typeLabel: getActivityTypeLabel(t, type),
      service,
      serviceLabel: getActivityServiceLabel(t, service),
    };
  }

  if (type === "cron_job_ended") {
    const time =
      formatRelativeTime(activity.completed_at ?? null, language) ?? "";
    const jobName =
      activity.job_name ||
      activity.job_id ||
      t("dashboard.activity.unknownJob");
    const seconds =
      typeof activity.duration_ms === "number" &&
      Number.isFinite(activity.duration_ms)
        ? Math.max(0, Math.round(activity.duration_ms / 1000))
        : null;
    const description =
      activity.success === false
        ? t("dashboard.activity.cronFailed", { job: jobName })
        : t("dashboard.activity.cronEnded", {
            job: jobName,
            seconds: seconds ?? 0,
          });
    return {
      Icon: activity.success === false ? XCircle : CheckCircle,
      description,
      time,
      type,
      typeLabel: getActivityTypeLabel(t, type),
      service,
      serviceLabel: getActivityServiceLabel(t, service),
    };
  }

  if (
    type === "event_created" ||
    type === "event_updated" ||
    type === "event_deleted"
  ) {
    const time =
      formatRelativeTime(activity.completed_at ?? null, language) ?? "";
    const eventTitle =
      activity.event_title || t("dashboard.activity.unknownEvent");
    const description =
      type === "event_created"
        ? t("dashboard.activity.eventCreated", { event: eventTitle })
        : type === "event_updated"
          ? t("dashboard.activity.eventUpdated", { event: eventTitle })
          : t("dashboard.activity.eventDeleted", { event: eventTitle });
    return {
      Icon: Calendar,
      description,
      time,
      type,
      typeLabel: getActivityTypeLabel(t, type),
      service,
      serviceLabel: getActivityServiceLabel(t, service),
    };
  }

  if (type === "media_grab") {
    const time =
      formatRelativeTime(activity.completed_at ?? null, language) ?? "";
    const title =
      activity.release_title ?? t("dashboard.activity.unknownRelease");
    const svc = activity.service?.trim().toLowerCase() || "library";
    const isRssAi =
      activity.grab_source === "rss" && activity.ai_picked === true;
    return {
      Icon: Download,
      description: isRssAi
        ? t("dashboard.activity.mediaGrabRssAi", { title })
        : t("dashboard.activity.mediaGrab", { title }),
      time,
      type,
      typeLabel: getActivityTypeLabel(t, type),
      service: svc,
      serviceLabel: getActivityServiceLabel(t, svc),
    };
  }

  const username = activity.username || t("dashboard.activity.unknownUser");
  const taskName = activity.task_name || t("dashboard.activity.unknownTask");
  const time =
    formatRelativeTime(activity.completed_at ?? null, language) ?? "";
  const Icon = CheckCircle;

  return {
    Icon,
    description: t("dashboard.activity.completed", {
      user: username,
      task: taskName,
    }),
    time,
    type,
    typeLabel: getActivityTypeLabel(t, type),
    service,
    serviceLabel: getActivityServiceLabel(t, service),
  };
}
