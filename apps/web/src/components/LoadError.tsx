import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { HttpError } from "@/lib/api/httpClient";
import { EmptyState } from "@/components/EmptyState";

/** True when the failure is the server saying the resource doesn't exist. */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

/** A failed load, distinct from an empty result; Retry refetches. */
export function LoadError({
  onRetry,
  retrying = false,
}: {
  onRetry: () => void;
  retrying?: boolean;
}) {
  const { t } = useTranslation("common");
  return (
    <EmptyState
      icon={TriangleAlert}
      title={t("common.failedToLoad")}
      description={t("common.loadErrorDescription")}
      action={
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="focus-ring rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-primary-500 disabled:opacity-50"
        >
          {t("common.retry")}
        </button>
      }
    />
  );
}
