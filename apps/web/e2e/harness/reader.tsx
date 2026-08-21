/**
 * Mounts the real ReaderShell outside the app, so a browser test can exercise
 * the component — its effects, its dependency lists, its teardown — without a
 * login or a database. The API is stubbed by the test through route
 * interception; the manifest is inlined here.
 *
 * This exists because two reader bugs shipped that unit tests could not see:
 * both lived in how the component drove epub.js, not in epub.js itself.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReaderShell } from "@/features/reader/ReaderShell";
import type { BookManifest } from "@rawkoon/shared/types";
import "@/lib/i18n/index";
import "@/index.css";

const manifest: BookManifest = {
  edition_id: 11,
  book_id: 1,
  kind: "ebook",
  title: "A Quiet Harbour",
  authors: ["Camille Rousseau"],
  narrators: [],
  cover_url: null,
  total_duration_secs: null,
  primary_file_id: 1,
  progress: null,
  files: [
    {
      id: 1,
      file_name: "A Quiet Harbour.epub",
      format: "epub",
      size_bytes: "4096",
      duration_secs: null,
      offset_secs: 0,
      readable: true,
      chapters: [],
      content_url: "/api/books/files/1/content",
    },
  ],
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

// Counts how many times the shell rendered, so a test can prove that parent
// re-renders do not remount the renderer underneath.
declare global {
  interface Window {
    __READER_RENDERS__: number;
  }
}
window.__READER_RENDERS__ = 0;

const Harness = () => {
  window.__READER_RENDERS__ += 1;
  return <ReaderShell manifest={manifest} onClose={() => {}} />;
};

createRoot(document.getElementById("root")!).render(
  // StrictMode double-invokes effects, which is how an unmount during load —
  // the crash this harness was written for — reproduces reliably.
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  </StrictMode>,
);
