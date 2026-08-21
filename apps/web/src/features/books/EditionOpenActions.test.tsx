import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { EditionOpenActions } from "@/features/books/EditionOpenActions";
import type { BookEdition } from "@rawkoon/shared/types";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/features/player/PlayerProvider", () => ({
  usePlayer: () => ({ openEdition: vi.fn() }),
}));

vi.mock("@/features/books/OfflineButton", () => ({
  OfflineButton: () => null,
}));

// Both the manifest and the progress list go through fetchApi, as does the
// reset itself, so this one mock answers all three.
const fetchApi = vi.fn();
vi.mock("@/lib/api/client", () => ({
  fetchApi: (...args: unknown[]) => fetchApi(...args),
}));

const edition = {
  id: 5,
  kind: "ebook",
  file_count: 1,
} as unknown as BookEdition;

const manifest = {
  manifest: {
    edition_id: 5,
    primary_file_id: 77,
    files: [{ id: 77 }],
  },
};

/** Answers whichever of the three endpoints is being called. */
const respondWith = (percent: number) =>
  fetchApi.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === "PUT") return Promise.resolve({ accepted: true });
    if (url.includes("/progress")) {
      return Promise.resolve({
        progress: [{ edition_id: 5, percent, position_secs: null }],
      });
    }
    return Promise.resolve(manifest);
  });

describe("EditionOpenActions", () => {
  it("offers no restart until the book has been started", async () => {
    respondWith(0);
    renderWithProviders(<EditionOpenActions bookId={42} edition={edition} />);

    await waitFor(() =>
      expect(screen.getByText("books.open.read")).toBeInTheDocument(),
    );
    expect(screen.queryByText("books.open.restart")).not.toBeInTheDocument();
  });

  it("clears the saved position once the restart is confirmed", async () => {
    respondWith(0.42);
    renderWithProviders(<EditionOpenActions bookId={42} edition={edition} />);

    await waitFor(() =>
      expect(screen.getByText("books.open.restart")).toBeInTheDocument(),
    );

    fetchApi.mockClear();
    fireEvent.click(screen.getByText("books.open.restart"));

    const dialog = await screen.findByRole("alertdialog");
    // Nothing is written until the dialog is answered: this discards a place in
    // a book, and a mis-tap must not.
    expect(fetchApi).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "books.open.restart" }),
    );

    await waitFor(() => expect(fetchApi).toHaveBeenCalled());
    const [url, init] = fetchApi.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe("/api/books/editions/5/progress");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    // A cleared position, not a deleted row: a delete would be recreated by a
    // write still queued on another device.
    expect(body.locator).toBeNull();
    expect(body.percent).toBe(0);
    expect(body.position_secs).toBe(0);
    expect(body.finished).toBeUndefined();
    expect(typeof body.client_updated_at).toBe("string");
  });
});
