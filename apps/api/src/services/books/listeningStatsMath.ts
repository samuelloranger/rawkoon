export type SeriesBookInput = {
  seriesName: string | null;
  title: string;
  hasAudiobook: boolean;
  finished: boolean;
  positionSecs: number;
  totalDurationSecs: number;
  updatedAtMs: number | null;
};

export type SeriesStat = {
  name: string;
  books_total: number;
  books_finished: number;
  percent: number;
  current_title: string | null;
};

export function creditSeconds(
  previousPosition: number,
  newPosition: number,
  elapsedWallSecs: number,
): number {
  if (elapsedWallSecs < 0) return 0;
  const delta = newPosition - previousPosition;
  const max = elapsedWallSecs * 2 + 15;
  if (delta <= 0 || delta > max) return 0;
  return delta;
}

export function calendarDateInTz(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays);
  return new Date(utc).toISOString().slice(0, 10);
}

export function isoWeekDays(todayYmd: string): string[] {
  const [y, m, d] = todayYmd.split("-").map(Number);
  const mon0 = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const monday = addDaysYmd(todayYmd, -mon0);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDaysYmd(monday, i));
}

export function streakDays(
  daysWithSeconds: ReadonlySet<string>,
  todayYmd: string,
): number {
  const yesterday = addDaysYmd(todayYmd, -1);
  const start = daysWithSeconds.has(todayYmd)
    ? todayYmd
    : daysWithSeconds.has(yesterday)
      ? yesterday
      : null;
  if (!start) return 0;
  let count = 0;
  let cursor = start;
  while (daysWithSeconds.has(cursor)) {
    count += 1;
    cursor = addDaysYmd(cursor, -1);
  }
  return count;
}

function bookRatio(book: SeriesBookInput): number {
  if (book.finished) return 1;
  if (book.totalDurationSecs > 0) {
    return Math.min(1, Math.max(0, book.positionSecs / book.totalDurationSecs));
  }
  return 0;
}

type SeriesStatWithSort = SeriesStat & { currentUpdatedAtMs: number };

export function buildSeriesStats(books: SeriesBookInput[]): SeriesStat[] {
  const groups = new Map<string, SeriesBookInput[]>();
  for (const book of books) {
    if (!book.hasAudiobook || !book.seriesName) continue;
    const list = groups.get(book.seriesName) ?? [];
    list.push(book);
    groups.set(book.seriesName, list);
  }

  const stats: SeriesStatWithSort[] = [];
  for (const [name, members] of groups) {
    if (members.length < 2) continue;
    const ratios = members.map(bookRatio);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const inProgress = members
      .filter((b) => !b.finished && b.positionSecs > 1)
      .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
    const current = inProgress[0];
    stats.push({
      name,
      books_total: members.length,
      books_finished: members.filter((b) => b.finished).length,
      percent: Math.round(mean * 100),
      current_title: current?.title ?? null,
      currentUpdatedAtMs: current?.updatedAtMs ?? 0,
    });
  }

  stats.sort((a, b) => {
    const aIn = a.current_title ? 0 : 1;
    const bIn = b.current_title ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    if (a.current_title && b.current_title) {
      const dt = b.currentUpdatedAtMs - a.currentUpdatedAtMs;
      if (dt !== 0) return dt;
    }
    return a.name.localeCompare(b.name);
  });

  return stats.map(({ currentUpdatedAtMs: _, ...stat }) => stat);
}
