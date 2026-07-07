import { useTranslation } from "react-i18next";
import { Check, Send } from "lucide-react";
import { useCreateRequest } from "@/pages/requests/_hooks/useRequests";

interface Props {
  media: {
    tmdb_id: number;
    type: "movie" | "show";
    title: string;
    poster_url: string | null;
    year: number | null;
  };
}

export function RequestButton({ media }: Props) {
  const { t } = useTranslation("common");
  const { mutate, isPending, isSuccess } = useCreateRequest();

  return (
    <button
      type="button"
      onClick={() => mutate(media)}
      disabled={isPending || isSuccess}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition-[background-color] hover:bg-primary-500 active:bg-primary-700 disabled:opacity-50"
    >
      {isPending ? (
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent" />
      ) : isSuccess ? (
        <Check size={12} />
      ) : (
        <Send size={12} />
      )}
      {isSuccess ? t("requests.requested") : t("requests.request")}
    </button>
  );
}
