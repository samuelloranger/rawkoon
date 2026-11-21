import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Check, Film, Inbox, Send, Trash2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { MediaRequest, MediaRequestStatus } from "@rawkoon/shared/types";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth/useAuth";
import { RequestSeasonsEditor } from "@/features/add/RequestSeasonsEditor";
import { choiceToBody, type SeasonChoice } from "@/features/add/seasonPlan";
import { useMediaPostProcessingSettings } from "@/features/medias/hooks/useMediaPostProcessingSettings";
import { LoadError } from "@/components/LoadError";
import { useQualityProfilesList } from "@/pages/settings/useQualityProfiles";
import { useBookQualityProfiles } from "@/pages/books/_hooks/useBooks";
import {
  useRequests,
  useApproveRequest,
  useDeleteRequest,
  useDenyRequest,
} from "@/pages/activity/requests/_hooks/useRequests";

type DeleteAction = "withdraw" | "dismiss" | "delete";

/** Pending and denied requests can go: the requester's own, or anyone's for an admin. */
function deleteActionFor(
  request: MediaRequest,
  userId: string | undefined,
  isAdmin: boolean,
): DeleteAction | null {
  if (request.status !== "pending" && request.status !== "denied") return null;
  if (request.requested_by.id === userId) {
    return request.status === "pending" ? "withdraw" : "dismiss";
  }
  return isAdmin ? "delete" : null;
}

const CONFIRM_KEYS = {
  withdraw: "requests.confirmWithdraw",
  dismiss: "requests.confirmDismiss",
  delete: "requests.confirmDelete",
} as const;

