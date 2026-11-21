import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let contentUrl = "/api/books/files/7/content?grant=first";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/pages/books/_hooks/useBooks", () => ({
  useBook: () => ({
    isLoading: false,
    data: {
      item: { id: 3, language: "en", editions: [{ id: 5, kind: "ebook" }] },
    },
  }),
  useEditionFiles: () => ({
    isLoading: false,
    data: {
      files: [{ id: 7, format: "epub", content_url: contentUrl }],
    },
  }),
}));
vi.mock("@/features/player/usePlayback", () => ({
  putReadingProgress: vi.fn(),
  useReadingProgress: () => ({ isLoading: false, data: { progress: [] } }),
}));

const openPublication = vi.fn(async (_blob: Blob, _options?: unknown) => ({
  positionsFromManifest: async () => [],
  readingOrder: { items: [{ href: "chapter-1.xhtml" }] },
}));
vi.mock("./openEpub", () => ({
  openPublication: (blob: Blob, options?: unknown) =>
    openPublication(blob, options),
}));
vi.mock("@readium/navigator", () => ({
  EpubPreferences: class {},
  EpubNavigator: class {
    currentLocator = { href: "chapter-1.xhtml", locations: {} };
    async load() {}
    async destroy() {}
    submitPreferences() {}
  },
}));

const { ReaderPage } = await import("./ReaderPage");

describe("ReaderPage", () => {
  beforeEach(() => {
    openPublication.mockClear();
    contentUrl = "/api/books/files/7/content?grant=first";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["epub"]))),
    );
  });

  it("keeps the open book when a refetch mints a new grant URL for the same file", async () => {
    const view = render(<ReaderPage bookId={3} />);
    await waitFor(() => expect(openPublication).toHaveBeenCalledTimes(1));

    contentUrl = "/api/books/files/7/content?grant=second";
    view.rerender(<ReaderPage bookId={3} />);
    await new Promise((r) => setTimeout(r, 20));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(openPublication).toHaveBeenCalledTimes(1);
  });
});
