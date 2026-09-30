import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/medias/hooks/useMediaPostProcessingSettings", () => ({
  useMediaPostProcessingSettings: () => ({
    data: {
      settings: { seed_sweep_enabled: true, updated_at: "2026-01-01" },
    },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/features/seeding/hooks/useSeeding", () => ({
  useSeeding: () => ({ data: { torrents: [{}, {}, {}] } }),
}));
vi.mock("./SeedingSettingsSection", () => ({
  SeedingSettingsSection: () => <div>rules-section</div>,
}));

import { SeedingTab } from "./SeedingTab";

describe("SeedingTab", () => {
  it("shows the sweep state, the held count and a link to the torrents", () => {
    render(<SeedingTab />);
    expect(screen.getByText("settings.seeding.statusOn")).toBeInTheDocument();
    expect(screen.getByText(/^settings\.seeding\.shared/)).toBeInTheDocument();
    expect(screen.getByText("rules-section")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "settings.seeding.viewTorrents" }),
    ).toHaveAttribute("href", "/library/downloads?view=seeding");
  });
});
