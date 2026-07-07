import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";
import { WidgetGrid } from "@/pages/_component/WidgetGrid";

vi.mock("@/pages/_component/NowWatchingWidget", () => ({
  NowWatchingWidget: () => <div data-testid="w-nowwatching" />,
}));
vi.mock("@/pages/_component/DownloadsPanel", () => ({
  DownloadsPanel: () => <div data-testid="w-downloads" />,
}));
vi.mock("@/pages/_component/LibraryAttentionPanel", () => ({
  LibraryAttentionPanel: () => <div data-testid="w-library" />,
}));
vi.mock("@/pages/_component/RssStatusPanel", () => ({
  RssStatusPanel: () => <div data-testid="w-rss" />,
}));

describe("WidgetGrid", () => {
  it("renders all four widgets", () => {
    renderWithProviders(<WidgetGrid />);
    for (const id of ["w-nowwatching", "w-downloads", "w-library", "w-rss"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});
