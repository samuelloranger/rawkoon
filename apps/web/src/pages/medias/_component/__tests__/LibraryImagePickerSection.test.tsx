import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ArtworkCandidate, LibraryMedia } from "@rawkoon/shared/types";
import { LibraryImagePickerSection } from "@/pages/medias/_component/LibraryImagePickerSection";

const mutateAsync = vi.fn(() => Promise.resolve({}));
let candidates: ArtworkCandidate[] = [];
let lastKind = "";
let isLoading = false;

vi.mock("@/features/medias/hooks/useArtworkCandidates", () => ({
  useArtworkCandidates: (_id: number, kind: string, enabled: boolean) => {
    lastKind = kind;
    return {
      data: enabled ? { candidates } : undefined,
      isLoading,
      isError: false,
    };
  },
}));

vi.mock("@/features/medias/hooks/useUpdateLibraryArtwork", () => ({
  useUpdateLibraryArtwork: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const candidate = (
  url: string,
  language: string | null,
  source: "tmdb" | "fanart" = "tmdb",
): ArtworkCandidate => ({
  url,
  thumb_url: `${url}?thumb`,
  width: 100,
  height: 150,
  language,
  vote: 1,
  source,
});

const item = (patch: Partial<LibraryMedia> = {}) =>
  ({
    id: 7,
    title: "X",
    poster_url: null,
    backdrop_url: null,
    overrides: {},
    ...patch,
  }) as LibraryMedia;

/** A media whose artwork has been overridden to `url`. */
const overridden = (url: string) =>
  item({ poster_url: url, overrides: { poster_url: url } });

const grid = () => screen.getByTestId("artwork-grid");

describe("LibraryImagePickerSection", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    isLoading = false;
    candidates = [
      candidate("https://a/1.jpg", "en"),
      candidate("https://a/2.jpg", "fr"),
      candidate("https://a/3.jpg", null, "fanart"),
    ];
  });

  it("renders a cell per candidate for the active kind", () => {
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    expect(within(grid()).getAllByRole("button")).toHaveLength(3);
  });

  it("requests posters first", () => {
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    expect(lastKind).toBe("poster");
  });

  it("describes the artwork in use rather than badging every tile", () => {
    render(
      <LibraryImagePickerSection libraryId={7} item={overridden("https://a/3.jpg")} />,
    );
    // The language-neutral fanart candidate is the one in use.
    expect(screen.getByText("fanart.tv")).toBeTruthy();
    expect(screen.queryAllByText("TMDB")).toHaveLength(0);
  });

  it("switching to the backdrop tab requests backdrops", () => {
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Backdrop/i }));
    expect(lastKind).toBe("backdrop");
  });

  it("offers one option per distinct language, plus all and no-text", () => {
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    const values = Array.from(
      screen.getByTestId("artwork-lang-select").querySelectorAll("option"),
    ).map((o) => o.getAttribute("value"));
    expect(values).toEqual(["all", "en", "fr", "none"]);
  });

  it("hides the language filter when there is nothing to filter", () => {
    candidates = [candidate("https://a/1.jpg", "en")];
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    expect(screen.queryByTestId("artwork-lang-select")).toBeNull();
  });

  it("narrows the grid to the selected language", () => {
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    fireEvent.change(screen.getByTestId("artwork-lang-select"), {
      target: { value: "fr" },
    });
    const cells = within(grid()).getAllByRole("button");
    expect(cells).toHaveLength(1);
    expect(cells[0].getAttribute("data-url")).toBe("https://a/2.jpg");
  });

  it("the no-text option shows only language-neutral candidates", () => {
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    fireEvent.change(screen.getByTestId("artwork-lang-select"), {
      target: { value: "none" },
    });
    const cells = within(grid()).getAllByRole("button");
    expect(cells).toHaveLength(1);
    expect(cells[0].getAttribute("data-url")).toBe("https://a/3.jpg");
  });

  it("says nothing matched the filter, not that there is no artwork", () => {
    candidates = [
      candidate("https://a/1.jpg", "en"),
      candidate("https://a/2.jpg", "fr"),
    ];
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    fireEvent.change(screen.getByTestId("artwork-lang-select"), {
      target: { value: "none" },
    });
    expect(screen.getByTestId("artwork-empty").textContent).toContain(
      "artworkNoneInLanguage",
    );
  });

  it("puts the artwork in use first so it is visible without scrolling", () => {
    render(
      <LibraryImagePickerSection libraryId={7} item={overridden("https://a/3.jpg")} />,
    );
    const cells = within(grid()).getAllByRole("button");
    expect(cells[0].getAttribute("data-url")).toBe("https://a/3.jpg");
    expect(cells[0].getAttribute("data-current")).toBe("true");
  });

  it("marks the cell matching the current poster", () => {
    render(
      <LibraryImagePickerSection libraryId={7} item={overridden("https://a/2.jpg")} />,
    );
    const cells = within(grid()).getAllByRole("button");
    const current = cells.filter(
      (c) => c.getAttribute("data-current") === "true",
    );
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("data-url")).toBe("https://a/2.jpg");
  });

  it("clicking a cell saves that candidate's full url", () => {
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    fireEvent.click(within(grid()).getAllByRole("button")[1]);
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 7,
      kind: "poster",
      url: "https://a/2.jpg",
    });
  });

  it("reset clears the override and is hidden with no override set", () => {
    const { rerender } = render(
      <LibraryImagePickerSection libraryId={7} item={item()} />,
    );
    expect(screen.queryByTestId("artwork-reset")).toBeNull();

    rerender(
      <LibraryImagePickerSection libraryId={7} item={overridden("https://a/1.jpg")} />,
    );
    fireEvent.click(screen.getByTestId("artwork-reset"));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 7,
      kind: "poster",
      url: null,
    });
  });

  it("marks the stored poster even when it is a different size variant", () => {
    // The library stores a w500 URL; candidates come back as `original`.
    render(
      <LibraryImagePickerSection
        libraryId={7}
        item={item({ poster_url: "https://image.tmdb.org/t/p/w500/2.jpg" })}
      />,
    );
    const cells = within(grid()).getAllByRole("button");
    const current = cells.filter(
      (c) => c.getAttribute("data-current") === "true",
    );
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("data-url")).toBe("https://a/2.jpg");
  });

  it("offers no reset when the artwork is the untouched default", () => {
    render(
      <LibraryImagePickerSection
        libraryId={7}
        item={item({ poster_url: "https://a/1.jpg" })}
      />,
    );
    expect(screen.queryByTestId("artwork-reset")).toBeNull();
  });

  it("renders an empty state rather than a blank grid", () => {
    candidates = [];
    render(<LibraryImagePickerSection libraryId={7} item={item()} />);
    expect(screen.queryByTestId("artwork-grid")).toBeNull();
    expect(screen.getByTestId("artwork-empty")).toBeTruthy();
  });
});
