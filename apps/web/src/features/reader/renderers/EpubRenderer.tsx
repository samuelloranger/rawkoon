import { useEffect, useRef } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import { THEME_COLORS, type RendererProps } from "../types";

/**
 * Epub, through epub.js.
 *
 * Position is a CFI, which is the only locator that survives a change of font
 * size — a page number would not, and re-opening a book at the wrong place is
 * the failure this format has to avoid.
 */
const EpubRenderer = ({
  url,
  initialLocator,
  typography,
  onReady,
  onPosition,
  onError,
  handleRef,
}: RendererProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    const book = ePub(url);
    bookRef.current = book;

    const rendition = book.renderTo(container, {
      width: "100%",
      height: "100%",
      flow: typography.flow === "scrolled" ? "scrolled-doc" : "paginated",
      spread: "none",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    const start = async () => {
      try {
        await rendition.display(initialLocator ?? undefined);
        if (cancelled) return;

        const nav = await book.loaded.navigation;
        onReady({
          toc: nav.toc.map((item) => ({
            label: item.label.trim(),
            locator: item.href,
          })),
          totalPages: null,
        });

        // Locations power the percentage; generating them is the one slow step,
        // so it happens after the first page is already on screen.
        await book.locations.generate(1024);
        if (cancelled) return;
        report();
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "unreadable");
        }
      }
    };

    const report = () => {
      const location = rendition.currentLocation() as unknown as {
        start?: { cfi?: string; index?: number };
      };
      const cfi = location?.start?.cfi;
      if (!cfi) return;
      const percent = book.locations.percentageFromCfi(cfi) ?? 0;
      onPosition({ locator: cfi, percent });
    };

    rendition.on("relocated", report);
    void start();

    return () => {
      cancelled = true;
      rendition.destroy();
      book.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
    // Flow is a structural option in epub.js: changing it rebuilds the
    // rendition, which is why it belongs in this dependency list.
  }, [url, typography.flow, initialLocator, onError, onPosition, onReady]);

  useEffect(() => {
    handleRef({
      goTo: (locator) => void renditionRef.current?.display(locator),
      next: () => void renditionRef.current?.next(),
      prev: () => void renditionRef.current?.prev(),
      applyTypography: () => {},
    });
    return () => handleRef(null);
  }, [handleRef]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const colors = THEME_COLORS[typography.theme];
    rendition.themes.register("rawkoon", {
      body: {
        background: colors.background,
        color: colors.foreground,
        "font-family":
          typography.fontFamily === "serif"
            ? '"Literata Variable", Georgia, serif'
            : '"Hanken Grotesk Variable", system-ui, sans-serif',
        "line-height": String(typography.lineHeight),
        padding: `0 ${typography.marginPx}px`,
      },
      p: { "line-height": String(typography.lineHeight) },
      a: { color: "#e8a06a" },
    });
    rendition.themes.select("rawkoon");
    rendition.themes.fontSize(`${typography.fontSizePx}px`);
  }, [typography]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ background: THEME_COLORS[typography.theme].background }}
    />
  );
};

export default EpubRenderer;
