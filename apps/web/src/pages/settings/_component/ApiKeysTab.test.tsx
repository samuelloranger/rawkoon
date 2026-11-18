import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiKey, ApiKeysResponse } from "@rawkoon/shared/types";

// react-i18next is globally mocked in src/test/setup.ts → t(key) returns key.
vi.mock("@rawkoon/shared/utils", () => ({
  formatDateTime: (v: string) => `formatted:${v}`,
}));

const useApiKeysMock = vi.fn();
const createMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
const updateScopesMutateAsync = vi.fn();
const confirmMock = vi.fn();
const copyMock = vi.fn();

vi.mock("@/pages/settings/useApiKeys", () => ({
  useApiKeys: () => useApiKeysMock(),
}));
vi.mock("@/pages/settings/useCreateApiKey", () => ({
  useCreateApiKey: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));
vi.mock("@/pages/settings/useDeleteApiKey", () => ({
  useDeleteApiKey: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
}));
vi.mock("@/pages/settings/useUpdateApiKeyScopes", () => ({
  useUpdateApiKeyScopes: () => ({
    mutateAsync: updateScopesMutateAsync,
    isPending: false,
  }),
}));
vi.mock("@/components/confirm/ConfirmContext", () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { is_admin: true } }),
}));
vi.mock("@/lib/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));

import { ApiKeysTab } from "./ApiKeysTab";

const KEY: ApiKey = {
  id: "k1",
  name: "TV key",
  start: "rwk_ab",
  prefix: null,
  enabled: true,
  mcp_scopes: ["read", "request"],
  last_used_at: null,
  expires_at: null,
  created_at: "2026-06-16T00:00:00.000Z",
};

const PLAIN_KEY: ApiKey = { ...KEY, id: "k2", name: "Labby", mcp_scopes: [] };

function setKeys(keys: ApiKey[]) {
  useApiKeysMock.mockReturnValue({
    data: { api_keys: keys } satisfies ApiKeysResponse,
    isLoading: false,
    error: null,
  });
}

describe("ApiKeysTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    copyMock.mockResolvedValue(true);
    setKeys([KEY, PLAIN_KEY]);
  });

  it("renders each key's MCP scopes as chips, or a dash for plain keys", () => {
    render(<ApiKeysTab />);

    expect(screen.getAllByText("read").length).toBeGreaterThan(0);
    expect(screen.getAllByText("request").length).toBeGreaterThan(0);
    // The plain service key shows the dash in the MCP column, not chips.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("settings.apiKeys.mcpColumn")).toBeInTheDocument();
  });

  it("creates a key without MCP scopes by default (plain service key)", async () => {
    render(<ApiKeysTab />);
    fireEvent.click(screen.getByText("settings.apiKeys.create"));

    fireEvent.change(
      screen.getByPlaceholderText("settings.apiKeys.namePlaceholder"),
      {
        target: { value: "Labby" },
      },
    );
    fireEvent.click(screen.getByText("settings.apiKeys.createSubmit"));

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith({ name: "Labby" }),
    );
  });

  it("sends the checked MCP scopes on create", async () => {
    createMutateAsync.mockResolvedValue({
      key: "rwk_plaintext",
      api_key: { ...KEY, mcp_scopes: ["read"] },
    });
    render(<ApiKeysTab />);
    fireEvent.click(screen.getByText("settings.apiKeys.create"));

    fireEvent.change(
      screen.getByPlaceholderText("settings.apiKeys.namePlaceholder"),
      {
        target: { value: "Claude key" },
      },
    );
    fireEvent.click(screen.getByText("settings.apiKeys.mcpScopeRead"));
    fireEvent.click(screen.getByText("settings.apiKeys.mcpScopeApprove"));
    fireEvent.click(screen.getByText("settings.apiKeys.createSubmit"));

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith({
        name: "Claude key",
        mcp_scopes: ["read", "approve"],
      }),
    );
  });

  it("shows setup commands with the fresh key right after a scoped creation", async () => {
    createMutateAsync.mockResolvedValue({
      key: "rwk_plaintext",
      api_key: { ...KEY, mcp_scopes: ["read"] },
    });
    render(<ApiKeysTab />);
    fireEvent.click(screen.getByText("settings.apiKeys.create"));

    fireEvent.change(
      screen.getByPlaceholderText("settings.apiKeys.namePlaceholder"),
      {
        target: { value: "Claude key" },
      },
    );
    fireEvent.click(screen.getByText("settings.apiKeys.mcpScopeRead"));
    fireEvent.click(screen.getByText("settings.apiKeys.createSubmit"));

    await waitFor(() =>
      expect(
        screen.getByText(/claude mcp add --transport http rawkoon/),
      ).toBeInTheDocument(),
    );
    // The plaintext key appears in its own box and inside the commands.
    expect(screen.getAllByText(/rwk_plaintext/).length).toBeGreaterThan(1);
    expect(
      screen.queryByText("settings.apiKeys.mcpPlaceholderHint"),
    ).not.toBeInTheDocument();
  });

  it("opens the MCP dialog from a row and saves edited scopes", async () => {
    render(<ApiKeysTab />);
    fireEvent.click(screen.getAllByText("settings.apiKeys.mcpOpen")[0]);

    // Commands use the placeholder because the plaintext is long gone.
    expect(screen.getAllByText(/<your key>/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("settings.apiKeys.mcpScopeAdmin"));
    fireEvent.click(screen.getByText("settings.apiKeys.mcpSave"));

    await waitFor(() =>
      expect(updateScopesMutateAsync).toHaveBeenCalledWith({
        id: "k1",
        scopes: ["read", "request", "admin"],
      }),
    );
  });

  it("hides setup commands when the edited key has no scopes", () => {
    render(<ApiKeysTab />);
    // Two rows; the second key is a plain service key.
    const openButtons = screen.getAllByText("settings.apiKeys.mcpOpen");
    fireEvent.click(openButtons[1]);

    // The dialog title renders once per breakpoint layout.
    expect(
      screen.getAllByText("settings.apiKeys.mcpEditTitle").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/claude mcp add/)).not.toBeInTheDocument();
  });
});
