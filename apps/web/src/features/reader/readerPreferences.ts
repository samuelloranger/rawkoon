const KEY = "rawkoon.web.reader.preferences";

export type ReaderTheme = "light" | "sepia" | "dark";

export type ReaderPreferences = {
  fontSize: number;
  lineHeight: number;
  pageGutter: number;
  theme: ReaderTheme;
};

const DEFAULTS: ReaderPreferences = {
  fontSize: 1,
  lineHeight: 1.5,
  pageGutter: 20,
  theme: "dark",
};

const THEME: Record<
  ReaderTheme,
  { backgroundColor: string; textColor: string }
> = {
  light: { backgroundColor: "#f7f4ef", textColor: "#1a1916" },
  sepia: { backgroundColor: "#f4ecd8", textColor: "#5c4b37" },
  dark: { backgroundColor: "#141414", textColor: "#e8e4dc" },
};

export function loadReaderPreferences(): ReaderPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveReaderPreferences(prefs: ReaderPreferences): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export function epubPrefsFromReader(prefs: ReaderPreferences) {
  return {
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    pageGutter: prefs.pageGutter,
    ...THEME[prefs.theme],
  };
}
