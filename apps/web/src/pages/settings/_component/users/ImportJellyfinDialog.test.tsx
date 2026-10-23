import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "@/test-utils/render";
import type { JellyfinUserOption } from "@rawkoon/shared/types";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

import { ImportJellyfinDialog, skipReasonKey } from "./ImportJellyfinDialog";

const users: JellyfinUserOption[] = [
  { id: "j1", name: "alice", disabled: false, linked_user_id: null },
  { id: "j2", name: "bob", disabled: true, linked_user_id: null },
  { id: "j3", name: "carol", disabled: false, linked_user_id: "u9" },
];

describe("ImportJellyfinDialog", () => {
  it("lists disabled and linked users but they cannot be ticked", () => {
    renderWithProviders(
      <ImportJellyfinDialog isOpen onClose={vi.fn()} users={users} />,
    );
    expect(screen.getByLabelText("alice")).toBeEnabled();
    expect(screen.getByLabelText("bob")).toBeDisabled();
    expect(screen.getByLabelText("carol")).toBeDisabled();
  });

  it("imports the ticked users as regular users and toasts the skipped ones", async () => {
    const fetcher = vi.fn(async () => ({
      created: [{ jellyfin_user_id: "j1", user_id: "u1" }],
      skipped: [{ jellyfin_user_id: "j2", reason: "disabled" }],
    }));
    const onClose = vi.fn();
    renderWithProviders(
      <ImportJellyfinDialog isOpen onClose={onClose} users={users} />,
      { fetcher },
    );
    const importButton = screen.getByRole("button", {
      name: /settings\.users\.importJellyfin\.import/,
    });
    expect(importButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText("alice"));
    fireEvent.click(importButton);

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith("/api/admin/users/import-jellyfin", {
        method: "POST",
        body: { users: [{ jellyfin_user_id: "j1", is_admin: false }] },
      }),
    );
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.warning.mock.calls[0][0]).toContain(
      "bob (settings.users.importJellyfin.skipReasons.disabled)",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("maps known skip reasons and falls back for unknown ones", () => {
    expect(skipReasonKey("already_linked")).toBe(
      "settings.users.importJellyfin.skipReasons.already_linked",
    );
    expect(skipReasonKey("something_new")).toBe(
      "settings.users.importJellyfin.skipReasons.unknown",
    );
  });

  it("forgets ticked users after the dialog closes and reopens", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen((v) => !v)}>toggle</button>
          <ImportJellyfinDialog
            isOpen={open}
            onClose={() => setOpen(false)}
            users={users}
          />
        </>
      );
    }
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByLabelText("alice"));
    expect(screen.getByLabelText("alice")).toBeChecked();
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByLabelText("alice")).not.toBeChecked();
  });
});
