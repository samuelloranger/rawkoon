import { useEffect, useRef } from "react";
import ePub, { type Book, type Rendition } from "epubjs";
import { THEME_COLORS, type RendererProps, type Typography } from "../types";

/**
 * Epub, through epub.js.
 *
 * Position is a CFI, which is the only locator that survives a change of font
 * size — a page number would not, and re-opening a book at the wrong place is
 * the failure this format has to avoid.
 */
/** Registers and selects the reading theme. Shared by both call sites. */
const applyTheme = (rendition: Rendition, typography: Typography) => {
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
};

const EpubRenderer = ({
  url,
  initialLocator,
  typography,
  onReady,
  onPosition,
  onError,
  handleRef,
}: RendererProps) => {
  // Held in refs so the loading effect depends on the file, not on callback
  // identity. A parent re-render must never tear down a renderer mid-load.
  const callbacks = useRef({ onReady, onPosition, onError });
  callbacks.current = { onReady, onPosition, onError };
  // Read inside the async load, which must not close over a stale value.
  const typographyRef = useRef(typography);
  typographyRef.current = typography;

  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookRef = useRef<Book | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    // The file is fetched here and handed to epub.js as a Blob rather than by
    // URL. epub.js decides how to open a string url from its file extension,
    // and `/api/books/files/1/content` has none — so it treated the endpoint as
    // an unpacked epub *directory* and went looking for
    // `/api/books/files/1/META-INF/container.xml`. Fetching it ourselves also
    // means an HTTP failure surfaces as an error instead of silently rendering
    // nothing.
    const book = ePub();
    bookRef.current = book;
    let rendition: Rendition | null = null;
    // Whether the load ran to completion. A book torn down mid-load leaves
    // epub.js's own pending work reading fields that destroy() has cleared.
    let settled = false;

    const start = async () => {
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const type = response.headers.get("content-type") ?? "";
        // The API answers with the epub's own content type; anything else means
        // a route fell through to something that is not the file.
        if (type.includes("text/html")) {
          throw new Error("unexpected html response");
        }

        await book.open(await response.arrayBuffer(), "binary");
        if (cancelled) return;

        // Rendered only once the book is open: a rendition attached to an
        // unopened book races its packaging and throws on displayOptions.
        rendition = book.renderTo(container, {
          width: "100%",
          height: "100%",
          flow: typography.flow === "scrolled" ? "scrolled-doc" : "paginated",
          spread: "none",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        rendition.on("relocated", report);
        applyTheme(rendition, typographyRef.current);

        await rendition.display(initialLocator ?? undefined);
        if (cancelled) return;

        const nav = await book.loaded.navigation;
        callbacks.current.onReady({
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
        settled = true;
      } catch (err) {
        if (!cancelled) {
          callbacks.current.onError(
            err instanceof Error ? err.message : "unreadable",
          );
        }
      }
    };

    const report = () => {
      if (!rendition) return;
      const location = rendition.currentLocation() as unknown as {
        start?: { cfi?: string; index?: number };
      };
      const cfi = location?.start?.cfi;
      if (!cfi) return;
      const percent = book.locations.percentageFromCfi(cfi) ?? 0;
      callbacks.current.onPosition({ locator: cfi, percent });
    };

    // Kept so teardown can wait: destroying the book while `display()` is still
    // pending leaves epub.js reading `this.book.displayOptions` off an object it
    // has already torn down, and that throws past React.
    const loading = start();

    return () => {
      cancelled = true;
      void loading.finally(() => {
        // epub.js also reaches for `this.container` in destroy(), which is
        // undefined when the rendition never rendered.
        try {
          rendition?.destroy();
        } catch {
          // Nothing to release: it never rendered.
        }
        // Only destroy a book that finished opening. Destroying one mid-load
        // clears the fields its own in-flight promises still read, and those
        // rejections surface as uncaught errors. Dropping the reference is
        // enough for an abandoned load; the object is garbage either way.
        if (settled) {
          try {
            book.destroy();
          } catch {
            // Nothing to release.
          }
        }
        renditionRef.current = null;
        bookRef.current = null;
      });
    };

    // Flow is a structural option in epub.js: changing it rebuilds the
    // rendition, which is why it belongs in this dependency list. The callbacks
    // deliberately do not: they live in a ref, because a changing callback
    // identity would rebuild the book on every parent render.
  }, [url, typography.flow, initialLocator]);

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
    applyTheme(rendition, typography);
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
