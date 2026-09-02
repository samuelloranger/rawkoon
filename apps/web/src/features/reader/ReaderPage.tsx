import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, List, Settings } from "lucide-react";
import {
  EpubNavigator,
  EpubPreferences,
  type EpubNavigatorListeners,
} from "@readium/navigator";
import { Locator, LocatorLocations, type Publication } from "@readium/shared";
import { Button } from "@/components/ui/button";
import { useBook, useEditionFiles } from "@/pages/books/_hooks/useBooks";
import {
  putReadingProgress,
  useReadingProgress,
} from "@/features/player/usePlayback";
import { webDeviceId } from "@/features/player/deviceId";
import { queryKeys } from "@/lib/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import { resolveReadingPosition } from "./resumeLocator";
import { spinePositions } from "./spinePositions";
import { openPublication } from "./openEpub";
import {
  epubPrefsFromReader,
  loadReaderPreferences,
  saveReaderPreferences,
  type ReaderPreferences,
  type ReaderTheme,
} from "./readerPreferences";
import type { BookReadingProgress } from "@rawkoon/shared/types";

const PERSIST_MS = 3_000;

function spineHrefs(publication: Publication): string[] {
  return publication.readingOrder.items.map((l) => l.href);
}

function resumeLocator(
  publication: Publication,
  progress: BookReadingProgress | undefined,
): Locator | undefined {
  if (progress?.locator) {
    try {
      const parsed = Locator.deserialize(JSON.parse(progress.locator));
      if (parsed) return parsed;
    } catch {
      // Fall through to the coarse spine resume.
    }
  }
  if (!progress) return undefined;
  const hrefs = spineHrefs(publication);
  const resolved = resolveReadingPosition(progress, hrefs);
  const link = publication.readingOrder.items[resolved.index];
  if (!link) return undefined;
  return new Locator({
    href: link.href,
    type: link.type ?? "application/xhtml+xml",
    locations: new LocatorLocations({
      progression: resolved.scrollFraction,
    }),
  });
}

