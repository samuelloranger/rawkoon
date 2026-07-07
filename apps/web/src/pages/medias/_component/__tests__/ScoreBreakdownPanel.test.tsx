import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreBreakdownPanel } from "../ScoreBreakdownPanel";
import type { ScoreBreakdownDto } from "@rawkoon/shared/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      // Simulate custom format component label interpolation
      if (key === "scoring.component.customFormat" && params?.name) {
        return `Custom format: ${params.name}`;
      }
      return key;
    },
  }),
}));

const nonRejectedBreakdown: ScoreBreakdownDto = {
  rejected: false,
  total: 35,
  components: [
    { code: "resolution_tier", value: 20 },
    { code: "language_match", value: 10 },
    { code: "size_penalty", value: -5 },
    { code: "custom_format", value: 10, params: { name: "Remux" } },
  ],
  matched_formats: ["Remux", "BDRip"],
};

const rejectedBreakdown: ScoreBreakdownDto = {
  rejected: true,
  total: null,
  components: [],
  matched_formats: [],
};

describe("ScoreBreakdownPanel", () => {
  it("renders nothing when breakdown is rejected", () => {
    const { container } = render(
      <ScoreBreakdownPanel breakdown={rejectedBreakdown} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders total for a non-rejected breakdown", () => {
    render(<ScoreBreakdownPanel breakdown={nonRejectedBreakdown} />);
    expect(screen.getByText("+35")).toBeInTheDocument();
  });

  it("renders component label keys", () => {
    render(<ScoreBreakdownPanel breakdown={nonRejectedBreakdown} />);
    expect(
      screen.getByText("scoring.component.resolutionTier"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("scoring.component.languageMatch"),
    ).toBeInTheDocument();
  });

  it("renders positive and negative contributions with correct sign", () => {
    render(<ScoreBreakdownPanel breakdown={nonRejectedBreakdown} />);
    expect(screen.getByText("+20")).toBeInTheDocument();
    // Both language_match (+10) and custom_format (+10) contribute +10
    expect(screen.getAllByText("+10")).toHaveLength(2);
    expect(screen.getByText("-5")).toBeInTheDocument();
  });

  it("renders custom_format component with interpolated name", () => {
    render(<ScoreBreakdownPanel breakdown={nonRejectedBreakdown} />);
    expect(screen.getByText("Custom format: Remux")).toBeInTheDocument();
  });

  it("renders matched_formats as chips", () => {
    render(<ScoreBreakdownPanel breakdown={nonRejectedBreakdown} />);
    expect(screen.getByText("Remux")).toBeInTheDocument();
    expect(screen.getByText("BDRip")).toBeInTheDocument();
  });

  it("renders nothing for matched_formats when list is empty", () => {
    const breakdown: ScoreBreakdownDto = {
      ...nonRejectedBreakdown,
      matched_formats: [],
    };
    render(<ScoreBreakdownPanel breakdown={breakdown} />);
    // Panel renders but no chips
    expect(screen.getByText("+35")).toBeInTheDocument();
    expect(screen.queryByText("Remux")).not.toBeInTheDocument();
  });
});
