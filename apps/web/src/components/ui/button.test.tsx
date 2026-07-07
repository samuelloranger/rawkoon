import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("renders the default (apricot/terracotta) variant", () => {
    render(<Button>Watch</Button>);
    const btn = screen.getByRole("button", { name: "Watch" });
    expect(btn.className).toContain("bg-primary-600");
  });

  it("renders the ghost variant without a solid background", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole("button", { name: "Ghost" });
    expect(btn.className).not.toContain("bg-primary-600");
  });

  it("does not use a light (white) ring offset", () => {
    render(<Button>Watch</Button>);
    const btn = screen.getByRole("button", { name: "Watch" });
    expect(btn.className).not.toContain("ring-offset-white");
  });

  it("uses dark text on the apricot/terracotta default (not white) for contrast", () => {
    render(<Button>Watch</Button>);
    const btn = screen.getByRole("button", { name: "Watch" });
    expect(btn.className).toContain("text-neutral-950");
    expect(btn.className).not.toContain("text-white");
  });
});
