import { beforeEach, mock, afterAll } from "bun:test";

export type Req = {
  id: number;
  tmdbId?: number | null;
  type: string;
  status: string;
  requestedById: string;
  libraryMediaId: number | null;
  title?: string;
  googleVolumeId?: string | null;
  bookQualityProfileId?: number | null;
  libraryBookId?: number | null;
};

export type EpisodeRow = {
  season: number;
  airDate: Date | null;
  monitored: boolean;
  status: string;
};

type EpisodeWhere = {
  mediaId: number;
  season?: { gt: number };
  monitored?: boolean;
  airDate?: { lte: Date };
  status?: { notIn: string[] };
};

/** Evaluates the subset of the episode filter that showAvailability uses. */
function countEpisodes(where: EpisodeWhere): number {
  return (state.episodesByMediaId[where.mediaId] ?? []).filter(
    (e) =>
      (where.season == null || e.season > where.season.gt) &&
      (where.monitored == null || e.monitored === where.monitored) &&
      (where.airDate == null ||
        (e.airDate != null && e.airDate <= where.airDate.lte)) &&
      (where.status == null || !where.status.notIn.includes(e.status)),
  ).length;
}

export const state: {
  library: Array<{ tmdbId: number; type: "movie" | "show" }>;
  libraryBooks: Array<{ googleVolumeId: string }>;
  requests: Req[];
  created: unknown[];
  notifications: Array<{ userId: string; type: string }>;
  admins: Array<{
    id: string;
    locale?: string | null;
    notificationPreferences?: null;
  }>;
  profiles: number[];
  bookProfiles: number[];
  mediaStatusById: Record<number, string>;
  mediaTmdbStatusById: Record<number, string>;
  episodesByMediaId: Record<number, EpisodeRow[]>;
  addedBooks: Array<{ volumeId: string; bookQualityProfileId?: number }>;
  bookEditionStatusByBookId: Record<number, string>;
  defaultProfiles: { movie: number | null; show: number | null };
  failLibraryAdd: boolean;
  searchQueued: number[];
  beforeDeleteMany: (() => void) | null;
  deletedLibrary: string[];
} = {
  library: [],
  libraryBooks: [],
  requests: [],
  created: [],
  notifications: [],
  admins: [],
  profiles: [],
  bookProfiles: [],
  mediaStatusById: {},
  mediaTmdbStatusById: {},
  episodesByMediaId: {},
  addedBooks: [],
  bookEditionStatusByBookId: {},
  defaultProfiles: { movie: null, show: null },
  failLibraryAdd: false,
  searchQueued: [],
  beforeDeleteMany: null,
  deletedLibrary: [],
};

