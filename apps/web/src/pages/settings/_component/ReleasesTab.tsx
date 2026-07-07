import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import {
  AlertCircle,
  Calendar,
  ExternalLink,
  GitBranch,
  Loader2,
  Package,
  RefreshCw,
  Tag,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";
import { Loader } from "@/components/Loader";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import {
  useGitHubReleases,
  useRefreshGitHubReleases,
} from "@/pages/settings/useReleases";
import type { GitHubRelease } from "@rawkoon/shared/types";

function formatDate(value: string | null): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ReleaseRow({ release }: { release: GitHubRelease }) {
  const body = useMemo(() => release.body?.trim() ?? "", [release.body]);

  return (
    <article className="min-w-0 rounded-xl border p-5 border-neutral-700 bg-neutral-800">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-base font-semibold text-neutral-50">
              {release.name || release.tag_name}
            </h3>
            {release.prerelease && (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-900/30 text-amber-300">
                Pre-release
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-400">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 break-all">{release.tag_name}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 break-words">
                {formatDate(release.published_at)}
              </span>
            </span>
            {release.author && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="min-w-0 break-all">
                  {release.author.login}
                </span>
              </span>
            )}
          </div>
        </div>
        <a
          href={release.html_url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "inline-flex h-9 items-center justify-center gap-2 self-start whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors border-neutral-600 bg-neutral-800 hover:bg-neutral-700 hover:text-neutral-50",
          )}
        >
          <ExternalLink className="h-4 w-4 flex-shrink-0" />
          <span>GitHub</span>
        </a>
      </div>

      {body && (
        <div className="prose prose-sm mt-4 max-w-none break-words prose-invert text-neutral-300 prose-a:break-all prose-a:underline prose-a:text-blue-400 prose-code:break-all prose-pre:whitespace-pre-wrap prose-pre:break-words">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{body}</ReactMarkdown>
        </div>
      )}

      {release.assets.length > 0 && (
        <div className="mt-4 flex min-w-0 flex-wrap gap-2">
          {release.assets.map((asset) => (
            <a
              key={asset.id}
              href={asset.browser_download_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium border-neutral-800 text-neutral-300 hover:bg-neutral-800"
            >
              <Package className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 break-all">{asset.name}</span>
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

export function ReleasesTab() {
  const { t } = useTranslation("common");
  const { data, isLoading, isError, error } = useGitHubReleases();
  const refresh = useRefreshGitHubReleases();

  const handleRefresh = () => {
    refresh.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(
          result.new_release_count > 0
            ? t("settings.releases.refreshFound", {
                count: result.new_release_count,
              })
            : t("settings.releases.refreshComplete"),
        );
      },
      onError: () => toast.error(t("settings.releases.refreshError")),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader size="md" />
      </div>
    );
  }

  const releases = data?.releases ?? [];

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={Rocket}
        title={t("settings.releases.title")}
        description={t("settings.releases.description")}
        actions={
          <Button
            onClick={handleRefresh}
            disabled={refresh.isPending}
            variant="outline"
            className="self-start"
          >
            {refresh.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("common.refetch")}
          </Button>
        }
      />

      <div className="min-w-0 rounded-xl border p-4 text-sm border-neutral-700 bg-neutral-800">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-neutral-400">
              {t("settings.releases.repo")}
            </p>
            <p className="mt-1 break-all font-medium text-neutral-100">
              {data?.sync.repo_full_name ?? "—"}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-neutral-400">
              {t("settings.releases.lastSynced")}
            </p>
            <p className="mt-1 break-words font-medium text-neutral-100">
              {formatDate(data?.sync.last_synced_at ?? null)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-neutral-400">
              {t("settings.releases.cached")}
            </p>
            <p className="mt-1 font-medium text-neutral-100">
              {releases.length}
            </p>
          </div>
        </div>
        {(isError || data?.sync.last_error) && (
          <div className="mt-4 flex gap-2 rounded-md p-3 text-sm bg-red-950/30 text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 break-words">
              {data?.sync.last_error ||
                (error instanceof Error
                  ? error.message
                  : t("settings.releases.loadError"))}
            </span>
          </div>
        )}
      </div>

      {releases.length === 0 ? (
        <EmptyState
          icon={Package}
          title={t("settings.releases.emptyTitle")}
          description={t("settings.releases.emptyDescription")}
        />
      ) : (
        <div className="space-y-4">
          {releases.map((release) => (
            <ReleaseRow key={release.id} release={release} />
          ))}
        </div>
      )}
    </div>
  );
}
