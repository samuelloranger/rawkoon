import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { AiProviderIntegration } from "@rawkoon/shared/types";
import { renderWithProviders } from "@/test-utils/render";

const integration: AiProviderIntegration = {
  type: "ai-provider",
  enabled: true,
  base_url: "http://ai.test",
  model: "m",
  has_api_key: false,
  input_price_per_million: null,
  output_price_per_million: null,
  daily_budget_usd: 3,
  features: { release_pick_rss: false },
};

const mutateAsync = vi.fn(async (_body: unknown) => ({}));

vi.mock("@/pages/settings/useAiProviderIntegration", () => ({
  useAiProviderIntegration: () => ({
    data: { integration },
    isLoading: false,
  }),
}));
vi.mock("@/pages/settings/useUpdateAiProviderIntegration", () => ({
  useUpdateAiProviderIntegration: () => ({ mutateAsync, isPending: false }),
}));
vi.mock(
  "@/pages/settings/_component/integrations/IntegrationSectionCard",
  () => ({
    IntegrationSectionCard: ({
      children,
      onSave,
    }: {
      children: React.ReactNode;
      onSave: () => void;
    }) => (
      <div>
        {children}
        <button type="button" onClick={onSave}>
          save
        </button>
      </div>
    ),
  }),
);

const { AiProviderIntegrationSection } = await import(
  "@/pages/settings/_component/integrations/AiProviderIntegrationSection"
);

describe("AiProviderIntegrationSection controls", () => {
  it("renders one switch per feature, off only where disabled", () => {
    renderWithProviders(<AiProviderIntegrationSection />);
    const rss = screen.getByRole("switch", {
      name: "settings.ai.featureToggles.release_pick_rss",
    });
    const books = screen.getByRole("switch", {
      name: "settings.ai.featureToggles.book_release_pick",
    });
    expect(rss).toHaveAttribute("aria-checked", "false");
    expect(books).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("switch")).toHaveLength(4);
  });

  it("warns when a budget is set without prices", () => {
    renderWithProviders(<AiProviderIntegrationSection />);
    expect(
      screen.getByText("settings.ai.budget.needsPrices"),
    ).toBeInTheDocument();
  });

  it("saves the budget and toggled features", () => {
    renderWithProviders(<AiProviderIntegrationSection />);
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings.ai.featureToggles.book_release_pick",
      }),
    );
    fireEvent.change(screen.getByLabelText("settings.ai.budget.label"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("save"));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        daily_budget_usd: null,
        features: { release_pick_rss: false, book_release_pick: false },
      }),
    );
  });
});
