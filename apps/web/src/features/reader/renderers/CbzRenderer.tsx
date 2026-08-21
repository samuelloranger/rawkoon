import { useEffect, useRef, useState } from "react";
import { THEME_COLORS, type RendererProps } from "../types";

/**
 * Cbz: a zip of images, one per page.
 *
 * Object URLs are created for the page on screen and its neighbours only, and
 * revoked as they leave that window. Decoding a 400-page volume up front would
 * hold hundreds of megabytes for pages nobody is looking at.
 */
const IMAGE_PATTERN = /\.(jpe?g|png|gif|webp|avif)$/i;
const WINDOW = 1;

const CbzRenderer = ({
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

  const entriesRef = useRef<Array<{ name: string; blob: () => Promise<Blob> }>>(
    [],
  );
  const urlsRef = useRef(new Map<number, string>());
  const [page, setPage] = useState(() => {
    const parsed = Number(initialLocator?.replace("page:", ""));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  });
  const [src, setSrc] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { default: JSZip } = await import("jszip");
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const zip = await JSZip.loadAsync(await response.blob());
        if (cancelled) return;

        const entries = Object.values(zip.files)
          .filter((file) => !file.dir && IMAGE_PATTERN.test(file.name))
          // "page 2" before "page 10": a comic's filenames are numbered.
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true }),
          )
          .map((file) => ({
            name: file.name,
            blob: () => file.async("blob"),
          }));

        if (entries.length === 0) throw new Error("no images");

        entriesRef.current = entries;
        setTotal(entries.length);
        callbacks.current.onReady({ toc: [], totalPages: entries.length });
      } catch (err) {
        if (!cancelled) {
          callbacks.current.onError(
            err instanceof Error ? err.message : "unreadable",
          );
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      for (const objectUrl of urlsRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      urlsRef.current.clear();
      entriesRef.current = [];
    };
    // Callbacks live in a ref: a changing identity would re-download and
    // re-unzip the archive on every parent render.
  }, [url]);

  useEffect(() => {
    if (total === 0) return;
    let cancelled = false;

    const show = async () => {
      const urls = urlsRef.current;

      // Drop everything outside the window first, so memory never holds more
      // than three decoded pages.
      for (const [index, objectUrl] of urls) {
        if (Math.abs(index - page) > WINDOW) {
          URL.revokeObjectURL(objectUrl);
          urls.delete(index);
        }
      }

      for (let index = page - WINDOW; index <= page + WINDOW; index++) {
        if (index < 1 || index > total || urls.has(index)) continue;
        const entry = entriesRef.current[index - 1];
        if (!entry) continue;
        const objectUrl = URL.createObjectURL(await entry.blob());
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        urls.set(index, objectUrl);
      }

      setSrc(urls.get(page) ?? null);
      callbacks.current.onPosition({
        locator: `page:${page}`,
        percent: page / total,
        label: `${page} / ${total}`,
      });
    };

    void show();
    return () => {
      cancelled = true;
    };
  }, [page, total]);

  useEffect(() => {
    handleRef({
      goTo: (locator) => {
        const parsed = Number(locator.replace("page:", ""));
        if (Number.isInteger(parsed) && parsed > 0) setPage(parsed);
      },
      next: () => setPage((current) => Math.min(total || current, current + 1)),
      prev: () => setPage((current) => Math.max(1, current - 1)),
      applyTypography: () => {},
    });
    return () => handleRef(null);
  }, [handleRef, total]);

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-auto"
      style={{ background: THEME_COLORS[typography.theme].background }}
    >
      {src && (
        <img
          src={src}
          alt={`${page}`}
          className="max-h-full max-w-full object-contain"
        />
      )}
    </div>
  );
};

export default CbzRenderer;
