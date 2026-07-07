export type LibraryMigrateJobData = {
  source: "radarr" | "sonarr" | "both";
  requested_by: number;
  radarr_url?: string;
  radarr_api_key?: string;
  sonarr_url?: string;
  sonarr_api_key?: string;
};

export type LibraryMigrateProgress = {
  phase: "radarr" | "sonarr" | "done";
  current: number;
  total: number;
  current_title: string | null;
  radarr: {
    imported: number;
    already_existed: number;
    skipped: number;
    files_scanned: number;
    errors: number;
  };
  sonarr: {
    imported_shows: number;
    imported_episodes: number;
    imported_files: number;
    files_scanned: number;
    errors: number;
  };
};

export type LibraryMigrateResult = {
  radarr?: {
    imported: number;
    already_existed: number;
    skipped: number;
    files_scanned: number;
    errors: string[];
  };
  sonarr?: {
    imported_shows: number;
    imported_episodes: number;
    imported_files: number;
    files_scanned: number;
    errors: string[];
  };
};

export type RadarrMovie = {
  id: number;
  title: string;
  year: number;
  tmdbId: number;
  hasFile: boolean;
  overview?: string;
  added?: string;
  images: Array<{ remoteUrl: string; coverType: string }>;
  movieFile?: {
    id: number;
    path: string;
    size: number;
    releaseGroup?: string;
    edition?: string;
    languages?: Array<{ id: number; name: string }>;
    customFormats?: Array<{ name: string }>;
    mediaInfo?: {
      videoCodec?: string;
      width?: number;
      height?: number;
      videoBitDepth?: number;
      videoDynamicRangeType?: string;
      audioLanguages?: string;
      audioCodec?: string;
      audioChannels?: number;
      subtitles?: string;
      runTime?: string;
    };
  };
};

export type SonarrSeries = {
  id: number;
  title: string;
  year: number;
  tvdbId: number;
  overview?: string;
  added?: string;
  images: Array<{ remoteUrl: string; coverType: string }>;
  seasons: Array<{
    seasonNumber: number;
    statistics?: { episodeFileCount: number };
  }>;
};

export type SonarrEp = {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  airDate?: string;
  hasFile: boolean;
  episodeFileId?: number | null;
};

export type SonarrFile = {
  id: number;
  seasonNumber: number;
  path: string;
  size: number;
  releaseGroup?: string;
  languages?: Array<{ id: number; name: string }>;
  customFormats?: Array<{ name: string }>;
  mediaInfo?: {
    videoCodec?: string;
    width?: number;
    height?: number;
    videoBitDepth?: number;
    videoDynamicRangeType?: string;
    audioLanguages?: string;
    audioCodec?: string;
    audioChannels?: number;
    subtitles?: string;
    runTime?: string;
  };
};

export type TmdbConfig = { api_key: string } | null;

export type LibraryMigrateContext = {
  tmdbConfig: TmdbConfig;
  defaultQualityProfileId: number | null;
  region: string;
  progress: LibraryMigrateProgress;
  result: LibraryMigrateResult;
  push: () => Promise<void>;
};
