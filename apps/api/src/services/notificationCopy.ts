import type { NotificationPreferenceKey } from "@rawkoon/shared/types/notificationPreferences";

type Locale = "en" | "fr";

type CopyParams = Record<string, string | number>;

type Template = Record<Locale, (p: CopyParams) => string>;

function localeOf(raw: string | null | undefined): Locale {
  return raw?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

function t(
  locale: string | null | undefined,
  templates: Template,
  params: CopyParams,
): string {
  return templates[localeOf(locale)](params);
}

/** Trim long release names for notification bodies. */
export function truncateReleaseTitle(title: string, max = 80): string {
  const trimmed = title.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function formatSeasonEpisode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function formatSeason(season: number): string {
  return `S${String(season).padStart(2, "0")}`;
}

export function showLabel(title: string, year: number | null): string {
  return year ? `${title} (${year})` : title;
}

export function episodeDisplayName(
  title: string | null | undefined,
): string | null {
  if (!title?.trim()) return null;
  if (/^episode\s+\d+$/i.test(title.trim())) return null;
  return title.trim();
}

const COPY = {
  libraryEpisodeDownloadedTitle: {
    en: (p) => `${p.code} downloaded`,
    fr: (p) => `${p.code} téléchargé`,
  },
  libraryEpisodeUpgradedTitle: {
    en: (p) => `${p.code} upgraded`,
    fr: (p) => `${p.code} mis à niveau`,
  },
  libraryEpisodeDownloadedBody: {
    en: (p) =>
      p.episodeName
        ? `${p.show} — ${p.code} "${p.episodeName}" is now in your library.`
        : `${p.show} — ${p.code} is now in your library.`,
    fr: (p) =>
      p.episodeName
        ? `${p.show} — ${p.code} « ${p.episodeName} » est dans votre bibliothèque.`
        : `${p.show} — ${p.code} est dans votre bibliothèque.`,
  },
  librarySeasonDownloadedTitle: {
    en: (p) => `${p.season} downloaded`,
    fr: (p) => `${p.season} téléchargée`,
  },
  librarySeasonDownloadedBody: {
    en: (p) =>
      `${p.show} — ${p.season} (${p.count} episodes) is now in your library.`,
    fr: (p) =>
      `${p.show} — ${p.season} (${p.count} épisodes) est dans votre bibliothèque.`,
  },
  librarySeriesDownloadedTitle: {
    en: () => "Full series downloaded",
    fr: () => "Série complète téléchargée",
  },
  librarySeriesDownloadedBody: {
    en: (p) => `${p.show} — ${p.count} episodes are now in your library.`,
    fr: (p) => `${p.show} — ${p.count} épisodes sont dans votre bibliothèque.`,
  },
  libraryShowDownloadedTitle: {
    en: () => "Show downloaded",
    fr: () => "Série téléchargée",
  },
  libraryMovieDownloadedTitle: {
    en: () => "Movie downloaded",
    fr: () => "Film téléchargé",
  },
  libraryMediaDownloadedBody: {
    en: (p) => `${p.show} is now in your library.`,
    fr: (p) => `${p.show} est dans votre bibliothèque.`,
  },
  libraryEpisodeGrabbedTitle: {
    en: (p) => `${p.code} grabbed`,
    fr: (p) => `${p.code} saisi`,
  },
  librarySeasonGrabbedTitle: {
    en: (p) => `${p.season} pack grabbed`,
    fr: (p) => `Pack ${p.season} saisi`,
  },
  libraryMovieGrabbedTitle: {
    en: () => "Movie grabbed",
    fr: () => "Film saisi",
  },
  libraryGrabbedBody: {
    en: (p) => `${p.show} — ${p.release}`,
    fr: (p) => `${p.show} — ${p.release}`,
  },
  libraryDownloadFailedTitle: {
    en: (p) => (p.code ? `${p.code} download failed` : "Download failed"),
    fr: (p) =>
      p.code ? `Échec du téléchargement ${p.code}` : "Échec du téléchargement",
  },
  libraryDownloadFailedBody: {
    en: (p) => `${p.show}: ${p.reason}`,
    fr: (p) => `${p.show} : ${p.reason}`,
  },
  libraryPostProcessFailedTitle: {
    en: () => "Import failed",
    fr: () => "Échec de l'import",
  },
  libraryPostProcessFailedBody: {
    en: (p) => `${p.show}: ${p.reason}`,
    fr: (p) => `${p.show} : ${p.reason}`,
  },
  libraryGrabSkippedEpisodeTitle: {
    en: (p) => `${p.code} search gave up`,
    fr: (p) => `Recherche abandonnée ${p.code}`,
  },
  libraryGrabSkippedSeasonTitle: {
    en: (p) => `${p.season} search gave up`,
    fr: (p) => `Recherche abandonnée ${p.season}`,
  },
  libraryGrabSkippedMovieTitle: {
    en: () => "Movie search gave up",
    fr: () => "Recherche de film abandonnée",
  },
  libraryGrabSkippedBody: {
    en: (p) => `${p.show}: ${p.reason}`,
    fr: (p) => `${p.show} : ${p.reason}`,
  },
  libraryAttentionTitle: {
    en: () => "Library issue",
    fr: () => "Problème bibliothèque",
  },
  libraryAttentionBody: {
    en: (p) => String(p.detail),
    fr: (p) => String(p.detail),
  },
  requestPendingTitle: {
    en: (p) => `${p.kind} requested`,
    fr: (p) => `${p.kind} demandé`,
  },
  requestPendingBody: {
    en: (p) => `${p.title} was requested and needs approval.`,
    fr: (p) => `${p.title} a été demandé et nécessite une approbation.`,
  },
  requestApprovedTitle: {
    en: () => "Request approved",
    fr: () => "Demande approuvée",
  },
  requestDeniedTitle: {
    en: () => "Request denied",
    fr: () => "Demande refusée",
  },
  requestDecidedBodyApproved: {
    en: (p) => `Your request for ${p.title} was approved.`,
    fr: (p) => `Votre demande pour ${p.title} a été approuvée.`,
  },
  requestDecidedBodyDenied: {
    en: (p) => `Your request for ${p.title} was denied: ${p.reason}`,
    fr: (p) => `Votre demande pour ${p.title} a été refusée : ${p.reason}`,
  },
  requestDecidedBodyDeniedNoReason: {
    en: (p) => `Your request for ${p.title} was denied.`,
    fr: (p) => `Votre demande pour ${p.title} a été refusée.`,
  },
  requestAvailableTitle: {
    en: () => "Request available",
    fr: () => "Demande disponible",
  },
  requestAvailableBody: {
    en: (p) => `${p.title} finished downloading and is ready to watch.`,
    fr: (p) => `${p.title} a fini de se télécharger et est prêt à regarder.`,
  },
  bookGrabbedTitle: {
    en: (p) => `${p.kind} grabbed`,
    fr: (p) => `${p.kind} saisi`,
  },
  bookDownloadedTitle: {
    en: (p) => `${p.kind} downloaded`,
    fr: (p) => `${p.kind} téléchargé`,
  },
  bookImportFailedTitle: {
    en: (p) => `${p.kind} import failed`,
    fr: (p) => `Échec import ${p.kind}`,
  },
  bookSearchSkippedTitle: {
    en: (p) => `${p.kind} search gave up`,
    fr: (p) => `Recherche ${p.kind} abandonnée`,
  },
  bookEventBody: {
    en: (p) => String(p.body),
    fr: (p) => String(p.body),
  },
  authorNewReleasesTitle: {
    en: (p) => `New from ${p.author}`,
    fr: (p) => `Nouveautés de ${p.author}`,
  },
  authorNewReleasesBody: {
    en: (p) => `Added ${p.count} title(s): ${p.titles}${p.more}`,
    fr: (p) => `${p.count} titre(s) ajouté(s) : ${p.titles}${p.more}`,
  },
  movie_release_reminder_title: {
    en: (p) => `Out tomorrow: ${p.title}`,
    fr: (p) => `Sort demain : ${p.title}`,
  },
  movie_release_reminder_body: {
    en: (p) => `${p.title} releases tomorrow (TMDB date).`,
    fr: (p) => `${p.title} sort au cinéma demain (date TMDB).`,
  },
  appUpdateTitle: {
    en: () => "App updated",
    fr: () => "Application mise à jour",
  },
  appUpdateBody: {
    en: (p) => `Rawkoon has been updated to version ${p.version}.`,
    fr: (p) => `Rawkoon a été mis à jour vers la version ${p.version}.`,
  },
  githubReleaseTitleSingle: {
    en: (p) => `New Rawkoon release: ${p.tag}`,
    fr: (p) => `Nouvelle version Rawkoon : ${p.tag}`,
  },
  githubReleaseTitleMany: {
    en: (p) => `${p.count} new Rawkoon releases`,
    fr: (p) => `${p.count} nouvelles versions Rawkoon`,
  },
  githubReleaseBodySingle: {
    en: (p) => String(p.name),
    fr: (p) => String(p.name),
  },
  githubReleaseBodyMany: {
    en: (p) => String(p.tags),
    fr: (p) => String(p.tags),
  },
  groupedLibraryDownloadedTitle: {
    en: (p) => `${p.count} episodes downloaded`,
    fr: (p) => `${p.count} épisodes téléchargés`,
  },
  groupedLibraryDownloadedBody: {
    en: (p) => `${p.show} — latest: ${p.code}`,
    fr: (p) => `${p.show} — dernier : ${p.code}`,
  },
  mediaKindMovie: {
    en: () => "Movie",
    fr: () => "Film",
  },
  mediaKindShow: {
    en: () => "TV show",
    fr: () => "Série",
  },
  mediaKindBook: {
    en: () => "Book",
    fr: () => "Livre",
  },
  bookKindEbook: {
    en: () => "Ebook",
    fr: () => "Livre numérique",
  },
  bookKindAudiobook: {
    en: () => "Audiobook",
    fr: () => "Livre audio",
  },
} as const satisfies Record<string, Template>;

type CopyKey = keyof typeof COPY;

export function notificationCopy(
  locale: string | null | undefined,
  key: CopyKey,
  params: CopyParams = {},
): string {
  return t(locale, COPY[key], params);
}

export function preferenceKeyForNotificationType(
  type: string,
): NotificationPreferenceKey | null {
  const map: Record<string, NotificationPreferenceKey> = {
    library_media_downloaded: "library_downloaded",
    library_media_grabbed: "library_grabbed",
    library_download_failed: "library_failed",
    library_post_process_failed: "library_failed",
    library_grab_skipped: "library_grab_skipped",
    library_attention: "library_attention",
    book_downloaded: "book_downloaded",
    book_grabbed: "book_grabbed",
    book_import_failed: "book_failed",
    book_search_skipped: "book_search_skipped",
    author_new_release: "book_author_releases",
    request_pending: "request_pending",
    request_decided: "request_decided",
    request_available: "request_available",
    movie_release_reminder: "movie_release_reminder",
    "app-update": "app_update",
    "github-release": "github_release",
  };
  return map[type] ?? null;
}