function installMediaRequestDbMock() {
  mock.module("@rawkoon/api/db", () => ({
    prisma: {
      libraryMedia: {
        findUnique: ({
          where,
        }: {
          where: {
            tmdbId_type?: { tmdbId: number; type: string };
            id?: number;
          };
        }) => {
          if (where.id != null)
            return Promise.resolve(
              state.mediaStatusById[where.id] != null
                ? {
                    id: where.id,
                    status: state.mediaStatusById[where.id],
                    type:
                      state.mediaTmdbStatusById[where.id] != null ||
                      state.episodesByMediaId[where.id] != null
                        ? "show"
                        : "movie",
                    tmdbStatus: state.mediaTmdbStatusById[where.id] ?? null,
                  }
                : null,
            );
          return Promise.resolve(
            state.library.find(
              (m) =>
                m.tmdbId === where.tmdbId_type?.tmdbId &&
                m.type === where.tmdbId_type?.type,
            ) ?? null,
          );
        },
        update: () => Promise.resolve({}),
        delete: ({ where }: { where: { id: number } }) => {
          state.deletedLibrary.push(`media:${where.id}`);
          return Promise.resolve({});
        },
      },
      libraryEpisode: {
        count: ({ where }: { where: EpisodeWhere }) =>
          Promise.resolve(countEpisodes(where)),
      },
      libraryBook: {
        delete: ({ where }: { where: { id: number } }) => {
          state.deletedLibrary.push(`book:${where.id}`);
          return Promise.resolve({});
        },
        findUnique: ({ where }: { where: { googleVolumeId: string } }) =>
          Promise.resolve(
            state.libraryBooks.find(
              (b) => b.googleVolumeId === where.googleVolumeId,
            ) ?? null,
          ),
      },
      qualityProfile: {
        findUnique: ({ where }: { where: { id: number } }) =>
          Promise.resolve(
            state.profiles.includes(where.id) ? { id: where.id } : null,
          ),
      },
      bookQualityProfile: {
        findUnique: ({ where }: { where: { id: number } }) =>
          Promise.resolve(
            state.bookProfiles.includes(where.id) ? { id: where.id } : null,
          ),
      },
      mediaRequest: {
        findUnique: ({
          where,
        }: {
          where: {
            tmdbId_type?: { tmdbId: number; type: string };
            googleVolumeId?: string;
            id?: number;
          };
        }) => {
          if (where.id != null)
            return Promise.resolve(
              state.requests.find((r) => r.id === where.id) ?? null,
            );
          if (where.googleVolumeId != null)
            return Promise.resolve(
              state.requests.find(
                (r) => r.googleVolumeId === where.googleVolumeId,
              ) ?? null,
            );
          const k = where.tmdbId_type!;
          return Promise.resolve(
            state.requests.find(
              (r) => r.tmdbId === k.tmdbId && r.type === k.type,
            ) ?? null,
          );
        },
        findFirst: ({
          where,
        }: {
          where: {
            libraryMediaId?: number;
            libraryBookId?: number;
            status: string;
          };
        }) =>
          Promise.resolve(
            state.requests.find((r) => {
              if (where.status !== r.status) return false;
              if (where.libraryMediaId != null)
                return r.libraryMediaId === where.libraryMediaId;
              if (where.libraryBookId != null)
                return r.libraryBookId === where.libraryBookId;
              return false;
            }) ?? null,
          ),
        create: ({ data }: { data: Req }) => {
          const row = { ...data, id: state.requests.length + 1 };
          state.requests.push(row);
          state.created.push(row);
          return Promise.resolve(row);
        },
        update: ({
          where,
          data,
        }: {
          where: { id: number };
          data: Partial<Req>;
        }) => {
          const row = state.requests.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
        updateMany: ({
          where,
          data,
        }: {
          where: { id: number; status: string };
          data: Partial<Req>;
        }) => {
          const rows = state.requests.filter(
            (r) => r.id === where.id && r.status === where.status,
          );
          for (const r of rows) Object.assign(r, data);
          return Promise.resolve({ count: rows.length });
        },
        deleteMany: ({
          where,
        }: {
          where: {
            id?: number;
            status?: { in: string[] };
            libraryMediaId?: number;
            libraryBookId?: number;
          };
        }) => {
          state.beforeDeleteMany?.();
          if (where.libraryMediaId != null || where.libraryBookId != null)
            state.deletedLibrary.push("requests");
          const before = state.requests.length;
          state.requests = state.requests.filter(
            (r) =>
              !(
                (where.id == null || r.id === where.id) &&
                (where.status == null || where.status.in.includes(r.status)) &&
                (where.libraryMediaId == null ||
                  r.libraryMediaId === where.libraryMediaId) &&
                (where.libraryBookId == null ||
                  r.libraryBookId === where.libraryBookId)
              ),
          );
          return Promise.resolve({ count: before - state.requests.length });
        },
      },
      bookEdition: {
        findFirst: ({ where }: { where: { bookId: number; status: string } }) =>
          Promise.resolve(
            state.bookEditionStatusByBookId[where.bookId] === where.status
              ? { id: where.bookId }
              : null,
          ),
      },
      user: {
        findMany: ({ where }: { where?: { isAdmin?: boolean } } = {}) => {
          if (where?.isAdmin) {
            return Promise.resolve(
              state.admins.map((a) => ({
                id: a.id,
                locale: a.locale ?? null,
                notificationPreferences: a.notificationPreferences ?? null,
              })),
            );
          }
          return Promise.resolve(state.admins);
        },
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            locale: null,
            notificationPreferences: null,
          }),
      },
      mediaSettings: {
        findUnique: () =>
          Promise.resolve({
            defaultMovieQualityProfileId: state.defaultProfiles.movie,
            defaultShowQualityProfileId: state.defaultProfiles.show,
          }),
      },
      $transaction: (promises: Promise<any>[]) => {
        state.deletedLibrary.push("transaction");
        return Promise.all(promises);
      },
    },
  }));
}

