import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { EditionOpenActions } from "@/features/books/EditionOpenActions";
import type { BookEdition } from "@rawkoon/shared/types";

const files = vi.fn();
vi.mock("@/pages/books/_hooks/useBooks", () => ({
  useEditionFiles: () => files(),
}));

const load = vi.fn();
vi.mock("@/features/player/PlayerProvider", () => ({
  usePlayer: () => ({ load }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

const edition = (over: Partial<BookEdition> = {}) =>
  ({
    id: 1,
    kind: "audiobook",
    file_count: 1,
    status: "downloaded",
    offline_ready: false,
    ...over,
  }) as BookEdition;

describe("EditionOpenActions", () => {
  it("does not offer Listen when the audiobook is not offline_ready", () => {
    files.mockReturnValue({ data: undefined, isLoading: false });
    renderWithProviders(<EditionOpenActions edition={edition()} bookId={10} />);
    expect(
      screen.queryByRole("button", { name: "books.listen.open" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "books.listen.open" }),
    ).toBeNull();
  });

  it("offers Listen when the audiobook is offline_ready", () => {
    files.mockReturnValue({ data: undefined, isLoading: false });
    renderWithProviders(
      <EditionOpenActions
        edition={edition({ offline_ready: true })}
        bookId={10}
      />,
    );
    expect(
      screen.getByRole("button", { name: "books.listen.open" }),
    ).toBeTruthy();
  });

  it("does not offer Read on an audiobook", () => {
    files.mockReturnValue({
      data: { files: [{ format: "epub" }] },
      isLoading: false,
    });
    renderWithProviders(
      <EditionOpenActions
        edition={edition({ offline_ready: true })}
        bookId={10}
      />,
    );
    expect(screen.queryByRole("link", { name: "books.read.open" })).toBeNull();
  });

  it("offers Read when the ebook has an EPUB", () => {
    files.mockReturnValue({
      data: { files: [{ format: "epub" }] },
      isFetched: true,
      isLoading: false,
    });
    renderWithProviders(
      <EditionOpenActions
        edition={edition({ kind: "ebook", offline_ready: false })}
        bookId={10}
      />,
    );
    expect(screen.getByRole("link", { name: "books.read.open" })).toBeTruthy();
  });
});
