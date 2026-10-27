import type { BookEditionKind } from "@rawkoon/shared/types";

export interface Source {
  kind: BookEditionKind;
  /** File for a single-format ebook, directory for everything else. */
  path: string;
  /** Register the file where it is, for destinations the API cannot create (root-owned dir); ebook only, since audiobooks need postProcessBook. */
  inPlace?: boolean;
}

export interface Entry {
  /** Stable handle for logs and --only. */
  key: string;
  /** Google Books search query used by --resolve. */
  query: string;
  /** Filled in from --resolve output. Required by --dry-run and --apply. */
  volumeId?: string;
  /** What the volume is expected to be, so a bad match is obvious in review. */
  expect: string;
  /** Overrides the provider-reported language after create, for volumes whose ISBN group disagrees with the text. */
  forceLanguage?: string;
  sources: Source[];
}

const isSource = (v: unknown): v is Source => {
  const s = v as Partial<Source> | null;
  return (
    typeof s?.path === "string" &&
    (s.kind === "ebook" || s.kind === "audiobook")
  );
};

const isEntry = (v: unknown): v is Entry => {
  const e = v as Partial<Entry> | null;
  return (
    typeof e?.key === "string" &&
    typeof e.query === "string" &&
    typeof e.expect === "string" &&
    Array.isArray(e.sources) &&
    e.sources.every(isSource)
  );
};

/** Reads the curated entries from a JSON file kept outside the repo, since they describe one library. */
export async function loadManifest(path: string): Promise<Entry[]> {
  const raw: unknown = await Bun.file(path).json();
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array`);
  const bad = raw.findIndex((e) => !isEntry(e));
  if (bad !== -1) throw new Error(`${path}: entry ${bad} is malformed`);
  return raw as Entry[];
}
