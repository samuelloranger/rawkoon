/**
 * One state vocabulary for the whole books section.
 *
 * Copper (the app accent) is reserved for a single meaning here: you have it.
 * Amber is a gap, sky is in flight, and a state that has been given up on goes
 * grey. Nothing decorative gets copper, which is what lets the colour carry
 * information at a glance across the list, the detail page, and the authors
 * page without a legend.
 */

export type EditionState =
  | "wanted"
  | "downloading"
  | "upgrading"
  | "downloaded"
  | "skipped";

type StateTokens = {
  /** Left rail on a row or panel. */
  rail: string;
  /** Small filled dot in a ledger line. */
  dot: string;
  /** Chip background + text. */
  chip: string;
  /** Text-only, for a ledger label. */
  text: string;
};

const TOKENS: Record<EditionState, StateTokens> = {
  wanted: {
    rail: "bg-amber-500/70",
    dot: "bg-amber-400",
    chip: "bg-amber-500/15 text-amber-300",
    text: "text-amber-300",
  },
  downloading: {
    rail: "bg-sky-400/80",
    dot: "bg-sky-400",
    chip: "bg-sky-500/15 text-sky-300",
    text: "text-sky-300",
  },
  upgrading: {
    rail: "bg-primary-400/80",
    dot: "bg-primary-300",
    chip: "bg-primary-500/15 text-primary-200",
    text: "text-primary-200",
  },
  downloaded: {
    rail: "bg-primary-500",
    dot: "bg-primary-400",
    chip: "bg-primary-500/15 text-primary-200",
    text: "text-primary-200",
  },
  skipped: {
    rail: "bg-neutral-600",
    dot: "bg-neutral-500",
    chip: "bg-neutral-700/50 text-neutral-400",
    text: "text-neutral-400",
  },
};

export function stateTokens(status: string): StateTokens {
  return TOKENS[status as EditionState] ?? TOKENS.skipped;
}

/**
 * The rail colour for a book with several editions.
 *
 * Reports the least-finished edition, so a row never claims to be complete
 * while one of its editions is still missing. Precedence is by how much work
 * is left, not by status name.
 */
export function aggregateState(
  editions: { status: string }[],
): EditionState | null {
  if (editions.length === 0) return null;
  const order: EditionState[] = [
    "wanted",
    "downloading",
    "upgrading",
    "skipped",
    "downloaded",
  ];
  for (const state of order) {
    if (editions.some((e) => e.status === state)) return state;
  }
  return "downloaded";
}

/** Ebook before audiobook: it is the default kind on add, so it reads first. */
export function byKindOrder<T extends { kind: string }>(editions: T[]): T[] {
  return [...editions].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "ebook" ? -1 : 1,
  );
}
