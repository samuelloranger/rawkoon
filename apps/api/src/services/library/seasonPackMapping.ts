/**
 * Decides which source files belong on which provider episodes for a season
 * pack, and refuses when it cannot be sure.
 *
 * Streaming platforms split double-length episodes into "Part 1" / "Part 2"
 * and number them separately, while TMDb and TVDB count them as one episode.
 * A pack built that way has one more file than the provider has episodes, and
 * naive SxxExx matching shifts every later episode onto the wrong metadata and
 * drops the finale entirely. House season 6 shipped exactly that way: 22 files
 * against 21 episodes, so "Epic Fail" was imported as "The Tyrant" and
 * "Help Me" was never imported at all.
 *
 * This module is pure: no filesystem, no database, no mediainfo. Track-layout
 * compatibility between two merge candidates is I/O and is verified by the
 * caller before the merge runs.
 */

export type ParsedSourceFile = {
  path: string;
  fileName: string;
  season: number;
  episode: number;
  part: number | null;
  ext: string;
};

export type ProviderEpisode = {
  id: number;
  season: number;
  episode: number;
  title: string | null;
};

export type Placement =
  | { kind: "direct"; sources: [ParsedSourceFile]; episode: ProviderEpisode }
  | {
      kind: "merge";
      sources: [ParsedSourceFile, ParsedSourceFile];
      episode: ProviderEpisode;
    };

export type MappingResult =
  | { ok: true; placements: Placement[] }
  | { ok: false; reason: string; unmatched: string[] };

const PART_PATTERNS: RegExp[] = [
  /\bpart[\s._-]?([12])\b/i,
  /\bpt[\s._-]?([12])\b/i,
  /\(([12])\)/,
];

/** Returns 1 or 2 when the filename carries an explicit part marker. */
export function parsePartMarker(fileName: string): number | null {
  for (const re of PART_PATTERNS) {
    const m = fileName.match(re);
    if (m) return parseInt(m[1] as string, 10);
  }
  return null;
}

function refuse(reason: string, unmatched: string[] = []): MappingResult {
  return { ok: false, reason, unmatched };
}

export function resolveSeasonPackMapping(
  sources: ParsedSourceFile[],
  providerEpisodes: ProviderEpisode[],
): MappingResult {
  if (sources.length === 0) return refuse("No parsable source files");

  const bySeason = new Map<number, ParsedSourceFile[]>();
  for (const s of sources) {
    const list = bySeason.get(s.season) ?? [];
    list.push(s);
    bySeason.set(s.season, list);
  }

  const placements: Placement[] = [];

  for (const [season, seasonSources] of bySeason) {
    const provider = providerEpisodes
      .filter((e) => e.season === season)
      .sort((a, b) => a.episode - b.episode);

    if (provider.length === 0) {
      return refuse(
        `No provider episodes for season ${season}`,
        seasonSources.map((s) => s.fileName),
      );
    }

    const ordered = [...seasonSources].sort((a, b) => a.episode - b.episode);
    const providerByNumber = new Map(provider.map((e) => [e.episode, e]));
    const unmatched = ordered.filter((s) => !providerByNumber.has(s.episode));

    const pushDirect = () => {
      for (const s of ordered) {
        placements.push({
          kind: "direct",
          sources: [s],
          episode: providerByNumber.get(s.episode) as ProviderEpisode,
        });
      }
    };

    // A complete pack that lines up 1:1 is trusted as-is. This is what keeps
    // shows whose provider genuinely lists "Part 1"/"Part 2" as separate
    // episodes from being collapsed: the counts already agree, so there is
    // nothing to repair.
    if (unmatched.length === 0 && ordered.length === provider.length) {
      pushDirect();
      continue;
    }

    // Look for split pairs before trusting the numbers. A *partial* split pack
    // has no unmatched files at all — sources 1..4 all exist in a 21-episode
    // season — yet mapping them directly would put "Broken Part 2" onto
    // episode 2. Detecting pairs is therefore not conditional on a mismatch.
    const groups: ParsedSourceFile[][] = [];
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i] as ParsedSourceFile;
      const b = ordered[i + 1];
      const isPair =
        a.part === 1 &&
        b != null &&
        b.part === 2 &&
        b.episode === a.episode + 1;
      if (isPair) {
        const second = b as ParsedSourceFile;
        if (
          a.ext.toLowerCase() !== ".mkv" ||
          second.ext.toLowerCase() !== ".mkv"
        ) {
          return refuse(
            `Split episode detected but "${a.fileName}" and "${second.fileName}" are not mkv — cannot merge`,
            unmatched.map((s) => s.fileName),
          );
        }
        groups.push([a, second]);
        i++;
      } else {
        groups.push([a]);
      }
    }

    const merged = groups.filter((g) => g.length === 2).length;

    if (merged === 0) {
      // No split to repair. A partial pack with no unmatched files is ordinary
      // and imports; anything else is a shape we do not understand.
      if (unmatched.length === 0) {
        pushDirect();
        continue;
      }
      return refuse(
        `${unmatched.length} file(s) match no episode of season ${season} and no split episode was found`,
        unmatched.map((s) => s.fileName),
      );
    }

    // Split pairs exist. Collapsing them must explain the discrepancy exactly,
    // otherwise we are guessing at where the renumbering starts and stops.
    if (groups.length !== provider.length) {
      return refuse(
        `Season ${season}: ${groups.length} episode(s) after collapsing ${merged} split pair(s), but the provider lists ${provider.length}`,
        unmatched.map((s) => s.fileName),
      );
    }

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i] as ParsedSourceFile[];
      const episode = provider[i] as ProviderEpisode;
      if (group.length === 2) {
        placements.push({
          kind: "merge",
          sources: [group[0] as ParsedSourceFile, group[1] as ParsedSourceFile],
          episode,
        });
      } else {
        placements.push({
          kind: "direct",
          sources: [group[0] as ParsedSourceFile],
          episode,
        });
      }
    }
  }

  return { ok: true, placements };
}
