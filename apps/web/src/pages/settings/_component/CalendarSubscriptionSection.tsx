import { useState } from "react";
import { CalendarPlus, Check, Copy, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  useCalendarSubscription,
  useRegenerateCalendarSubscription,
} from "@/pages/settings/_component/useCalendarSubscription";

export function CalendarSubscriptionSection() {
  const { t } = useTranslation("common");
  const { data, isLoading, isError } = useCalendarSubscription();
  const regenerate = useRegenerateCalendarSubscription();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      toast.success(t("settings.calendar.subscription.copied"));
    } catch {
      toast.error(t("settings.calendar.subscription.copyError"));
    }
  };

  const handleRegenerate = async () => {
    try {
      await regenerate.mutateAsync();
      toast.success(t("settings.calendar.subscription.regenerated"));
    } catch {
      toast.error(t("settings.calendar.subscription.regenerateError"));
    } finally {
      setConfirmRegenerate(false);
    }
  };

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
      <h2 className="text-base font-semibold mb-1.5 text-neutral-100 flex items-center gap-2">
        <CalendarPlus className="w-5 h-5 text-neutral-400" />
        {t("settings.calendar.subscription.title")}
      </h2>
      <p className="text-neutral-400 mb-6 text-sm">
        {t("settings.calendar.subscription.description")}
      </p>

      {isLoading ? (
        <p className="text-sm text-neutral-400">{t("common.loading")}</p>
      ) : isError || !data ? (
        <p className="text-sm text-red-400">
          {t("settings.calendar.subscription.loadError")}
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="calendar-subscription-url"
              className="block text-xs font-medium text-neutral-400 mb-1.5"
            >
              {t("settings.calendar.subscription.urlLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="calendar-subscription-url"
                type="text"
                readOnly
                value={data.url}
                onFocus={(e) => e.currentTarget.select()}
                className="focus-ring flex-1 min-w-0 px-3 py-2 text-sm font-mono rounded-lg border border-neutral-600 bg-neutral-900 text-neutral-200"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                aria-label={t("settings.calendar.subscription.copy")}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-neutral-500 mt-2">
              {t("settings.calendar.subscription.instructions")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={data.webcal_url}
              className="focus-ring inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-neutral-950 transition-colors hover:bg-primary-500"
            >
              <CalendarPlus className="w-4 h-4" />
              {t("settings.calendar.subscription.openInCalendar")}
            </a>
            {confirmRegenerate ? (
              <div className="flex items-center gap-2 text-sm text-neutral-300">
                <span>
                  {t("settings.calendar.subscription.regenerateConfirm")}
                </span>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={regenerate.isPending}
                  aria-label={t("settings.calendar.subscription.regenerate")}
                  className="p-1.5 text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRegenerate(false)}
                  aria-label={t("common.cancel")}
                  className="p-1.5 text-neutral-400 hover:text-neutral-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setConfirmRegenerate(true)}
              >
                <RefreshCw className="w-4 h-4" />
                {t("settings.calendar.subscription.regenerate")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
