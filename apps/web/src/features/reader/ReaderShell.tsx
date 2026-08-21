import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, List, Type, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import { ChapterRail } from "@/features/books/ChapterRail";
import { useSaveProgress } from "@/features/books/useBookReading";
import type { BookManifest } from "@rawkoon/shared/types";
import { ReaderSettings } from "./ReaderSettings";
import {
  DEFAULT_TYPOGRAPHY,
  THEME_COLORS,
  type ReaderDoc,
  type ReaderHandle,
  type ReaderPosition,
  type Typography,
} from "./types";

// Lazy so pdf.js and JSZip stay out of the bundle for someone reading an epub.
const EpubRenderer = lazy(() => import("./renderers/EpubRenderer"));
const PdfRenderer = lazy(() => import("./renderers/PdfRenderer"));
const CbzRenderer = lazy(() => import("./renderers/CbzRenderer"));

const TYPOGRAPHY_KEY = "rawkoon:reader:typography";
const IDLE_MS = 3000;
const SAVE_DEBOUNCE_MS = 1500;

const loadTypography = (): Typography => {
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_KEY);
    return raw
      ? { ...DEFAULT_TYPOGRAPHY, ...(JSON.parse(raw) as Partial<Typography>) }
      : DEFAULT_TYPOGRAPHY;
  } catch {
    return DEFAULT_TYPOGRAPHY;
  }
};

interface ReaderShellProps {
  manifest: BookManifest;
  onClose: () => void;
}

/**
 * The reader is a mode, not a page: it renders outside the app shell, and its
 * chrome fades once you start reading. Everything format-specific lives in a
 * renderer; this owns chrome, typography, the rail, the keyboard and saving.
 */
