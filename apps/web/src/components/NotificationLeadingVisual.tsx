import { useState, type ReactNode } from "react";
import {
  Download,
  Upload,
  AlertTriangle,
  BookOpen,
  Bell,
  Sparkles,
  Clock,
  Radio,
  Monitor,
  Settings,
  Leaf,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificationType } from "@rawkoon/shared/types";

type TypeStyle = { icon: ReactNode; bg: string };

const libraryStyle = {
  icon: <Download size={16} />,
  bg: "bg-emerald-900/30",
} satisfies TypeStyle;

const grabStyle = {
  icon: <Upload size={16} />,
  bg: "bg-sky-900/30",
} satisfies TypeStyle;

const failStyle = {
  icon: <AlertTriangle size={16} />,
  bg: "bg-red-900/30",
} satisfies TypeStyle;

const bookStyle = {
  icon: <BookOpen size={16} />,
  bg: "bg-amber-900/30",
} satisfies TypeStyle;

const typeConfig: Record<NotificationType, TypeStyle> = {
  reminder: { icon: <Clock size={16} />, bg: "bg-amber-900/30" },
  external: { icon: <Radio size={16} />, bg: "bg-blue-900/30" },
  "app-update": { icon: <Sparkles size={16} />, bg: "bg-violet-900/30" },
  service_monitor: { icon: <Monitor size={16} />, bg: "bg-primary-900/30" },
  system: { icon: <Settings size={16} />, bg: "bg-neutral-700/60" },
  request_pending: { icon: <Inbox size={16} />, bg: "bg-amber-900/30" },
  request_decided: { icon: <Inbox size={16} />, bg: "bg-primary-900/30" },
  request_available: { icon: <Inbox size={16} />, bg: "bg-emerald-900/30" },
  library_media_downloaded: libraryStyle,
  library_media_grabbed: grabStyle,
  library_download_failed: failStyle,
  library_post_process_failed: failStyle,
  library_grab_skipped: failStyle,
  library_attention: failStyle,
  book_grabbed: grabStyle,
  book_downloaded: bookStyle,
  book_import_failed: failStyle,
  book_search_skipped: failStyle,
  author_new_release: bookStyle,
  movie_release_reminder: { icon: <Bell size={16} />, bg: "bg-amber-900/30" },
  "github-release": { icon: <Sparkles size={16} />, bg: "bg-violet-900/30" },
  test: { icon: <Bell size={16} />, bg: "bg-primary-900/30" },
};

export function getTypeStyle(notification: {
  type: NotificationType;
  metadata?: Record<string, unknown> | null;
}): TypeStyle {
  if (notification.type === "external" && notification.metadata?.service_name) {
    const serviceName = notification.metadata.service_name as string;
    if (serviceName === "cross-seed") {
      return { icon: <Leaf size={16} />, bg: "bg-emerald-900/30" };
    }
    if (serviceName === "jellyfin") {
      return {
        icon: (
          <img
            loading="lazy"
            decoding="async"
            src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png"
            className="w-[18px] h-[18px] object-contain"
            alt="Jellyfin"
          />
        ),
        bg: "bg-violet-900/30",
      };
    }
  }
  return typeConfig[notification.type] ?? typeConfig.system;
}

export const notificationPreferenceLabels: Record<
  string,
  { en: string; fr: string; icon: LucideIcon }
> = {
  library_downloaded: {
    en: "Library downloads",
    fr: "Téléchargements bibliothèque",
    icon: Download,
  },
  library_grabbed: {
    en: "Library grabs",
    fr: "Saisies bibliothèque",
    icon: Upload,
  },
  library_failed: {
    en: "Library failures",
    fr: "Échecs bibliothèque",
    icon: AlertTriangle,
  },
  library_grab_skipped: {
    en: "Search gave up",
    fr: "Recherches abandonnées",
    icon: AlertTriangle,
  },
  library_attention: {
    en: "Library issues",
    fr: "Problèmes bibliothèque",
    icon: AlertTriangle,
  },
  book_downloaded: {
    en: "Book downloads",
    fr: "Téléchargements livres",
    icon: BookOpen,
  },
  book_grabbed: { en: "Book grabs", fr: "Saisies livres", icon: BookOpen },
  book_failed: {
    en: "Book import failures",
    fr: "Échecs import livres",
    icon: AlertTriangle,
  },
  book_search_skipped: {
    en: "Book search gave up",
    fr: "Recherches livres abandonnées",
    icon: AlertTriangle,
  },
  book_author_releases: {
    en: "New author releases",
    fr: "Nouveautés auteurs",
    icon: BookOpen,
  },
  request_pending: {
    en: "Incoming requests",
    fr: "Demandes entrantes",
    icon: Inbox,
  },
  request_decided: {
    en: "Request decisions",
    fr: "Décisions de demandes",
    icon: Inbox,
  },
  request_available: {
    en: "Request ready",
    fr: "Demandes prêtes",
    icon: Inbox,
  },
  movie_release_reminder: {
    en: "Watchlist reminders",
    fr: "Rappels liste de suivi",
    icon: Bell,
  },
  app_update: {
    en: "App updates",
    fr: "Mises à jour app",
    icon: Sparkles,
  },
  github_release: {
    en: "GitHub releases",
    fr: "Versions GitHub",
    icon: Sparkles,
  },
};

const sizeClasses = {
  sm: { box: "h-8 w-8 rounded-lg", poster: "h-11 w-8 rounded-lg" },
  md: { box: "h-10 w-10 rounded-xl text-lg", poster: "h-14 w-10 rounded-lg" },
} as const;

interface NotificationLeadingVisualProps {
  type: NotificationType;
  metadata?: Record<string, unknown> | null;
  imageUrl?: string | null;
  size: keyof typeof sizeClasses;
}

export function NotificationLeadingVisual({
  type,
  metadata,
  imageUrl,
  size,
}: NotificationLeadingVisualProps) {
  const [failed, setFailed] = useState(false);
  const s = sizeClasses[size];

  if (imageUrl && !failed) {
    return (
      <img
        loading="lazy"
        decoding="async"
        src={imageUrl}
        alt=""
        onError={() => setFailed(true)}
        className={cn("shrink-0 object-cover", s.poster)}
      />
    );
  }

  const style = getTypeStyle({ type, metadata });
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center",
        s.box,
        style.bg,
      )}
    >
      {style.icon}
    </div>
  );
}
