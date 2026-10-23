import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { JellyfinIntegrationSection } from "./JellyfinIntegrationSection";

function fetcherWith(flags: {
  sign_in_enabled: boolean;
  open_sign_in: boolean;
}) {
  return vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === "PUT") return { success: true, integration: {} };
    return {
      integration: {
        type: "jellyfin",
        enabled: true,
        website_url: "https://jf.example",
        api_key: "",
        ...flags,
      },
    };
  });
}

// The card is collapsed and remounts once the integration loads.
async function openCard() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  fireEvent.click(screen.getByRole("heading", { name: "Jellyfin" }));
}

const SIGN_IN = "settings.integrations.jellyfin.signIn";
const OPEN = "settings.integrations.jellyfin.openSignIn";

describe("JellyfinIntegrationSection sign-in switches", () => {
  it("disables the open sign-in switch while sign-in is off", async () => {
    renderWithProviders(<JellyfinIntegrationSection />, {
      fetcher: fetcherWith({ sign_in_enabled: false, open_sign_in: true }),
    });
    await openCard();
    const open = await screen.findByRole("switch", { name: OPEN });
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("switch", { name: SIGN_IN }));
    expect(screen.getByRole("switch", { name: OPEN })).toBeEnabled();
  });

  it("saves both flags", async () => {
    const fetcher = fetcherWith({
      sign_in_enabled: false,
      open_sign_in: false,
    });
    renderWithProviders(<JellyfinIntegrationSection />, { fetcher });
    await openCard();
    fireEvent.click(await screen.findByRole("switch", { name: SIGN_IN }));
    fireEvent.click(screen.getByRole("switch", { name: OPEN }));
    fireEvent.click(
      await screen.findByRole("button", { name: "settings.integrations.save" }),
    );

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/integrations/jellyfin",
        expect.objectContaining({
          method: "PUT",
          body: expect.objectContaining({
            sign_in_enabled: true,
            open_sign_in: true,
          }),
        }),
      ),
    );
  });
});
