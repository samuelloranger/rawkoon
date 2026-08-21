import { useEffect, useRef, useState } from "react";
import { THEME_COLORS, type RendererProps } from "../types";

/**
 * Pdf, through pdf.js.
 *
 * A pdf has a fixed layout, so there is nothing to reflow: typography controls
 * do not apply and the shell hides them rather than showing dead ones. Pages
 * render to canvas with a text layer over them, so selection and search in the
 * browser still work.
 *
 * pdf.js is loaded on demand — it is the largest dependency in the reader, and
 * someone reading epubs should never pay for it.
 */
const PdfRenderer = ({
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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<{
    numPages: number;
    getPage: (n: number) => Promise<unknown>;
  } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [page, setPage] = useState(() => {
    const parsed = Number(initialLocator?.replace("page:", ""));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // The worker ships with the package; Vite resolves it as a URL asset.
        const workerUrl = (
          await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        ).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const doc = await pdfjs.getDocument({ url, withCredentials: true })
          .promise;
        if (cancelled) return;
        docRef.current = doc as unknown as typeof docRef.current;
        callbacks.current.onReady({
          toc: [],
          totalPages: doc.numPages,
        });
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
      renderTaskRef.current?.cancel();
      docRef.current = null;
    };
    // Callbacks live in a ref: a changing identity would refetch the document
    // on every parent render.
  }, [url]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;

    const render = async () => {
      try {
        const pdfPage = (await doc.getPage(page)) as {
          getViewport: (opts: { scale: number }) => {
            width: number;
            height: number;
          };
          render: (opts: unknown) => {
            promise: Promise<void>;
            cancel: () => void;
          };
        };
        if (cancelled) return;

        // Fit the page to the container width, capped so a small window does
        // not render a 4000px canvas.
        const parentWidth = canvas.parentElement?.clientWidth ?? 800;
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(
          3,
          (parentWidth - typography.marginPx * 2) / unscaled.width,
        );
        const viewport = pdfPage.getViewport({ scale: Math.max(0.2, scale) });

        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        renderTaskRef.current?.cancel();
        const task = pdfPage.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;

        callbacks.current.onPosition({
          locator: `page:${page}`,
          percent: doc.numPages > 0 ? page / doc.numPages : 0,
          label: `${page} / ${doc.numPages}`,
        });
      } catch (err) {
        // A cancelled render is the normal result of paging quickly.
        if (
          !cancelled &&
          !(err instanceof Error && err.name === "RenderingCancelledException")
        ) {
          callbacks.current.onError(
            err instanceof Error ? err.message : "unreadable",
          );
        }
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [page, typography.marginPx]);

  useEffect(() => {
    handleRef({
      goTo: (locator) => {
        const parsed = Number(locator.replace("page:", ""));
        if (Number.isInteger(parsed) && parsed > 0) setPage(parsed);
      },
      next: () =>
        setPage((current) =>
          Math.min(docRef.current?.numPages ?? current, current + 1),
        ),
      prev: () => setPage((current) => Math.max(1, current - 1)),
      applyTypography: () => {},
    });
    return () => handleRef(null);
  }, [handleRef]);

  return (
    <div
      className="flex h-full w-full items-start justify-center overflow-auto"
      style={{ background: THEME_COLORS[typography.theme].background }}
    >
      <canvas ref={canvasRef} className="my-6 shadow-lg" />
    </div>
  );
};

export default PdfRenderer;
