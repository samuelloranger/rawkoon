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

// A 9h30m audiobook across a phone-width rail puts about 100 seconds in every
// pixel: a 15s skip moved the indicator by a sixth of a pixel, so the transport
// looked broken, and a drag could not land closer than a minute and a half.
// Windowing the rail to the chapter is what makes those controls legible.
describe("ChapterRail windowed to a chapter", () => {
  const chapter = { start: 600, end: 1800 };

  it("measures the fill from the window's start, not the book's", () => {
    const { container } = render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        window={chapter}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    // 900 is halfway through the book but a quarter of the way into a chapter
    // running 600..1800. The whole point is that it reads as the latter.
    const fill = container.querySelector(".bg-primary-600") as HTMLElement;
    expect(fill.style.width).toBe("25.0000%");
  });

  it("reports the window as its range to assistive technology", () => {
    render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        window={chapter}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    const slider = screen.getByRole("slider", { name: "Position" });
    expect(slider).toHaveAttribute("aria-valuemin", "600");
    expect(slider).toHaveAttribute("aria-valuemax", "1800");
  });

  // The step is what makes an arrow key worth pressing: 1% of the book is
  // several minutes, 1% of a chapter is a few seconds.
  it("steps by a percent of the chapter and stays inside it", () => {
    const onSeek = vi.fn();
    render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        window={chapter}
        onSeek={onSeek}
        ariaLabel="Position"
      />,
    );

    const slider = screen.getByRole("slider", { name: "Position" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledWith(912); // 900 + 1200/100

    fireEvent.keyDown(slider, { key: "Home" });
    expect(onSeek).toHaveBeenLastCalledWith(600);

    fireEvent.keyDown(slider, { key: "End" });
    expect(onSeek).toHaveBeenLastCalledWith(1800);
  });

  it("clips a buffered range that starts before the window", () => {
    const { container } = render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        window={chapter}
        buffered={[{ start: 0, end: 1200 }]}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    // Buffered 0..1200 overlaps the window by 600..1200, which is half of it.
    // Unclipped this overhung the rail.
    const range = container.querySelector(".bg-neutral-700") as HTMLElement;
    expect(range.style.left).toBe("0.0000%");
    expect(range.style.width).toBe("50.0000%");
  });

  it("draws no division for a chapter the window does not show", () => {
    const { container } = render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        window={chapter}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    // Only the second segment is visible, so there is no boundary to draw
    // inside the rail.
    expect(container.querySelector(".bg-surface-base")).toBeNull();
  });

  // Every other caller — the reader's vertical rail included — must be
  // untouched by this.
  it("spans the whole timeline with no window", () => {
    const { container } = render(
      <ChapterRail
        segments={segments}
        position={900}
        total={1800}
        onSeek={() => {}}
        ariaLabel="Position"
      />,
    );

    const fill = container.querySelector(".bg-primary-600") as HTMLElement;
    expect(fill.style.width).toBe("50.0000%");
  });
});
