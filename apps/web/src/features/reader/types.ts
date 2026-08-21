interface ReaderTocEntry {
  label: string;
  locator: string;
}

export interface ReaderDoc {
  toc: ReaderTocEntry[];
  /** Pages for pdf/cbz; null for epub, where position is a fraction. */
  totalPages: number | null;
}

export type ReaderTheme = "night" | "paper";

export interface Typography {
  fontFamily: "serif" | "sans";
  fontSizePx: number;
  lineHeight: number;
  marginPx: number;
  theme: ReaderTheme;
  /** Epub only: paginated columns or a continuous scroll. */
  flow: "paginated" | "scrolled";
}

export interface ReaderPosition {
  locator: string;
  percent: number;
  /** Human label for the chrome, when the renderer knows one. */
  label?: string | null;
}

/**
 * What every renderer implements. The shell owns chrome, typography state, the
 * rail and the keyboard; a renderer owns only how a format paints and paginates.
 */
export interface ReaderHandle {
  goTo: (locator: string) => void;
  next: () => void;
  prev: () => void;
  applyTypography: (typography: Typography) => void;
}

export interface RendererProps {
  /**
   * Download and open progress, 0..1, or null once it is out of the way. A
   * 1.8MB book over a phone connection is a real wait, and a spinner that
   * cannot say how long is worse than a bar that can.
   */
  onProgress: (percent: number | null) => void;
  url: string;
  initialLocator: string | null;
  typography: Typography;
  onReady: (doc: ReaderDoc) => void;
  onPosition: (position: ReaderPosition) => void;
  onError: (message: string) => void;
  handleRef: (handle: ReaderHandle | null) => void;
}

export const THEME_COLORS: Record<
  ReaderTheme,
  { background: string; foreground: string }
> = {
  // The app's own tokens, inverted for Paper — not a second palette.
  night: { background: "#171311", foreground: "#e3d8cf" },
  paper: { background: "#f4ece4", foreground: "#241e1b" },
};

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: "serif",
  fontSizePx: 19,
  lineHeight: 1.65,
  marginPx: 32,
  theme: "night",
  flow: "paginated",
};
