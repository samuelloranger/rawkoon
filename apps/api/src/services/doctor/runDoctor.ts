import type { DoctorCheck, DoctorReport } from "@rawkoon/shared/types";
import {
  checkHealth,
  type HealthPayload,
} from "@rawkoon/api/services/healthCheck";
import {
  getGrabReadiness,
  PROBE_TIMEOUT_MS,
} from "@rawkoon/api/services/grab/grabReadiness";
import { scheduledTasksQueue } from "@rawkoon/api/services/queueService";
import { buildScheduledJobs } from "@rawkoon/api/services/scheduledJobs";
import { getAppVersion } from "@rawkoon/api/services/versionService";
import { getBooksEnabled } from "@rawkoon/api/services/settings/appSettings";
import {
  getJellyfinConfig,
  jellyfinAuthHeader,
} from "@rawkoon/api/services/jellyfin/jellyfinUsers";
import { loadTmdbConfig } from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import { fetchWithTimeout } from "@rawkoon/api/utils/fetchWithTimeout";
import {
  compareMigrations,
  readAppliedMigrationRows,
  readMigrationDirs,
} from "./migrations";
import { evaluateHardlinks } from "./hardlinks";
import { mapGrabReadiness } from "./grabMapping";
import { evaluateFreeSpace, evaluatePathAccess, type PathProbe } from "./paths";
import {
  probePath,
  readLibrarySettings,
  statDevice,
  statFreeBytes,
  type LibrarySettings,
} from "./probes";
import { worstStatus, type CheckOutcome } from "./status";
import { DOCTOR_TIMEOUT_MS, draft, runCheck, type CheckDef } from "./runCheck";
import {
  endpointLabel,
  HttpStatusError,
} from "@rawkoon/api/utils/describeError";

// Headroom above grabReadiness's own probe budget so its classified
// "unreachable" drafts win over an outer collapse into "timed out".
const GRAB_READINESS_TIMEOUT_MS = PROBE_TIMEOUT_MS + 2000;

const SETTINGS_UNAVAILABLE: PathProbe = {
  exists: false,
  isDirectory: false,
  readableAndWritable: false,
  error: null,
};

const PATH_SLOTS = [
  {
    id: "library_path_movies",
    title: "Movies library path",
    key: "moviesLibraryPath",
    booksGated: false,
  },
  {
    id: "library_path_shows",
    title: "Shows library path",
    key: "showsLibraryPath",
    booksGated: false,
  },
  {
    id: "library_path_books",
    title: "Books library path",
    key: "booksLibraryPath",
    booksGated: true,
  },
  {
    id: "library_path_audiobooks",
    title: "Audiobooks library path",
    key: "audiobooksLibraryPath",
    booksGated: true,
  },
  {
    id: "downloads_path",
    title: "Downloads path",
    key: "downloadsPath",
    booksGated: false,
  },
] as const;

type PathSlotDef = (typeof PATH_SLOTS)[number];

function pathDef(
  slot: PathSlotDef,
  settings: Promise<LibrarySettings>,
  booksEnabled: Promise<boolean>,
): CheckDef {
  return {
    id: slot.id,
    title: slot.title,
    needs: "db",
    fixOnCrash: "Check the mount and permissions for the configured path.",
    run: async () => {
      // A movies-only install has no book paths to warn about.
      if (slot.booksGated && !(await booksEnabled)) return [];
      const path = (await settings)[slot.key];
      const probe = path ? await probePath(path) : SETTINGS_UNAVAILABLE;
      return [draft(slot.id, slot.title, evaluatePathAccess(path, probe))];
    },
  };
}

/** Configured (non-null) paths, books included only when books are enabled. */
async function configuredSlots(
  settings: Promise<LibrarySettings>,
  booksEnabled: Promise<boolean>,
): Promise<{ id: string; path: string }[]> {
  const [row, books] = await Promise.all([settings, booksEnabled]);
  const slots: { id: string; path: string | null }[] = PATH_SLOTS.filter(
    (slot) => !slot.booksGated || books,
  ).map((slot) => ({ id: slot.id, path: row[slot.key] }));
  return slots.filter(
    (slot): slot is { id: string; path: string } => slot.path !== null,
  );
}

