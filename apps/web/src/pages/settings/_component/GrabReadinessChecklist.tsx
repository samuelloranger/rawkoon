import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useGrabReadiness,
  useRecheckGrabReadiness,
} from "@/features/medias/hooks/useGrabReadiness";
import { failingChecks } from "@/features/medias/lib/grabReadiness";
import { useJackettIntegration } from "@/pages/settings/useJackettIntegration";
import { useProwlarrIntegration } from "@/pages/settings/useProwlarrIntegration";
import { useUpdateJackettIntegration } from "@/pages/settings/useUpdateJackettIntegration";
import { useUpdateProwlarrIntegration } from "@/pages/settings/useUpdateProwlarrIntegration";
import { cn } from "@/lib/utils";
import type {
  GrabReadinessCheck,
  GrabReadinessStatus,
} from "@rawkoon/shared/types";

const GRAB_READINESS_ANCHOR = "grab-readiness";

const SELECT_IDS = {
  default_movie_profile:
    "media-post-processing-settings-body-default-movie-quality-profile-id",
  default_show_profile:
    "media-post-processing-settings-body-default-show-quality-profile-id",
} as const;

const ICONS: Record<
  GrabReadinessStatus,
  { Icon: typeof CheckCircle2; className: string }
> = {
  ok: { Icon: CheckCircle2, className: "text-emerald-400" },
  warn: { Icon: AlertTriangle, className: "text-amber-400" },
  error: { Icon: XCircle, className: "text-red-400" },
};

const ACTION_CLASS =
  "focus-ring inline-flex h-8 items-center rounded-md border border-neutral-600 px-3 text-xs font-medium text-neutral-100 transition-colors hover:bg-neutral-700";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function managerLabel(manager: unknown): string {
  return manager === "jackett" ? "Jackett" : "Prowlarr";
}

const CLIENT_LABELS: Record<string, string> = {
  qbittorrent: "qBittorrent",
  transmission: "Transmission",
  deluge: "Deluge",
};

function clientLabel(clientType: unknown): string {
  const key = asString(clientType);
  return CLIENT_LABELS[key] ?? key;
}