/** First click arms the button, the second deletes; it disarms on blur or after a few seconds. */
function DeleteRequestButton({
  request,
  action,
}: {
  request: MediaRequest;
  action: DeleteAction;
}) {
  const { t } = useTranslation("common");
  const remove = useDeleteRequest();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        remove.mutate(request);
      }}
      onBlur={() => setArmed(false)}
      disabled={remove.isPending}
      aria-label={armed ? undefined : t(`requests.${action}`)}
      title={armed ? undefined : t(`requests.${action}`)}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        armed
          ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
          : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
      }`}
    >
      <Trash2 size={14} />
      {armed ? t(CONFIRM_KEYS[action]) : null}
    </button>
  );
}

const STATUS_STYLES: Record<MediaRequestStatus, string> = {
  pending: "bg-amber-500/15 text-amber-400",
  approved: "bg-primary-500/15 text-primary-300",
  denied: "bg-rose-500/15 text-rose-400",
  available: "bg-emerald-500/15 text-emerald-400",
};

function StatusBadge({ status }: { status: MediaRequestStatus }) {
  const { t } = useTranslation("common");
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {t(`requests.status.${status}`)}
    </span>
  );
}

function PosterThumb({
  url,
  alt,
  isBook = false,
}: {
  url: string | null;
  alt: string;
  isBook?: boolean;
}) {
  const Fallback = isBook ? BookOpen : Film;
  const [imgError, setImgError] = useState(false);
  return (
    <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-neutral-950 ring-1 ring-primary-500/20">
      {url && !imgError ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onError={() => setImgError(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Fallback className="h-4 w-4 text-neutral-700" />
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  userId,
  isAdmin,
}: {
  request: MediaRequest;
  userId: string | undefined;
  isAdmin: boolean;
}) {
  const { t } = useTranslation("common");
  const isBook = request.type === "book";
  const deleteAction = deleteActionFor(request, userId, isAdmin);
  // Book requests are approved with a book quality profile (a separate table).
  const canApprove = isAdmin && request.status === "pending";
  const { data: profilesData } = useQualityProfilesList({
    enabled: canApprove && !isBook,
  });
  const { data: bookProfilesData } = useBookQualityProfiles({
    enabled: canApprove && isBook,
  });
  const { data: settingsData } = useMediaPostProcessingSettings({
    enabled: canApprove && !isBook,
  });
  const approve = useApproveRequest();
  const deny = useDenyRequest();
  const [pickedProfile, setPickedProfile] = useState<number | null>(null);
  const [denying, setDenying] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const closeDeny = () => {
    setDenying(false);
    setDenyReason("");
  };
  // Set only when the admin changes the requester's seasons; otherwise the server uses theirs.
  const [seasonOverride, setSeasonOverride] = useState<SeasonChoice | null>(
    null,
  );

  const profiles = isBook
    ? (bookProfilesData?.profiles ?? [])
    : (profilesData?.profiles ?? []);
  // The admin's pick wins; else the request's own profile, then the default for its type.
  // No first-profile fallback: with no default the admin picks, so Approve can't use an arbitrary one.
  const settings = settingsData?.settings;
  const defaultProfile = isBook
    ? null
    : (request.quality_profile_id ??
      (request.type === "show"
        ? settings?.default_show_quality_profile_id
        : settings?.default_movie_quality_profile_id) ??
      null);
  const profileId: number | null =
    pickedProfile ??
    (profiles.some((p) => p.id === defaultProfile) ? defaultProfile : null);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-neutral-900/60 px-3 py-2.5 ring-1 ring-neutral-800">
      <PosterThumb
        url={request.poster_url}
        alt={request.title}
        isBook={isBook}
      />

      <div className="min-w-[10rem] flex-1">
        <p className="truncate font-medium text-neutral-100">
          {isBook && request.library_book_id != null ? (
            <Link
              to="/books/$bookId"
              params={{ bookId: String(request.library_book_id) }}
              aria-label={t("requests.viewBook")}
              className="hover:text-primary-300 hover:underline"
            >
              {request.title}
            </Link>
          ) : (
            request.title
          )}
          {request.year ? (
            <span className="ml-1.5 text-sm font-normal text-neutral-500">
              {request.year}
            </span>
          ) : null}
        </p>
        {isBook && (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-neutral-400">
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-300">
              {t("requests.book")}
            </span>
            {request.author}
          </p>
        )}
        {isAdmin && request.requested_by.name ? (
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {t("requests.requestedBy", { name: request.requested_by.name })}
          </p>
        ) : null}
        {request.status === "denied" && request.deny_reason ? (
          <p className="mt-0.5 text-xs text-rose-300/80">
            {t("requests.denyReason", { reason: request.deny_reason })}
          </p>
        ) : null}
        {request.type === "show" && (
          <RequestSeasonsEditor
            request={request}
            override={seasonOverride}
            onChange={setSeasonOverride}
            editable={canApprove}
          />
        )}
      </div>

      {canApprove ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            value={profileId ?? ""}
            onChange={(e) =>
              setPickedProfile(e.target.value ? Number(e.target.value) : null)
            }
            aria-label={t("requests.qualityPlaceholder")}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
          >
            <option value="" disabled>
              {t("requests.qualityPlaceholder")}
            </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() =>
              profileId !== null &&
              approve.mutate({
                id: request.id,
                quality_profile_id: profileId,
                ...(seasonOverride ? choiceToBody(seasonOverride) : {}),
              })
            }
            disabled={profileId === null || approve.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition-[background-color] hover:bg-primary-500 active:bg-primary-700 disabled:opacity-50"
          >
            <Check size={12} />
            {t("requests.approve")}
          </button>

          <button
            type="button"
            onClick={() => (denying ? closeDeny() : setDenying(true))}
            aria-expanded={denying}
            disabled={deny.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-50"
          >
            <X size={12} />
            {t("requests.deny")}
          </button>

          {denying ? (
            <form
              className="flex w-full items-center gap-2"
              onKeyDown={(e) => {
                if (e.key === "Escape") closeDeny();
              }}
              onSubmit={(e) => {
                e.preventDefault();
                const reason = denyReason.trim();
                deny.mutate({
                  id: request.id,
                  ...(reason ? { deny_reason: reason } : {}),
                });
              }}
            >
              <input
                type="text"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                maxLength={500}
                autoFocus
                aria-label={t("requests.denyReasonLabel")}
                placeholder={t("requests.denyReasonPlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 focus:border-primary-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={deny.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
              >
                {t("requests.denyConfirm")}
              </button>
            </form>
          ) : null}
        </div>
      ) : (
        <StatusBadge status={request.status} />
      )}

      {deleteAction ? (
        <DeleteRequestButton request={request} action={deleteAction} />
      ) : null}
    </div>
  );
}

export function RequestsPage() {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useRequests();

  const isAdmin = user?.is_admin ?? false;
  const requests = data?.requests ?? [];

  return (
    <PageLayout className="max-w-4xl">
      <PageHeader
        headingLevel="h2"
        icon={Inbox}
        iconColor="text-primary-400"
        title={t("requests.title")}
        subtitle={t("requests.subtitle")}
      />

      {isLoading ? (
        <div className="py-8 text-center text-neutral-400">
          {t("common.loading")}
        </div>
      ) : isError && !data ? (
        <LoadError onRetry={() => void refetch()} retrying={isRefetching} />
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-neutral-900/40 py-16 text-center ring-1 ring-neutral-800">
          <Send className="h-7 w-7 text-neutral-500" />
          <p className="text-sm text-neutral-400">{t("requests.empty")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {requests.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              userId={user?.id}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
