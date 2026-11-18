import type { GrabReadinessCheck } from "@rawkoon/shared/types";
import type { CheckOutcome } from "./status";

export interface GrabCheckDraft {
  id: string;
  title: string;
  outcome: CheckOutcome;
}

const TITLES: Record<string, string> = {
  indexer_manager: "Indexer manager",
  rss_indexers: "RSS indexers",
  download_client: "Download client",
  default_movie_profile: "Default movie profile",
  default_show_profile: "Default show profile",
  profiles_without_maximum: "Quality profiles without a maximum",
  search_on_add: "Search on add",
};

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).name === "string"
            ? ((item as Record<string, unknown>).name as string)
            : null,
        )
        .filter((name): name is string => name !== null)
    : [];

/**
 * Pure: turns grab-readiness params into doctor wording so the probes stay in
 * grabReadiness and this stays testable without I/O.
 */
function outcomeOf(check: GrabReadinessCheck): CheckOutcome {
  const params = check.params ?? {};
  switch (check.id) {
    case "indexer_manager": {
      if (params.reason === "not_configured") {
        return {
          status: "fail",
          summary: "No indexer manager (Prowlarr or Jackett) is configured.",
          fix: "Add one under Settings → Integrations.",
        };
      }
      if (params.reason === "unreachable") {
        return {
          status: "fail",
          summary: `${str(params.manager)} could not be reached.`,
          fix: "Check the indexer manager URL and API key under Settings → Integrations.",
        };
      }
      if (num(params.indexers) === 0) {
        return {
          status: "warn",
          summary: `${str(params.manager)} is reachable but has no enabled indexers.`,
          fix: "Enable at least one indexer in the manager, then reload it under Settings → Integrations.",
        };
      }
      return {
        status: "ok",
        summary: `${num(params.indexers)} indexers enabled on ${str(params.manager)}.`,
        fix: null,
      };
    }
    case "rss_indexers": {
      const watched = num(params.watched);
      if (watched === 0) {
        return {
          status: "warn",
          summary: `No enabled indexer is watched for RSS (unwatched: ${strings(
            params.unwatched,
          ).join(", ")}).`,
          fix: "Turn on Watch for the indexers that should feed automatic grabs.",
        };
      }
      return {
        status: "ok",
        summary: `${watched} of ${num(params.total)} enabled indexers are watched for RSS.`,
        fix: null,
      };
    }
    case "download_client": {
      if (params.reason === "not_configured") {
        return {
          status: "fail",
          summary: "No download client is configured.",
          fix: "Add one under Settings → Download Client.",
        };
      }
      if (params.reason === "unreachable") {
        return {
          status: "fail",
          summary: `Download client ${str(params.client_type)} could not be reached.`,
          fix: "Check its URL and credentials under Settings → Download Client.",
        };
      }
      return {
        status: "ok",
        summary: `Download client ${str(params.client_type)} is reachable.`,
        fix: null,
      };
    }
    case "default_movie_profile":
    case "default_show_profile": {
      const kind = check.id === "default_movie_profile" ? "movie" : "show";
      const name = str(params.profile_name);
      if (!name) {
        return {
          status: "warn",
          summary: `No default ${kind} quality profile is set.`,
          fix: `Pick one under Settings → Library so new ${kind}s get a profile.`,
        };
      }
      return {
        status: "ok",
        summary: `Default ${kind} quality profile: ${name}.`,
        fix: null,
      };
    }
    case "profiles_without_maximum": {
      const withoutMax = names(params.profiles);
      if (withoutMax.length === 0) {
        return {
          status: "ok",
          summary: "Every quality profile has a maximum quality.",
          fix: null,
        };
      }
      return {
        status: "warn",
        summary: `${withoutMax.length} quality ${
          withoutMax.length === 1 ? "profile has" : "profiles have"
        } no maximum set (${withoutMax.join(", ")}).`,
        fix: "Set a maximum under Settings → Quality Profiles so upgrades eventually stop.",
      };
    }
    case "search_on_add": {
      return {
        status: "ok",
        summary: `Search on add is ${params.enabled === true ? "on" : "off"}.`,
        fix: null,
      };
    }
    default: {
      // Unknown future readiness ids stay in the report rather than vanishing.
      return {
        status: "warn",
        summary: `Unrecognized grab readiness check "${check.id}".`,
        fix: null,
      };
    }
  }
}

/** Maps getGrabReadiness() checks onto doctor checks (ok/warn/error → ok/warn/fail). */
export function mapGrabReadiness(
  checks: readonly GrabReadinessCheck[],
): GrabCheckDraft[] {
  return checks.map((check) => ({
    id: check.id,
    title: TITLES[check.id] ?? check.id,
    outcome: outcomeOf(check),
  }));
}
