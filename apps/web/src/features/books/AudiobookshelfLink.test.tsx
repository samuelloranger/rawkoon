import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { AudiobookshelfLink } from "@/features/books/AudiobookshelfLink";
import type { BookEdition } from "@rawkoon/shared/types";

const settings = vi.fn();
vi.mock("@/features/medias/hooks/useMediaPostProcessingSettings", () => ({
  useMediaPostProcessingSettings: () => settings(),
}));

const edition = (over: Partial<BookEdition> = {}) =>
  ({
    id: 1,
    kind: "audiobook",
    file_count: 1,
    status: "downloaded",
    ...over,
  }) as BookEdition;

const configured = {
  data: {
    settings: {
      audiobookshelf_url: "https://audiobookshelf.samlo.cloud",
      audiobookshelf_audiobook_library_id: "abs-audio",
      audiobookshelf_ebook_library_id: "abs-ebook",
    },
  },
};

describe("AudiobookshelfLink", () => {
  it("links an audiobook edition at the audiobook library", () => {
    settings.mockReturnValue(configured);
    renderWithProviders(
      <AudiobookshelfLink edition={edition()} title="Fourth Wing" />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://audiobookshelf.samlo.cloud/library/abs-audio/search?q=Fourth%20Wing",
    );
  });

  it("links an ebook edition at the ebook library", () => {
    settings.mockReturnValue(configured);
    renderWithProviders(
      <AudiobookshelfLink edition={edition({ kind: "ebook" })} title="Dune" />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://audiobookshelf.samlo.cloud/library/abs-ebook/search?q=Dune",
    );
  });

  it("opens in a new tab without leaking the referrer", () => {
    settings.mockReturnValue(configured);
    renderWithProviders(
      <AudiobookshelfLink edition={edition()} title="Dune" />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders nothing when Audiobookshelf is not configured", () => {
    settings.mockReturnValue({
      data: { settings: { audiobookshelf_url: null } },
    });
    renderWithProviders(
      <AudiobookshelfLink edition={edition()} title="Dune" />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing for an edition with no imported files", () => {
    settings.mockReturnValue(configured);
    renderWithProviders(
      <AudiobookshelfLink
        edition={edition({ file_count: 0, status: "wanted" })}
        title="Dune"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