const realSearchOnAdd = {
  ...(await import("@rawkoon/api/services/searchOnAdd")),
};

/** Each test file installs these before importing the service, since bun's mock.module must precede it. */
export function installMediaRequestMocks() {
  installMediaRequestDbMock();

  mock.module("@rawkoon/api/services/libraryFromTmdb", () => ({
    addOrUpdateLibraryFromTmdb: ({ tmdb_id }: { tmdb_id: number }) =>
      state.failLibraryAdd
        ? Promise.reject(new Error("TMDB unreachable"))
        : Promise.resolve({
            id: 900 + tmdb_id,
            tmdbId: tmdb_id,
            type: "movie",
            title: "T",
            status: "wanted",
            digitalReleaseDate: new Date("2020-01-01"),
          }),
  }));

  mock.module("@rawkoon/api/services/searchOnAdd", () => ({
    isMovieReleased: () => true,
    searchOnAddJobId: (id: number) => `search-on-add-${id}`,
    queueSearchOnAdd: (media: { id: number }) => {
      state.searchQueued.push(media.id);
      return Promise.resolve({
        search_queued: true,
        search_skipped_reason: null,
      });
    },
  }));

  mock.module("@rawkoon/api/utils/medias/tmdbRegion", () => ({
    getGlobalTmdbRegion: () => Promise.resolve("US"),
  }));

  mock.module("@rawkoon/api/services/books/bookLibrary", () => ({
    addBookFromVolume: ({
      volumeId,
      bookQualityProfileId,
    }: {
      volumeId: string;
      bookQualityProfileId?: number;
    }) => {
      state.addedBooks.push({ volumeId, bookQualityProfileId });
      return Promise.resolve({
        added: true,
        bookId: 5000 + state.addedBooks.length,
        created: true,
      });
    },
  }));

  // Full export surface — a partial mock here leaks globally (bun mock.module is
  // process-wide) and breaks other suites that use the real cache module.
  mock.module("@rawkoon/api/services/cache", () => ({
    getJsonCache: () => Promise.resolve(null),
    setJsonCache: () => Promise.resolve(),
    deleteCache: () => Promise.resolve(),
  }));

  mock.module("@rawkoon/api/utils/dashboard/tmdbUpcoming", () => ({
    TMDB_UPCOMING_CACHE_KEY: "tmdb:upcoming",
    invalidateUpcomingCache: () => Promise.resolve(),
  }));

  function installMediaRequestNotificationMock() {
    mock.module("@rawkoon/api/workers/notificationService", () => ({
      getAllUsers: () => Promise.resolve([]),
      createAndQueueNotification: (
        userId: string,
        _t: string,
        _b: string,
        type: string,
      ) => {
        state.notifications.push({ userId, type });
        return Promise.resolve(true);
      },
    }));
  }
  installMediaRequestNotificationMock();
}

export function useMediaRequestHooks() {
  afterAll(() => {
    mock.module("@rawkoon/api/services/searchOnAdd", () => realSearchOnAdd);
    mock.restore();
  });

  beforeEach(() => {
    state.library = [];
    state.libraryBooks = [];
    state.requests = [];
    state.created = [];
    state.notifications = [];
    state.admins = [{ id: "admin-1" }];
    state.profiles = [1, 3];
    state.bookProfiles = [7];
    state.mediaStatusById = {};
    state.mediaTmdbStatusById = {};
    state.episodesByMediaId = {};
    state.addedBooks = [];
    state.bookEditionStatusByBookId = {};
    state.defaultProfiles = { movie: null, show: null };
    state.failLibraryAdd = false;
    state.searchQueued = [];
    state.beforeDeleteMany = null;
    state.deletedLibrary = [];
  });
}
