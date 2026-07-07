import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { PosterRail } from "@/pages/_component/PosterRail";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

describe("PosterRail", () => {
  const items = [
    { id: "1", title: "Dune", posterUrl: "/p/1.jpg", libraryId: 1 },
    { id: "2", title: "Arrival", posterUrl: "/p/2.jpg", libraryId: 2 },
  ];
  it("renders the title and one card per item", () => {
    renderWithProviders(
      <PosterRail title="Recently added" items={items} isLoading={false} />,
    );
    expect(screen.getByText("Recently added")).toBeInTheDocument();
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(screen.getByText("Arrival")).toBeInTheDocument();
  });
  it("shows skeletons while loading", () => {
    renderWithProviders(
      <PosterRail title="Recently added" items={[]} isLoading />,
    );
    expect(screen.getByTestId("poster-rail-skeleton")).toBeInTheDocument();
  });
  it("renders the empty state when not loading and no items", () => {
    renderWithProviders(
      <PosterRail
        title="Recently added"
        items={[]}
        isLoading={false}
        emptyLabel="Nothing added yet"
      />,
    );
    expect(screen.getByText("Nothing added yet")).toBeInTheDocument();
  });
  it("navigates internal library items client-side, never opening a new tab", () => {
    renderWithProviders(
      <PosterRail title="Recently added" items={items} isLoading={false} />,
    );
    const dune = screen.getByRole("button", { name: "Dune" });
    expect(dune).not.toHaveAttribute("target");
    fireEvent.click(dune);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/library/$libraryId",
      params: { libraryId: "1" },
    });
  });
  it("opens external href items in a new tab", () => {
    renderWithProviders(
      <PosterRail
        title="Links"
        items={[
          {
            id: "e",
            title: "External",
            posterUrl: null,
            href: "https://example.com",
          },
        ]}
        isLoading={false}
      />,
    );
    const link = screen.getByRole("link", { name: "External" });
    expect(link).toHaveAttribute("target", "_blank");
  });
});
