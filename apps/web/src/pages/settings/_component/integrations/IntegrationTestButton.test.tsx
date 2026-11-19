import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mutateAsync = vi.fn();
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/pages/settings/useTestIntegration", () => ({
  useTestIntegration: () => ({ mutateAsync, isPending: false }),
}));

import { IntegrationTestButton } from "./IntegrationTestButton";

const click = () =>
  fireEvent.click(screen.getByText("settings.integrations.testConnection"));

describe("IntegrationTestButton", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it("tests the typed values and toasts success", async () => {
    mutateAsync.mockResolvedValue({ success: true });
    render(
      <IntegrationTestButton
        endpoint="/x"
        website_url=" http://a "
        api_key="k"
      />,
    );
    click();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "settings.integrations.testSuccess",
      ),
    );
    expect(mutateAsync).toHaveBeenCalledWith({
      website_url: "http://a",
      api_key: "k",
    });
  });

  it("omits blank fields so the server falls back to the stored config", async () => {
    mutateAsync.mockResolvedValue({ success: true });
    render(<IntegrationTestButton endpoint="/x" website_url="" api_key=" " />);
    click();
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      website_url: undefined,
      api_key: undefined,
    });
  });

  it("shows the cause and message on failure", async () => {
    mutateAsync.mockResolvedValue({
      success: false,
      cause: "auth",
      message: "Could not connect to X: rejected",
    });
    render(<IntegrationTestButton endpoint="/x" />);
    click();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "settings.integrations.cause.auth — Could not connect to X: rejected",
      ),
    );
  });
});
