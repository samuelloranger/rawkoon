import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeedChip } from "./SeedChip";

describe("SeedChip", () => {
  it("renders nothing without seed state", () => {
    const { container } = render(<SeedChip seed={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("labels each state", () => {
    render(
      <SeedChip
        seed={{
          state: "blocklisted",
          reason: "malware",
          ratio: null,
          seeding_time_secs: null,
        }}
      />,
    );
    expect(
      screen.getByText("library.download.seed.blocklisted"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("library.download.seed.reason.malware"),
    ).toBeInTheDocument();
  });
});
