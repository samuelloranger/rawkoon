import { useState, type ReactNode } from "react";
import {
  Clock,
  Radio,
  Sparkles,
  Monitor,
  Settings,
  Leaf,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificationType } from "@rawkoon/shared/types";

const typeConfig: Record<NotificationType, { icon: ReactNode; bg: string }> = {
  reminder: {
    icon: <Clock size={16} />,
    bg: "bg-amber-900/30",
  },
  external: {
    icon: <Radio size={16} />,
    bg: "bg-blue-900/30",
  },
  "app-update": {
    icon: <Sparkles size={16} />,
    bg: "bg-violet-900/30",
  },
  service_monitor: {
    icon: <Monitor size={16} />,
    bg: "bg-primary-900/30",
  },
  system: {
    icon: <Settings size={16} />,
    bg: "bg-neutral-700/60",
  },
  request_pending: {
    icon: <Inbox size={16} />,
    bg: "bg-amber-900/30",
  },
  request_decided: {
    icon: <Inbox size={16} />,
    bg: "bg-primary-900/30",
  },
  request_available: {
    icon: <Inbox size={16} />,
    bg: "bg-emerald-900/30",
  },
};

export function getTypeStyle(notification: {
  type: NotificationType;
  metadata?: Record<string, unknown> | null;
}): { icon: ReactNode; bg: string } {
  if (notification.type === "external" && notification.metadata?.service_name) {
    const serviceName = notification.metadata.service_name as string;
    if (serviceName === "cross-seed") {
      return {
        icon: <Leaf size={16} />,
        bg: "bg-emerald-900/30",
      };
    }
    if (serviceName === "jellyfin") {
      return {
        icon: (
          <img
            src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png"
            className="w-[18px] h-[18px] object-contain"
            alt="Jellyfin"
          />
        ),
        bg: "bg-violet-900/30",
      };
    }
  }
  return typeConfig[notification.type] || typeConfig.system;
}

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

/**
 * Leading visual for a notification row: a 2:3 poster thumbnail when the
 * notification carries an image, otherwise the type-icon box. Falls back to the
 * icon if the image fails to load — the poster is purely decorative.
 */
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