function freeSpaceDef(
  settings: Promise<LibrarySettings>,
  booksEnabled: Promise<boolean>,
): CheckDef {
  return {
    id: "free_space",
    title: "Free space",
    needs: "db",
    fixOnCrash: "Check that the library and download volumes are mounted.",
    run: async () => {
      const slots = await configuredSlots(settings, booksEnabled);
      const readings = await Promise.all(
        slots.map(async (slot) => {
          const { freeBytes, error } = await statFreeBytes(slot.path);
          return { id: slot.id, freeBytes, error };
        }),
      );
      const minFreeGb = (await settings).minFreeSpaceGb;
      return [
        draft(
          "free_space",
          "Free space",
          evaluateFreeSpace(minFreeGb, readings),
        ),
      ];
    },
  };
}

function hardlinksDef(
  settings: Promise<LibrarySettings>,
  booksEnabled: Promise<boolean>,
): CheckDef {
  return {
    id: "hardlinks",
    title: "Hardlink support",
    needs: "db",
    fixOnCrash: "Check the mounts for the downloads and library paths.",
    run: async () => {
      const row = await settings;
      const slots = await configuredSlots(settings, booksEnabled);
      const downloads = slots.find((slot) => slot.id === "downloads_path");
      const libraries = slots.filter((slot) => slot.id !== "downloads_path");
      const downloadsDevice = downloads
        ? await statDevice(downloads.path)
        : null;
      const libraryDevices = await Promise.all(
        libraries.map(async (slot) => ({
          id: slot.id,
          device: await statDevice(slot.path),
        })),
      );
      return [
        draft(
          "hardlinks",
          "Hardlink support",
          evaluateHardlinks({
            fileOperation: row.fileOperation,
            downloadsDevice,
            libraryDevices: libraryDevices.filter(
              (library): library is { id: string; device: number } =>
                library.device !== null,
            ),
          }),
        ),
      ];
    },
  };
}

function databaseDef(health: Promise<HealthPayload | null>): CheckDef {
  return {
    id: "database",
    title: "Database",
    fixOnCrash: "Check DATABASE_URL and that the database container is up.",
    run: async () => {
      const reachable = (await health)?.db === true;
      return [
        draft(
          "database",
          "Database",
          reachable
            ? { status: "ok", summary: "Reachable.", fix: null }
            : {
                status: "fail",
                summary: "Not reachable.",
                fix: "Check DATABASE_URL and that the database container is up.",
              },
        ),
      ];
    },
  };
}

function valkeyDef(health: Promise<HealthPayload | null>): CheckDef {
  return {
    id: "valkey",
    title: "Valkey",
    fixOnCrash: "Check the REDIS/VALKEY host and port in the environment.",
    run: async () => {
      const reachable = (await health)?.valkey === true;
      return [
        draft(
          "valkey",
          "Valkey",
          reachable
            ? { status: "ok", summary: "Reachable.", fix: null }
            : {
                status: "fail",
                summary: "Not reachable.",
                fix: "Check the REDIS/VALKEY host and port in the environment — another container may already hold that port.",
              },
        ),
      ];
    },
  };
}

function scheduledJobsDef(): CheckDef {
  return {
    id: "scheduled_jobs",
    title: "Scheduled jobs",
    needs: "valkey",
    fixOnCrash:
      "Scheduled jobs are registered from Valkey at API startup — check that Valkey is reachable, then restart the API.",
    run: async () => {
      // Read-only Valkey state: a BullMQ queue never starts workers here.
      const schedulers = await scheduledTasksQueue.getJobSchedulers();
      const registered = new Set(schedulers.map((scheduler) => scheduler.name));
      // Exactly what startup registers — on-demand names like
      // upgrade-media-search are not schedulers and must not be expected.
      const expected = buildScheduledJobs().map((job) => job.name);
      const missing = expected.filter((name) => !registered.has(name));
      return [
        draft(
          "scheduled_jobs",
          "Scheduled jobs",
          missing.length === 0
            ? {
                status: "ok",
                summary: `All ${expected.length} scheduled jobs are registered.`,
                fix: null,
              }
            : {
                status: "warn",
                summary: `${missing.length} scheduled ${
                  missing.length === 1 ? "job is" : "jobs are"
                } not registered: ${missing.join(", ")}.`,
                fix: "Restart the API so startup re-registers them.",
              },
        ),
      ];
    },
  };
}

function grabReadinessDef(): CheckDef {
  return {
    id: "grab_readiness",
    title: "Grab readiness",
    // The inner probes bound themselves at PROBE_TIMEOUT_MS; stay above them
    // so a slow indexer reports unreachable instead of one "timed out" row.
    timeoutMs: GRAB_READINESS_TIMEOUT_MS,
    fixOnCrash: "Check the indexer manager and download client under Settings.",
    run: async () => {
      // refresh: the doctor probes live instead of reusing a cached result.
      const checks = await getGrabReadiness({ refresh: true });
      return mapGrabReadiness(checks).map((check) =>
        draft(check.id, check.title, check.outcome),
      );
    },
  };
}

