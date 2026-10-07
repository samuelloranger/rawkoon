import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { AiStatsResponse } from "@rawkoon/shared/types";
import { renderWithProviders } from "@/test-utils/render";

const metrics = {
  calls: 12,
  ok: 9,
  invalid_pick: 2,
  rate_limited: 0,
  agreement_checked: 10,
  agreement_rate: 0.8,
  error: 1,
  budget_skipped: 2,
  success_rate: 0.75,
  input_tokens: 24_000,
  output_tokens: 1_200,
  total_tokens: 25_200,
  avg_duration_ms: 500,
  p50_duration_ms: 420,
  p95_duration_ms: 1500,
  estimated_cost: 0.0123,
};
const outcome = { total: 4, completed: 3, failed: 1, active: 0 };

const stats: AiStatsResponse = {
  days: 30,
  totals: metrics,
  by_feature: [{ feature: "release_pick_rss", ...metrics }],
  by_trigger: [{ trigger: "rss", ...metrics }],
  by_model: [{ model: "llama-3.3-70b", ...metrics }],
  daily: [
    {
      date: "2026-10-05",
      calls: 5,
      errors: 0,
      rate_limited: 0,
      budget_skipped: 0,
      total_tokens: 10,
      estimated_cost: 0.01,
    },
    {
      date: "2026-10-06",
      calls: 7,
      errors: 1,
      rate_limited: 0,
      budget_skipped: 2,
      total_tokens: 15,
      estimated_cost: 0.0023,
    },
  ],
  grabs: {
    ai: outcome,
    classic: { total: 2, completed: 2, failed: 0, active: 0 },
  },
  prices_configured: true,
  today_spend: 0.0023,
  daily_budget_usd: null,
};

let statsData: AiStatsResponse | undefined = stats;
const useAiStats = vi.fn((days: number) => {
  void days;
  return { data: statsData, isLoading: false, isError: false };
});

vi.mock("@/pages/settings/useAiStats", () => ({
  useAiStats: (days: number) => useAiStats(days),
}));
vi.mock("@/pages/settings/useAiCalls", () => ({
  AI_CALLS_PAGE_SIZE: 20,
  useAiCalls: () => ({
    data: {
      calls: [
        {
          id: 1,
          feature: "release_pick_interactive",
          model: "llama-3.3-70b",
          structured: true,
          status: "ok",
          trigger: "interactive",
          classic_title: null,
          agreed_with_classic: null,
          error: null,
          input_tokens: 2000,
          output_tokens: 100,
          total_tokens: 2100,
          duration_ms: 800,
          estimated_cost: 0.001,
          media_id: null,
          media_title: null,
          media_type: null,
          book_id: null,
          book_edition_id: null,
          book_title: null,
          picked_title: "Some.Release",
          reasoning: "Highest score and seeders",
          created_at: "2026-10-06T12:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      page_size: 20,
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock(
  "@/pages/settings/_component/integrations/AiProviderIntegrationSection",
  () => ({ AiProviderIntegrationSection: () => <div>provider-form</div> }),
);

const { AiSettingsTab } = await import(
  "@/pages/settings/_component/AiSettingsTab"
);

describe("AiSettingsTab", () => {
  it("renders the provider form, stat tiles, tables and history", () => {
    statsData = stats;
    renderWithProviders(<AiSettingsTab />);
    expect(screen.getByText("provider-form")).toBeInTheDocument();
    expect(screen.getAllByText("75%")[0]).toBeInTheDocument();
    // 80% agreement means the AI changed the pick 20% of the time.
    expect(screen.getAllByText("20%")[0]).toBeInTheDocument();
    expect(screen.getAllByText("$0.01")[0]).toBeInTheDocument();
    expect(
      screen.getAllByText(/settings\.ai\.features\.release_pick_rss/)[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText("llama-3.3-70b").length).toBeGreaterThan(0);
    expect(screen.getByText("Highest score and seeders")).toBeInTheDocument();
  });

  it("asks for a new period when a period button is clicked", () => {
    statsData = stats;
    renderWithProviders(<AiSettingsTab />);
    const buttons = screen.getAllByRole("button", {
      name: /settings\.ai\.period\.days/,
    });
    fireEvent.click(buttons[3]!);
    expect(useAiStats).toHaveBeenLastCalledWith(365);
  });

  it("shows the empty state and a price hint when there are no calls", () => {
    statsData = {
      ...stats,
      totals: {
        ...metrics,
        calls: 0,
        ok: 0,
        invalid_pick: 0,
        rate_limited: 0,
        agreement_checked: 0,
        agreement_rate: null,
        error: 0,
        budget_skipped: 0,
        success_rate: 0,
        estimated_cost: null,
      },
      by_feature: [],
      by_model: [],
      by_trigger: [],
      prices_configured: false,
    };
    renderWithProviders(<AiSettingsTab />);
    expect(screen.getByText("settings.ai.empty")).toBeInTheDocument();
  });

  it("prompts to set prices when cost cannot be estimated", () => {
    statsData = { ...stats, prices_configured: false };
    renderWithProviders(<AiSettingsTab />);
    expect(
      screen.getAllByText("settings.ai.stats.setPrices").length,
    ).toBeGreaterThan(0);
  });

  it("shows today's spend against the budget with a progress bar", () => {
    statsData = { ...stats, today_spend: 0.5, daily_budget_usd: 2 };
    renderWithProviders(<AiSettingsTab />);
    expect(screen.getByText("settings.ai.stats.today")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(
      screen.queryByText("settings.ai.stats.budgetReached"),
    ).not.toBeInTheDocument();
  });

  it("flags a spent budget and shows the skipped count", () => {
    statsData = { ...stats, today_spend: 2.5, daily_budget_usd: 2 };
    renderWithProviders(<AiSettingsTab />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(
      screen.getByText("settings.ai.stats.budgetReached"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.ai.stats.budgetSkipped"),
    ).toBeInTheDocument();
  });

  it("shows the Today tile even before any call exists", () => {
    statsData = {
      ...stats,
      totals: { ...metrics, calls: 0, budget_skipped: 0 },
      by_feature: [],
      by_model: [],
      by_trigger: [],
      daily_budget_usd: 2,
      today_spend: 0,
    };
    renderWithProviders(<AiSettingsTab />);
    expect(screen.getByText("settings.ai.empty")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
