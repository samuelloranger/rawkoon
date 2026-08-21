import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChapterRail } from "@/features/books/ChapterRail";

// The rail's segment widths are information — a long chapter has to look long —
// so the proportions and the seek mapping are what these tests hold.

const segments = [
  { start: 0, end: 600, label: "One" },
  { start: 600, end: 1800, label: "Two" },
];

describe("ChapterRail", () => {
  it("exposes the position to assistive technology", () => {
    render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    const slider = screen.getByRole("slider", { name: "Position" });
    expect(slider).toHaveAttribute("aria-valuenow", "900");
    expect(slider).toHaveAttribute("aria-valuemax", "1800");
  });

  it("draws the played fill in proportion to the position", () => {
    const { container } = render(
      <ChapterRail
        segments={segments}
        position={450}
        total={1800}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    const fill = container.querySelector(".bg-primary-600") as HTMLElement;
    expect(fill.style.width).toBe("25.0000%");
  });

  it("places a chapter division where the chapter starts, not at the midpoint", () => {
    const { container } = render(
      <ChapterRail
        segments={segments}
        position={0}
        total={1800}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    const division = container.querySelector(".bg-surface-base") as HTMLElement;
    expect(division.style.left).toBe("33.3333%");
  });

  it("steps the position with the arrow keys", () => {
    const onSeek = vi.fn();
    render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        onSeek={onSeek}
        ariaLabel="Position"
      />,
    );

    const slider = screen.getByRole("slider", { name: "Position" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledWith(918);

    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenCalledWith(882);
  });

  it("jumps to either end with Home and End", () => {
    const onSeek = vi.fn();
    render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        onSeek={onSeek}
        ariaLabel="Position"
      />,
    );

    const slider = screen.getByRole("slider", { name: "Position" });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onSeek).toHaveBeenCalledWith(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onSeek).toHaveBeenCalledWith(1800);
  });

  it("reverses the arrow keys when the rail runs vertically", () => {
    const onSeek = vi.fn();
    render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        orientation="vertical"
        onSeek={onSeek}
        ariaLabel="Position"
      />,
    );

    const slider = screen.getByRole("slider", { name: "Position" });
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onSeek).toHaveBeenCalledWith(918);
  });

  it("draws buffered ranges under the fill", () => {
    const { container } = render(
      <ChapterRail
        segments={segments}
        position={0}
        total={1800}
        buffered={[{ start: 0, end: 900 }]}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    const buffered = container.querySelector(".bg-neutral-700") as HTMLElement;
    expect(buffered.style.width).toBe("50.0000%");
  });

  it("survives a zero total instead of dividing by it", () => {
    render(
      <ChapterRail
        segments={[]}
        position={0}
        total={0}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );
    expect(
      screen.getByRole("slider", { name: "Position" }),
    ).toBeInTheDocument();
  });
});