export function GrabReadinessChecklist() {
  const { t } = useTranslation("common");
  const { data, isLoading, isError, refetch } = useGrabReadiness();
  const recheck = useRecheckGrabReadiness();
  const prowlarr = useProwlarrIntegration();
  const jackett = useJackettIntegration();
  const updateProwlarr = useUpdateProwlarrIntegration();
  const updateJackett = useUpdateJackettIntegration();

  const checks = data?.checks ?? [];

  // The Library banner links here with a hash; the card only exists once settings load.
  useEffect(() => {
    if (window.location.hash === `#${GRAB_READINESS_ANCHOR}`) {
      document
        .getElementById(GRAB_READINESS_ANCHOR)
        ?.scrollIntoView({ block: "center" });
    }
  }, []);
  const problems = failingChecks(checks).length;

  const watchAll = async (check: GrabReadinessCheck) => {
    const jackettManager = check.params.manager === "jackett";
    const integration = (jackettManager ? jackett : prowlarr).data?.integration;
    if (!integration) return;
    const unwatched = Array.isArray(check.params.unwatched)
      ? check.params.unwatched.filter((v): v is string => typeof v === "string")
      : [];
    const body = {
      website_url: integration.website_url ?? "",
      // The server keeps the stored key when this is blank.
      api_key: "",
      enabled: true,
      rss_indexers: [
        ...new Set([...(integration.rss_indexers ?? []), ...unwatched]),
      ],
    };
    try {
      await (jackettManager
        ? updateJackett.mutateAsync(body)
        : updateProwlarr.mutateAsync(body));
      await refetch();
      toast.success(t("settings.integrations.saveSuccess"));
    } catch {
      toast.error(t("settings.integrations.saveError"));
    }
  };

  const text = (check: GrabReadinessCheck): string => {
    const p = check.params;
    const key = `settings.mediaLibrary.grabReadiness.checks.${check.id}`;
    switch (check.id) {
      case "indexer_manager":
        return check.status === "error"
          ? t(`${key}.${asString(p.reason)}`, {
              manager: managerLabel(p.manager),
            })
          : t(`${key}.${check.status}`, {
              manager: managerLabel(p.manager),
              count: Number(p.indexers ?? 0),
            });
      case "download_client":
        return check.status === "error"
          ? t(`${key}.${asString(p.reason)}`, {
              client: clientLabel(p.client_type),
            })
          : t(`${key}.ok`, { client: clientLabel(p.client_type) });
      case "default_movie_profile":
      case "default_show_profile":
        return t(`${key}.${check.status}`, { name: asString(p.profile_name) });
      case "rss_indexers":
        return t(`${key}.${check.status}`, {
          watched: Number(p.watched ?? 0),
          total: Number(p.total ?? 0),
        });
      case "profiles_without_maximum": {
        const count = Array.isArray(p.profiles) ? p.profiles.length : 0;
        return t(`${key}.${check.status}`, { count });
      }
      case "search_on_add":
        return t(`${key}.${p.enabled ? "on" : "off"}`);
    }
  };

  const action = (check: GrabReadinessCheck) => {
    const prefix = "settings.mediaLibrary.grabReadiness.fix";
    if (check.status === "ok") return null;
    if (check.id === "rss_indexers") {
      const count = Array.isArray(check.params.unwatched)
        ? check.params.unwatched.length
        : 0;
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          disabled={updateProwlarr.isPending || updateJackett.isPending}
          onClick={() => void watchAll(check)}
        >
          {t(`${prefix}.watchAll`, { count })}
        </Button>
      );
    }
    if (
      check.id === "default_movie_profile" ||
      check.id === "default_show_profile"
    ) {
      return (
        <Link
          to="/settings/library"
          hash={SELECT_IDS[check.id as keyof typeof SELECT_IDS]}
          className={ACTION_CLASS}
        >
          {t(`${prefix}.pickDefault`)}
        </Link>
      );
    }
    if (check.id === "indexer_manager" || check.id === "download_client") {
      return (
        <Link to="/settings/connections" className={ACTION_CLASS}>
          {t(`${prefix}.openIntegrations`)}
        </Link>
      );
    }
    return null;
  };

  return (
    <div
      id={GRAB_READINESS_ANCHOR}
      className="mt-4 scroll-mt-24 border-t border-neutral-700/60 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-neutral-300">
            {t("settings.mediaLibrary.grabReadiness.title")}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {isLoading
              ? t("settings.mediaLibrary.grabReadiness.checking")
              : problems === 0
                ? t("settings.mediaLibrary.grabReadiness.allClear")
                : t("settings.mediaLibrary.grabReadiness.summary", {
                    count: problems,
                  })}
          </p>
        </div>
        <button
          type="button"
          className={ACTION_CLASS}
          disabled={recheck.isPending}
          onClick={() => recheck.mutate()}
        >
          {t("settings.mediaLibrary.grabReadiness.recheck")}
        </button>
      </div>

      {isError && (
        <p className="mt-3 text-sm text-red-400">
          {t("settings.mediaLibrary.grabReadiness.loadError")}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {checks.map((check) => {
          const { Icon, className } = ICONS[check.status];
          const profiles =
            check.id === "profiles_without_maximum" &&
            Array.isArray(check.params.profiles)
              ? (check.params.profiles as { id: number; name: string }[])
              : [];
          return (
            <li
              key={check.id}
              data-check={check.id}
              data-status={check.status}
              className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-neutral-700/60 bg-neutral-900/40 px-3 py-2.5"
            >
              <Icon
                className={cn("mt-0.5 h-4 w-4 shrink-0", className)}
                aria-label={t(
                  `settings.mediaLibrary.grabReadiness.status.${check.status}`,
                )}
              />
              <div className="min-w-0 flex-1 basis-40 text-sm text-neutral-200">
                <p>{text(check)}</p>
                {profiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {profiles.map((profile) => (
                      <Link
                        key={profile.id}
                        to="/settings/quality"
                        search={{ edit: profile.id }}
                        className={ACTION_CLASS}
                      >
                        {t(
                          "settings.mediaLibrary.grabReadiness.fix.setMaximum",
                          { name: profile.name },
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              {action(check)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
