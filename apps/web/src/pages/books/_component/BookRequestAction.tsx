import { Loader2, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MediaRequestStatus } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { useCreateRequest } from "@/pages/requests/_hooks/useRequests";

const STATUS_STYLES: Record<MediaRequestStatus, string> = {
  pending: "bg-amber-500/15 text-amber-400",
  approved: "bg-primary-500/15 text-primary-300",
  denied: "bg-rose-500/15 text-rose-400",
  available: "bg-emerald-500/15 text-emerald-400",
};

export interface BookRequestTarget {
  google_volume_id: string;
  title: string;
  author: string | null;
  poster_url: string | null;
  year: number | null;
}

/**
 * Member-side replacement for "add to library": files a request, then shows its
 * status. A denied request reopens server-side, so it stays requestable.
 */
export function BookRequestAction({
  book,
  request,
}: {
  book: BookRequestTarget;
  request: { id: number; status: MediaRequestStatus } | null;
}) {
  const { t } = useTranslation("common");
  const { mutate, isPending, isSuccess, isError } = useCreateRequest();

  const status: MediaRequestStatus | null = isSuccess
    ? "pending"
    : (request?.status ?? null);
  const canRequest = status === null || status === "denied";

  if (!canRequest && status) {
    return (
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
      >
        {t(`books.request.status.${status}`)}
      </span>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {status === "denied" && (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES.denied}`}
        >
          {t("books.request.status.denied")}
        </span>
      )}
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => mutate({ type: "book", ...book })}
      >
        {isPending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="mr-1 h-3.5 w-3.5" />
        )}
        {status === "denied"
          ? t("books.request.again")
          : t("books.request.action")}
      </Button>
      {isError && (
        <span className="text-xs text-rose-300">
          {t("books.request.failed")}
        </span>
      )}
    </div>
  );
}