function jellyfinDef(): CheckDef {
  return {
    id: "jellyfin",
    title: "Jellyfin",
    fixOnCrash:
      "Check the Jellyfin URL and API key under Settings → Integrations.",
    run: async () => {
      const config = await getJellyfinConfig();
      // Optional integration: absent is fine; present-but-broken is a fail.
      if (!config) {
        return [
          draft("jellyfin", "Jellyfin", {
            status: "ok",
            summary: "Not configured (optional).",
            fix: null,
          }),
        ];
      }
      const res = await fetchWithTimeout(
        `${config.website_url}/System/Info`,
        { headers: jellyfinAuthHeader(config.api_key) },
        DOCTOR_TIMEOUT_MS,
      );
      if (!res.ok) throw new HttpStatusError(res.status);
      return [
        draft("jellyfin", "Jellyfin", {
          status: "ok",
          summary: `Reachable at ${endpointLabel(config.website_url)}.`,
          fix: null,
        }),
      ];
    },
  };
}

function tmdbDef(): CheckDef {
  return {
    id: "tmdb",
    title: "TMDB",
    fixOnCrash: "Check the TMDB API key under Settings → Integrations.",
    run: async () => {
      const config = await loadTmdbConfig();
      if (!config) {
        return [
          draft("tmdb", "TMDB", {
            status: "warn",
            summary: "Not configured — discovery and metadata will not work.",
            fix: "Set the TMDB API key under Settings → Integrations.",
          }),
        ];
      }
      // The cheapest authenticated call: /configuration carries no payload.
      const res = await fetchWithTimeout(
        `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(config.api_key)}`,
        { headers: { Accept: "application/json" } },
        DOCTOR_TIMEOUT_MS,
      );
      if (!res.ok) throw new HttpStatusError(res.status);
      return [
        draft("tmdb", "TMDB", {
          status: "ok",
          summary: "Reachable — the API key works.",
          fix: null,
        }),
      ];
    },
  };
}

function versionDef(): CheckDef {
  return {
    id: "version",
    title: "Version",
    fixOnCrash: null,
    run: async () => {
      const version = getAppVersion();
      const dev = version.startsWith("0.0.0-dev");
      return [
        draft(
          "version",
          "Version",
          dev
            ? {
                status: "warn",
                summary: `Development build (${version}) — the image was built without APP_VERSION.`,
                fix: null,
              }
            : { status: "ok", summary: `Rawkoon ${version}.`, fix: null },
        ),
      ];
    },
  };
}

function migrationsDef(): CheckDef {
  return {
    id: "migrations",
    title: "Migrations",
    needs: "db",
    fixOnCrash:
      "Run `prisma migrate deploy` — the container entrypoint does this on startup.",
    run: async () => {
      const [rows, dirs] = await Promise.all([
        readAppliedMigrationRows(),
        readMigrationDirs(),
      ]);
      return [draft("migrations", "Migrations", compareMigrations(rows, dirs))];
    },
  };
}

/**
 * Probes everything Rawkoon depends on and returns one report. All checks run
 * in parallel, each bounded (DOCTOR_TIMEOUT_MS by default, overridable per
 * check); a throwing (or hanging) check becomes a failed check, never a
 * crashed report.
 */
export async function runDoctor(): Promise<DoctorReport> {
  // Shared probes start immediately; every check that needs one awaits the
  // same promise instead of re-querying. A settings failure (DB down) fails
  // each dependent check with the real cause instead of hiding behind "unset".
  const health = checkHealth(DOCTOR_TIMEOUT_MS).catch(() => null);
  const settings = readLibrarySettings();
  const booksEnabled = getBooksEnabled().catch(() => false);

  const defs: CheckDef[] = [
    versionDef(),
    databaseDef(health),
    migrationsDef(),
    valkeyDef(health),
    scheduledJobsDef(),
    ...PATH_SLOTS.map((slot) => pathDef(slot, settings, booksEnabled)),
    freeSpaceDef(settings, booksEnabled),
    hardlinksDef(settings, booksEnabled),
    grabReadinessDef(),
    jellyfinDef(),
    tmdbDef(),
  ];

  const checks = (
    await Promise.all(defs.map((def) => runCheck(def, health)))
  ).flat();
  return {
    status: worstStatus(checks.map((check) => check.status)),
    version: getAppVersion(),
    checked_at: new Date().toISOString(),
    checks,
  };
}
