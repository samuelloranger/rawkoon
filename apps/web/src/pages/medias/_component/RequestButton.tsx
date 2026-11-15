import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Send } from "lucide-react";
import { useAddFlow, type RequestMedia } from "@/features/add/useAddFlow";

export function RequestButton({ media }: { media: RequestMedia }) {
  const { t } = useTranslation("common");
  const { request } = useAddFlow();
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const isPending = state === "pending";
  const isSuccess = state === "done";

  const onClick = async () => {
    setState("pending");
    setState((await request(media)) ? "done" : "idle");
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
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
