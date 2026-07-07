import { cn } from "@/lib/utils";
import type { NotificationType } from "@rawkoon/shared/types";
import {
  getTypeStyle,
  NotificationLeadingVisual,
} from "@/components/NotificationLeadingVisual";

export { getTypeStyle };

interface NotificationMenuRowProps {
  type: NotificationType;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  imageUrl?: string | null;
  isUnread?: boolean;
  relativeTime?: string;
  onClick?: () => void;
}

export function NotificationMenuRow({
  type,
  title,
  body,
  metadata,
  imageUrl,
  isUnread = true,
  relativeTime,
  onClick,
}: NotificationMenuRowProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-start gap-3 w-full text-left px-4 py-3 transition-colors",
        isUnread
          ? "bg-primary-500/10 hover:bg-primary-500/20"
          : "hover:bg-white/[0.05]",
      )}
    >
      {isUnread && (
        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-primary-500" />
      )}

      <NotificationLeadingVisual
        type={type}
        metadata={metadata}
        imageUrl={imageUrl}
        size="sm"
      />

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-[13px] leading-snug",
            isUnread
              ? "font-semibold text-white"
              : "font-medium text-neutral-300",
          )}
        >
          {title}
        </p>
        {body && (
          <p
            className={cn(
              "text-xs mt-0.5 line-clamp-2 leading-relaxed",
              isUnread ? "text-neutral-300" : "text-neutral-400",
            )}
          >
            {body}
          </p>
        )}
        {relativeTime && (
          <p
            className={cn(
              "text-[11px] mt-1",
              isUnread ? "text-neutral-400" : "text-neutral-500",
            )}
          >
            {relativeTime}
          </p>
        )}
      </div>

      {isUnread && (
        <div className="shrink-0 mt-1.5">
          <div className="h-2 w-2 rounded-full bg-primary-500" />
        </div>
      )}
    </button>
  );
}
