import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TmdbMediaDetailsResponse } from "@rawkoon/shared/types";
import { ExternalLink, UserCircle } from "lucide-react";
import { Eyebrow } from "./LibrarySharedUI";

interface MediaDetailInfoSectionsProps {
  details: TmdbMediaDetailsResponse;
  displayTitle: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatYmd(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return iso;
  }
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function FactLine({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="min-w-0 text-neutral-200">{value}</span>
    </div>
  );
}

function OutLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium hover:underline text-primary-300"
    >
      {label}
      <ExternalLink size={12} className="shrink-0 opacity-70" />
    </a>
  );
}

export function MediaDetailInfoSections({
  details,
  displayTitle,
  mediaType,
  tmdbId,
}: MediaDetailInfoSectionsProps) {
  const { t } = useTranslation("common");

  const countries = details.production_countries ?? [];
  const companies = details.production_companies ?? [];
  const spoken = details.spoken_languages ?? [];
  const nets = details.networks ?? [];
  const creators = details.created_by ?? [];
  const runtimes = details.episode_run_times ?? [];

  const tmdbPageUrl = `https://www.themoviedb.org/${mediaType}/${tmdbId}`;
  const ext = details.external_ids;

  const imdbUrl = ext?.imdb_id
    ? `https://www.imdb.com/title/${ext.imdb_id}/`
    : null;
  const fbUrl = ext?.facebook_id
    ? `https://www.facebook.com/${ext.facebook_id}`
    : null;
  const igUrl = ext?.instagram_id
    ? `https://www.instagram.com/${ext.instagram_id}`
    : null;
  const twUrl = ext?.twitter_id
    ? `https://twitter.com/${ext.twitter_id}`
    : null;
  const wikiUrl = ext?.wikidata_id
    ? `https://www.wikidata.org/wiki/${ext.wikidata_id}`
    : null;

  const showOriginalTitle =
    details.original_title &&
    details.original_title.trim() &&
    details.original_title.trim() !== displayTitle.trim();

  const hasFacts =
    showOriginalTitle ||
    details.original_language_label ||
    countries.length > 0 ||
    companies.length > 0 ||
    spoken.length > 0 ||
    (mediaType === "tv" && details.tv_type);

  const hasMoney =
    mediaType === "movie" &&
    (details.budget != null || details.revenue != null);

  const hasTv =
    mediaType === "tv" &&
    (nets.length > 0 ||
      creators.length > 0 ||
      runtimes.length > 0 ||
      details.next_episode_to_air ||
      details.last_episode_to_air);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-x-8 items-start">
      {hasFacts && (
        <Section title={t("medias.detail.sections.facts")}>
          {showOriginalTitle && (
            <FactLine
              label={t("medias.detail.originalTitle")}
              value={details.original_title}
            />
          )}
          {details.original_language_label && (
            <FactLine
              label={t("medias.detail.originalLanguage")}
              value={`${details.original_language_label}${details.original_language ? ` (${details.original_language})` : ""}`}
            />
          )}
          {countries.length > 0 && (
            <FactLine
              label={t("medias.detail.countries")}
              value={countries.map((c) => c.name).join(", ")}
            />
          )}
          {spoken.length > 0 && (
            <FactLine
              label={t("medias.detail.spokenLanguages")}
              value={spoken.map((s) => s.english_name || s.name).join(", ")}
            />
          )}
          {mediaType === "tv" && details.tv_type && (
            <FactLine
              label={t("medias.detail.showType")}
              value={details.tv_type}
            />
          )}
          {companies.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-neutral-500">
                {t("medias.detail.companies")}
              </p>
              <div className="flex flex-wrap gap-2">
                {companies.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs border-border bg-surface-inset text-neutral-200"
                  >
                    {c.logo_url ? (
                      <img
                        src={c.logo_url}
                        alt=""
                        className="h-5 w-5 shrink-0 object-contain"
                      />
                    ) : null}
                    <span className="truncate">{c.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {hasMoney && (
        <Section title={t("medias.detail.sections.money")}>
          {details.budget != null && details.budget > 0 && (
            <FactLine
              label={t("medias.detail.budget")}
              value={formatUsd(details.budget)}
            />
          )}
          {details.revenue != null && details.revenue > 0 && (
            <FactLine
              label={t("medias.detail.revenue")}
              value={formatUsd(details.revenue)}
            />
          )}
        </Section>
      )}

      <Section title={t("medias.detail.sections.links")}>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <OutLink href={tmdbPageUrl} label="TMDB" />
          {details.homepage ? (
            <OutLink
              href={details.homepage}
              label={t("medias.detail.officialSite")}
            />
          ) : null}
          {imdbUrl ? <OutLink href={imdbUrl} label="IMDb" /> : null}
          {fbUrl ? <OutLink href={fbUrl} label="Facebook" /> : null}
          {igUrl ? <OutLink href={igUrl} label="Instagram" /> : null}
          {twUrl ? <OutLink href={twUrl} label="X / Twitter" /> : null}
          {wikiUrl ? <OutLink href={wikiUrl} label="Wikidata" /> : null}
        </div>
      </Section>

      {hasTv && (
        <Section title={t("medias.detail.sections.tv")}>
          {nets.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-neutral-500">
                {t("medias.detail.networks")}
              </p>
              <div className="flex flex-wrap gap-2">
                {nets.map((n) => (
                  <span
                    key={n.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs border-border bg-surface-inset"
                  >
                    {n.logo_url ? (
                      <img
                        src={n.logo_url}
                        alt=""
                        className="h-4 w-8 object-contain"
                      />
                    ) : null}
                    {n.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {creators.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-neutral-500">
                {t("medias.detail.createdBy")}
              </p>
              <div className="flex flex-wrap gap-3">
                {creators.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    {c.profile_url ? (
                      <img
                        src={c.profile_url}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-700">
                        <UserCircle className="w-5 h-5 text-neutral-500" />
                      </div>
                    )}
                    <span className="font-medium text-neutral-200">
                      {c.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {runtimes.length > 0 && (
            <FactLine
              label={t("medias.detail.episodeRuntimes")}
              value={runtimes.map((m) => `${m} min`).join(", ")}
            />
          )}
          {details.next_episode_to_air && (
            <div className="rounded-lg border border-primary-500/20 px-3 py-2 text-sm bg-primary-500/10">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary-300">
                {t("medias.detail.nextEpisode")}
              </p>
              <p className="font-medium text-neutral-100">
                {details.next_episode_to_air.name ?? "—"}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {[
                  details.next_episode_to_air.season_number != null &&
                  details.next_episode_to_air.episode_number != null
                    ? `S${details.next_episode_to_air.season_number}E${details.next_episode_to_air.episode_number}`
                    : null,
                  formatYmd(details.next_episode_to_air.air_date),
                  details.next_episode_to_air.runtime != null
                    ? `${details.next_episode_to_air.runtime} min`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          )}
          {details.last_episode_to_air && (
            <div className="rounded-lg border px-3 py-2 text-sm border-border bg-surface-inset">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                {t("medias.detail.lastEpisode")}
              </p>
              <p className="font-medium text-neutral-100">
                {details.last_episode_to_air.name ?? "—"}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {[
                  details.last_episode_to_air.season_number != null &&
                  details.last_episode_to_air.episode_number != null
                    ? `S${details.last_episode_to_air.season_number}E${details.last_episode_to_air.episode_number}`
                    : null,
                  formatYmd(details.last_episode_to_air.air_date),
                  details.last_episode_to_air.runtime != null
                    ? `${details.last_episode_to_air.runtime} min`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
