import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaPosterCard } from "@/components/MediaPosterCard";

// Regression guard: when used as a link (href), the card must be block-level
// and full-width so it fills its container. As an inline <a> with only
// absolutely-positioned children it collapses to 0x0 and the poster vanishes
// (this is exactly what broke the home-screen rails).
describe("MediaPosterCard link variant", () => {
  it("renders the href variant as a block, full-width anchor", () => {
    render(
      <MediaPosterCard
        posterUrl="https://image.tmdb.org/t/p/w342/x.jpg"
        title="Dune"
        href="/library/1"
      />,
    );
    const link = screen.getByRole("link", { name: "Dune" });
    expect(link).toBeInTheDocument();
    expect(link.className).toContain("w-full");
    expect(link.className).toContain("block");
    // self-sizing aspect ratio must remain so width drives height
    expect(link.className).toContain("aspect-[2/3]");
  });
});
