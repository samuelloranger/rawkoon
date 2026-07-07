import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TmdbSearchModal } from "../TmdbSearchModal";

vi.mock("@/pages/medias/_component/TmdbMediaSearchPanel", () => ({
  TmdbMediaSearchPanel: ({ variant }: { variant: string }) => (
    <div data-testid="tmdb-panel" data-variant={variant} />
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("TmdbSearchModal", () => {
  it("renders the search panel when open", () => {
    render(<TmdbSearchModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId("tmdb-panel")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<TmdbSearchModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
