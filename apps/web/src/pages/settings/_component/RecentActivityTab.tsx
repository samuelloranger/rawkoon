import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { ListItemSkeleton } from "@/components/Skeleton";
import { useDashboardActivityFeed } from "@/pages/_component/useDashboardStats";
import {
  getActivityPresentation,
  getActivityServiceLabel,
  getActivityTypeLabel,
} from "@/pages/activity/_component/activityPresentation";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";

const PAGE_SIZE = 25;
const ALL_SERVICES_VALUE = "__all_services__";
const ALL_TYPES_VALUE = "__all_types__";

export function RecentActivityTab() {
  const { t, i18n } = useTranslation("common");
  const language = i18n.language;
  const [service, setService] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, isLoading, isFetching } = useDashboardActivityFeed({
    limit,
    service: service || undefined,
    type: type || undefined,
  });

  const activities = useMemo(() => {
    return (data?.activities ?? [])
      .map((activity) => getActivityPresentation(activity, t, language))
      .filter((activity): activity is NonNullable<typeof activity> =>
        Boolean(activity),
      );
  }, [data?.activities, language, t]);

  const hasFilters = Boolean(service || type);

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        icon={History}
        title={t("settings.activity.title")}
        description={t("settings.activity.description")}
      />

      <section className="rounded-2xl border p-4 shadow-sm border-neutral-700/60 bg-neutral-900">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-neutral-300">
              {t("dashboard.activityPage.serviceFilter")}
            </span>
            <Select
              value={service || ALL_SERVICES_VALUE}
              onValueChange={(value) => {
                setLimit(PAGE_SIZE);
                setService(value === ALL_SERVICES_VALUE ? "" : value);
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("dashboard.activityPage.allServices")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SERVICES_VALUE}>
                  {t("dashboard.activityPage.allServices")}
                </SelectItem>
                {(data?.available_services ?? []).map((value) => (
                  <SelectItem key={value} value={value}>
                    {getActivityServiceLabel(t, value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-neutral-300">
              {t("dashboard.activityPage.typeFilter")}
            </span>
            <Select
              value={type || ALL_TYPES_VALUE}
              onValueChange={(value) => {
                setLimit(PAGE_SIZE);
                setType(value === ALL_TYPES_VALUE ? "" : value);
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("dashboard.activityPage.allTypes")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES_VALUE}>
                  {t("dashboard.activityPage.allTypes")}
                </SelectItem>
                {(data?.available_types ?? []).map((value) => (
                  <SelectItem key={value} value={value}>
                    {getActivityTypeLabel(t, value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="mt-3 flex flex-col gap-2 text-sm text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {t("dashboard.activityPage.results", {
              shown: activities.length,
              total: data?.total ?? 0,
            })}
          </p>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLimit(PAGE_SIZE);
                setService("");
                setType("");
              }}
            >
              {t("dashboard.activityPage.clearFilters")}
            </Button>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border shadow-sm border-neutral-700/60 bg-neutral-900">
        {isLoading ? (
          <div className="space-y-3 p-4">
            <ListItemSkeleton />
            <ListItemSkeleton />
            <ListItemSkeleton />
            <ListItemSkeleton />
          </div>
        ) : activities.length > 0 ? (
          <>
            <div className="divide-y divide-neutral-800">
              {activities.map((activity, index) => (
                <article
                  key={`${activity.type}-${activity.time}-${index}`}
                  className="p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-800">
                      <activity.Icon className="w-4 h-4 text-neutral-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-white">
                          {activity.description}
                        </p>
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-blue-950/40 text-blue-300">
                          {activity.serviceLabel}
                        </span>
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-neutral-800 text-neutral-300">
                          {activity.typeLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        {activity.time}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {data?.has_more ? (
              <div className="border-t p-4 border-neutral-800">
                <Button
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                  disabled={isFetching}
                >
                  {isFetching
                    ? t("common.loading")
                    : t("dashboard.activityPage.loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={Clock}
              title={t("dashboard.activityPage.emptyTitle")}
              description={
                hasFilters
                  ? t("dashboard.activityPage.emptyFilteredDescription")
                  : t("dashboard.activityPage.emptyDescription")
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}