export function ReaderPage({ bookId }: { bookId: number }) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading: bookLoading } = useBook(bookId);
  const book = data?.item;
  const edition = book?.editions.find((e) => e.kind === "ebook");
  const files = useEditionFiles(bookId, "ebook", Boolean(edition));
  const epub = files.data?.files.find((f) => f.format === "epub");
  const progressQuery = useReadingProgress();
  const progress = progressQuery.data?.progress.find(
    (row) => row.edition_id === edition?.id,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<EpubNavigator | null>(null);
  const pubRef = useRef<Publication | null>(null);
  const lastPutRef = useRef(0);
  const persistRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [chromeOpen, setChromeOpen] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [percent, setPercent] = useState(0);
  const [prefs, setPrefs] = useState<ReaderPreferences>(loadReaderPreferences);

  const persist = async (force = false) => {
    const nav = navRef.current;
    const pub = pubRef.current;
    if (!nav || !pub || !edition || !epub) return;
    if (!force && Date.now() - lastPutRef.current < PERSIST_MS) return;
    lastPutRef.current = Date.now();
    const locator = nav.currentLocator;
    const hrefs = spineHrefs(pub);
    const index = Math.max(
      0,
      hrefs.findIndex(
        (h) =>
          h === locator.href ||
          locator.href.endsWith(h) ||
          h.endsWith(locator.href),
      ),
    );
    try {
      await putReadingProgress(edition.id, {
        file_id: epub.id,
        spine_index: index,
        spine_path: hrefs[index] ?? locator.href,
        spine_count: hrefs.length,
        scroll_fraction: locator.locations.progression ?? 0,
        locator: JSON.stringify(locator.serialize()),
        finished: (locator.locations.totalProgression ?? 0) >= 0.99,
        updated_at: new Date().toISOString(),
        device_id: webDeviceId(),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.books.readingProgress(),
      });
    } catch {
      // Retry on the next tick or unmount.
    }
  };
  persistRef.current = persist;

  // Boot once per edition file. Preferences apply through submitPreferences.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity fields, not object identity
  useEffect(() => {
    if (bookLoading || files.isLoading || progressQuery.isLoading) return;
    if (!book || !edition) {
      setStatus("failed");
      return;
    }
    if (!epub?.content_url) {
      setStatus("failed");
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let navigator: EpubNavigator | undefined;

    const boot = async () => {
      try {
        const res = await fetch(epub.content_url!);
        if (!res.ok) throw new Error("fetch");
        const blob = await res.blob();
        const publication = await openPublication(blob, {
          language: book.language,
        });
        if (cancelled) return;
        pubRef.current = publication;
        const fromManifest = await publication.positionsFromManifest();
        const positions =
          fromManifest.length > 0
            ? fromManifest
            : spinePositions(publication.readingOrder.items);
        if (positions.length === 0) throw new Error("no spine");
        const initial = resumeLocator(publication, progress);
        const listeners: EpubNavigatorListeners = {
          frameLoaded: () => {},
          positionChanged: (locator) => {
            setPercent(
              Math.round((locator.locations.totalProgression ?? 0) * 100),
            );
            void persistRef.current();
          },
          timelineItemChanged: () => {},
          tap: (e) => handlePointer(e.x),
          click: (e) => handlePointer(e.x),
          zoom: () => {},
          miscPointer: () => {},
          scroll: () => {},
          customEvent: () => {},
          handleLocator: () => false,
          textSelected: () => {},
          contentProtection: () => {},
          contextMenu: () => {},
          peripheral: () => {},
        };
        const handlePointer = (x: number): boolean => {
          const width =
            container.getBoundingClientRect().width || window.innerWidth;
          const ratio = x / width;
          if (ratio < 1 / 3) {
            navigator?.goBackward(false, () => {});
            return true;
          }
          if (ratio > 2 / 3) {
            navigator?.goForward(false, () => {});
            return true;
          }
          setChromeOpen((open) => !open);
          setTocOpen(false);
          setSettingsOpen(false);
          return true;
        };
        navigator = new EpubNavigator(
          container,
          publication,
          listeners,
          positions,
          initial,
          {
            preferences: epubPrefsFromReader(prefs),
            defaults: {},
          },
        );
        navRef.current = navigator;
        await navigator.load();
        if (!cancelled) setStatus("ready");
      } catch (err) {
        console.error("reader boot failed", err);
        if (!cancelled) setStatus("failed");
      }
    };
    void boot();
    return () => {
      cancelled = true;
      void persistRef.current(true);
      void navigator?.destroy();
      navRef.current = null;
      pubRef.current = null;
    };
  }, [
    book?.id,
    book?.language,
    edition?.id,
    epub?.content_url,
    bookLoading,
    files.isLoading,
    progressQuery.isLoading,
  ]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void persistRef.current(true);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  const applyPrefs = (next: ReaderPreferences) => {
    setPrefs(next);
    saveReaderPreferences(next);
    void navRef.current?.submitPreferences(
      new EpubPreferences(epubPrefsFromReader(next)),
    );
  };

  const tocItems = pubRef.current?.toc?.items?.length
    ? pubRef.current.toc.items
    : (pubRef.current?.readingOrder.items ?? []);

  if (files.isFetched && !epub) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-neutral-400">{t("books.read.epubOnly")}</p>
        <Link
          to="/books/$bookId"
          params={{ bookId: String(bookId) }}
          className="text-sm text-primary-400 hover:underline"
        >
          {t("books.listen.back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh bg-neutral-950">
      <div ref={containerRef} className="h-dvh w-full" />
      {status === "loading" && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
          {t("books.detail.loading")}
        </p>
      )}
      {status === "failed" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
          <p className="text-sm text-neutral-400">
            {t("books.read.openFailed")}
          </p>
          <Link
            to="/books/$bookId"
            params={{ bookId: String(bookId) }}
            className="text-sm text-primary-400 hover:underline"
          >
            {t("books.listen.back")}
          </Link>
        </div>
      )}
      {chromeOpen && status === "ready" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[var(--z-sticky)] bg-gradient-to-b from-black/80 to-transparent p-3">
          <div className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("books.listen.back")}
              onClick={() => {
                void persist(true);
                void navigate({
                  to: "/books/$bookId",
                  params: { bookId: String(bookId) },
                });
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-0 flex-1 truncate font-display text-sm text-neutral-100">
              {book?.title}
            </p>
            <span className="font-mono text-xs text-neutral-400">
              {percent}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("books.read.contents")}
              onClick={() => {
                setTocOpen((o) => !o);
                setSettingsOpen(false);
              }}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("books.read.settings")}
              onClick={() => {
                setSettingsOpen((o) => !o);
                setTocOpen(false);
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      {tocOpen && (
        <aside className="absolute inset-y-0 right-0 z-[var(--z-sticky)] w-72 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
            {t("books.read.contents")}
          </h2>
          <ol className="space-y-1">
            {tocItems.map((item) => (
              <li key={item.href}>
                <button
                  type="button"
                  className="focus-ring w-full truncate rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                  onClick={() => {
                    navRef.current?.goLink(item, false, () => {});
                    setTocOpen(false);
                  }}
                >
                  {item.title ?? item.href}
                </button>
              </li>
            ))}
          </ol>
        </aside>
      )}
      {settingsOpen && (
        <aside className="absolute inset-y-0 right-0 z-[var(--z-sticky)] w-72 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-200">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
            {t("books.read.settings")}
          </h2>
          <label className="mb-4 block">
            {t("books.read.fontSize")}
            <input
              type="range"
              min={0.8}
              max={2}
              step={0.05}
              value={prefs.fontSize}
              className="mt-1 w-full accent-primary-500"
              onChange={(e) =>
                applyPrefs({ ...prefs, fontSize: Number(e.target.value) })
              }
            />
          </label>
          <label className="mb-4 block">
            {t("books.read.lineHeight")}
            <input
              type="range"
              min={1.2}
              max={2.2}
              step={0.05}
              value={prefs.lineHeight}
              className="mt-1 w-full accent-primary-500"
              onChange={(e) =>
                applyPrefs({ ...prefs, lineHeight: Number(e.target.value) })
              }
            />
          </label>
          <label className="mb-4 block">
            {t("books.read.margins")}
            <input
              type="range"
              min={8}
              max={48}
              step={2}
              value={prefs.pageGutter}
              className="mt-1 w-full accent-primary-500"
              onChange={(e) =>
                applyPrefs({ ...prefs, pageGutter: Number(e.target.value) })
              }
            />
          </label>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-neutral-400">
              {t("books.read.theme")}
            </legend>
            {(["light", "sepia", "dark"] as ReaderTheme[]).map((theme) => (
              <label key={theme} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="theme"
                  checked={prefs.theme === theme}
                  onChange={() => applyPrefs({ ...prefs, theme })}
                />
                {t(`books.read.theme_${theme}`)}
              </label>
            ))}
          </fieldset>
        </aside>
      )}
    </div>
  );
}