export const ReaderShell = ({ manifest, onClose }: ReaderShellProps) => {
  const { t } = useTranslation("common");
  const [typography, setTypography] = useState(loadTypography);
  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [position, setPosition] = useState<ReaderPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [panel, setPanel] = useState<"toc" | "type" | null>(null);
  const handleRef = useRef<ReaderHandle | null>(null);
  const idleTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  const save = useSaveProgress(manifest.edition_id);
  // The mutation object's identity changes on every render. Callbacks handed to
  // a renderer must be stable — a renderer that remounts mid-initialisation
  // leaves epub.js destroying a rendition it never rendered, which throws.
  const saveRef = useRef(save);
  saveRef.current = save;
  const file = useMemo(
    () =>
      manifest.files.find((f) => f.id === manifest.primary_file_id) ??
      manifest.files[0],
    [manifest],
  );

  useEffect(() => {
    localStorage.setItem(TYPOGRAPHY_KEY, JSON.stringify(typography));
  }, [typography]);

  const toggleChrome = useCallback(() => {
    setChromeVisible((visible) => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      if (!visible) {
        idleTimer.current = window.setTimeout(
          () => setChromeVisible(false),
          IDLE_MS,
        );
      }
      return !visible;
    });
  }, []);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(
      () => setChromeVisible(false),
      IDLE_MS,
    );
  }, []);

  useEffect(() => {
    showChrome();
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [showChrome]);

  const onPosition = useCallback((next: ReaderPosition) => {
    setPosition(next);
    // Debounced: paging quickly must not queue a write per page turn.
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveRef.current.mutate({
        locator: next.locator,
        percent: next.percent,
        finished: next.percent >= 0.995,
        client_updated_at: new Date().toISOString(),
      });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const onReady = useCallback((ready: ReaderDoc) => setDoc(ready), []);
  const onError = useCallback((message: string) => setError(message), []);
  const setHandle = useCallback((handle: ReaderHandle | null) => {
    handleRef.current = handle;
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        handleRef.current?.next();
        showChrome();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        handleRef.current?.prev();
        showChrome();
      } else if (event.key === "Escape") {
        if (panel) setPanel(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, panel, showChrome]);

  const colors = THEME_COLORS[typography.theme];
  const reflowable = file?.format === "epub";

  const rendererProps = file
    ? {
        url: BOOKS_ENDPOINTS.FILE_CONTENT(file.id),
        initialLocator: manifest.progress?.locator ?? null,
        typography,
        onReady,
        onPosition,
        onError,
        handleRef: setHandle,
      }
    : null;

  if (!file || !file.readable) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-surface-base px-6 text-center">
        <AlertTriangle className="size-8 text-primary-400" />
        <p className="max-w-sm text-text">
          {t("books.reader.unreadableFormat", { format: file?.format ?? "" })}
        </p>
        <div className="flex gap-3">
          {file && (
            <a
              href={BOOKS_ENDPOINTS.FILE_CONTENT(file.id)}
              download={file.file_name}
              className="focus-ring inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text hover:text-text-strong"
            >
              <Download className="size-4" />
              {t("books.reader.download")}
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md bg-primary-600 px-3 py-2 text-sm text-neutral-50"
          >
            {t("books.reader.back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col"
      style={{ background: colors.background, color: colors.foreground }}
      // Mice only: a touch tap must not both reveal the chrome here and toggle
      // it in the tap zone, which cancelled out and left it hidden.
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") showChrome();
      }}
    >
      <header
        className={cn(
          "absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 py-2 motion-safe:transition-opacity motion-safe:duration-200",
          chromeVisible || panel
            ? "opacity-100"
            : "pointer-events-none opacity-0",
        )}
        style={{ background: `${colors.background}f2` }}
      >
        <button
          type="button"
          onClick={() => setPanel(panel === "toc" ? null : "toc")}
          className="focus-ring rounded-md p-2 opacity-70 hover:opacity-100"
          aria-label={t("books.reader.contents")}
          aria-pressed={panel === "toc"}
        >
          <List className="size-5" />
        </button>
        <span className="min-w-0 flex-1 truncate font-display text-sm">
          {manifest.title}
        </span>
        {reflowable && (
          <button
            type="button"
            onClick={() => setPanel(panel === "type" ? null : "type")}
            className="focus-ring rounded-md p-2 opacity-70 hover:opacity-100"
            aria-label={t("books.reader.typography")}
            aria-pressed={panel === "type"}
          >
            <Type className="size-5" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="focus-ring rounded-md p-2 opacity-70 hover:opacity-100"
          aria-label={t("books.reader.close")}
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <AlertTriangle className="size-8 text-primary-400" />
              <p className="max-w-sm">{t("books.reader.openFailed")}</p>
              <a
                href={BOOKS_ENDPOINTS.FILE_CONTENT(file.id)}
                download={file.file_name}
                className="focus-ring inline-flex items-center gap-2 rounded-md border border-current px-3 py-2 text-sm opacity-80 hover:opacity-100"
              >
                <Download className="size-4" />
                {t("books.reader.download")}
              </a>
            </div>
          ) : (
            rendererProps && (
              <Suspense fallback={null}>
                {file.format === "epub" && <EpubRenderer {...rendererProps} />}
                {file.format === "pdf" && <PdfRenderer {...rendererProps} />}
                {file.format === "cbz" && <CbzRenderer {...rendererProps} />}
              </Suspense>
            )
          )}

          {/*
            The epub iframe swallows pointer events, so page turns and bringing
            the chrome back need their own surface above it: sides turn pages,
            the middle toggles the chrome. Only in paginated flow — a scrolled
            book has to keep scrolling. The footer buttons remain the accessible
            controls, so these are hidden from assistive technology.
          */}
          {!error && !panel && typography.flow === "paginated" && (
            <div className="absolute inset-0 z-[5] flex" aria-hidden="true">
              <button
                type="button"
                tabIndex={-1}
                className="h-full w-[28%]"
                onClick={() => handleRef.current?.prev()}
              />
              <button
                type="button"
                tabIndex={-1}
                className="h-full flex-1"
                onClick={toggleChrome}
              />
              <button
                type="button"
                tabIndex={-1}
                className="h-full w-[28%]"
                onClick={() => handleRef.current?.next()}
              />
            </div>
          )}
        </div>

        {/* The rail lives on the right edge: clear of the text, in reach of a thumb. */}
        <div className="hidden w-6 shrink-0 py-10 sm:block">
          <ChapterRail
            orientation="vertical"
            segments={
              doc?.toc.length
                ? doc.toc.map((entry, index) => ({
                    start: index / doc.toc.length,
                    end: (index + 1) / doc.toc.length,
                    label: entry.label,
                  }))
                : [{ start: 0, end: 1, label: manifest.title }]
            }
            position={position?.percent ?? 0}
            total={1}
            onSeek={(next) => {
              const toc = doc?.toc ?? [];
              if (toc.length === 0) return;
              const index = Math.min(
                toc.length - 1,
                Math.floor(next * toc.length),
              );
              handleRef.current?.goTo(toc[index].locator);
            }}
            formatPosition={(value) => `${Math.round(value * 100)}%`}
            ariaLabel={t("books.reader.position")}
          />
        </div>

        {panel === "toc" && (
          <nav
            className="absolute inset-y-0 left-0 z-20 w-72 max-w-[80vw] overflow-y-auto border-r border-border/40 p-4"
            style={{ background: colors.background }}
            aria-label={t("books.reader.contents")}
          >
            {doc?.toc.length ? (
              <ul>
                {doc.toc.map((entry) => (
                  <li key={entry.locator}>
                    <button
                      type="button"
                      onClick={() => {
                        handleRef.current?.goTo(entry.locator);
                        setPanel(null);
                      }}
                      className="focus-ring w-full rounded-md px-2 py-2 text-left text-sm opacity-80 hover:opacity-100"
                    >
                      {entry.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm opacity-70">
                {t("books.reader.noContents")}
              </p>
            )}
          </nav>
        )}

        {panel === "type" && reflowable && (
          <ReaderSettings
            typography={typography}
            onChange={setTypography}
            background={colors.background}
          />
        )}
      </div>

      <footer
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex items-center justify-between px-4 py-2 text-xs motion-safe:transition-opacity motion-safe:duration-200",
          chromeVisible || panel
            ? "opacity-100"
            : "pointer-events-none opacity-0",
        )}
        style={{ background: `${colors.background}f2` }}
      >
        <button
          type="button"
          onClick={() => handleRef.current?.prev()}
          className="focus-ring rounded-md px-2 py-1 opacity-70 hover:opacity-100"
        >
          {t("books.reader.previous")}
        </button>
        <span className="opacity-70">
          {position?.label ??
            (position ? `${Math.round(position.percent * 100)}%` : "")}
        </span>
        <button
          type="button"
          onClick={() => handleRef.current?.next()}
          className="focus-ring rounded-md px-2 py-1 opacity-70 hover:opacity-100"
        >
          {t("books.reader.next")}
        </button>
      </footer>
    </div>
  );
};
