import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Film, Inbox, Send, X } from "lucide-react";
import type { MediaRequest, MediaRequestStatus } from "@rawkoon/shared/types";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth/useAuth";
import { useQualityProfilesList } from "@/pages/settings/useQualityProfiles";
import {
  useRequests,
  useApproveRequest,
  useDenyRequest,
} from "@/pages/requests/_hooks/useRequests";

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

function PosterThumb({ url, alt }: { url: string | null; alt: string }) {
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
          <Film className="h-4 w-4 text-neutral-700" />
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  isAdmin,
}: {
  request: MediaRequest;
  isAdmin: boolean;
}) {
  const { t } = useTranslation("common");
  const { data: profilesData } = useQualityProfilesList();
  const approve = useApproveRequest();
  const deny = useDenyRequest();
  const [profileId, setProfileId] = useState<number | "">("");

  const profiles = profilesData?.profiles ?? [];
  const canApprove = isAdmin && request.status === "pending";

  return (
    <div className="flex items-center gap-3 rounded-xl bg-neutral-900/60 px-3 py-2.5 ring-1 ring-neutral-800">
      <PosterThumb url={request.poster_url} alt={request.title} />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-neutral-100">
          {request.title}
          {request.year ? (
            <span className="ml-1.5 text-sm font-normal text-neutral-500">
              {request.year}
            </span>
          ) : null}
        </p>
        {isAdmin && request.requested_by.name ? (
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {t("requests.requestedBy", { name: request.requested_by.name })}
          </p>
        ) : null}
      </div>

      {canApprove ? (
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={profileId}
            onChange={(e) =>
              setProfileId(e.target.value ? Number(e.target.value) : "")
            }
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
              profileId !== "" &&
              approve.mutate({ id: request.id, quality_profile_id: profileId })
            }
            disabled={profileId === "" || approve.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition-[background-color] hover:bg-primary-500 active:bg-primary-700 disabled:opacity-50"
          >
            <Check size={12} />
            {t("requests.approve")}
          </button>

          <button
            type="button"
            onClick={() => deny.mutate({ id: request.id })}
            disabled={deny.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-50"
          >
            <X size={12} />
            {t("requests.deny")}
          </button>
        </div>
      ) : (
        <StatusBadge status={request.status} />
      )}
    </div>
  );
}

export function RequestsPage() {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const { data, isLoading } = useRequests();

  const isAdmin = user?.is_admin ?? false;
  const requests = data?.requests ?? [];

  return (
    <PageLayout className="max-w-4xl">
      <PageHeader
        icon={Inbox}
        iconColor="text-primary-400"
        title={t("requests.title")}
        subtitle={t("requests.subtitle")}
      />

      {isLoading ? (
        <div className="py-8 text-center text-neutral-400">
          {t("common.loading")}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-neutral-900/40 py-16 text-center ring-1 ring-neutral-800">
          <Send className="h-7 w-7 text-neutral-600" />
          <p className="text-sm text-neutral-400">{t("requests.empty")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {requests.map((r) => (
            <RequestRow key={r.id} request={r} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}
