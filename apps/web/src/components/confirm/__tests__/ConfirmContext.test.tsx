import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  ConfirmProvider,
  useConfirm,
} from "@/components/confirm/ConfirmContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TestButton({
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant,
}: {
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
}) {
  const { confirm } = useConfirm();
  return (
    <button
      onClick={() =>
        confirm({
          onConfirm,
          onCancel,
          title,
          description,
          confirmLabel,
          cancelLabel,
          variant,
        })
      }
    >
      open
    </button>
  );
}

function renderWithProvider(
  props: Parameters<typeof TestButton>[0] = { onConfirm: vi.fn() },
) {
  return render(
    <ConfirmProvider>
      <TestButton {...props} />
    </ConfirmProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useConfirm", () => {
  it("throws when used outside ConfirmProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    function Broken() {
      useConfirm();
      return null;
    }
    expect(() => render(<Broken />)).toThrow(
      "useConfirm must be used within ConfirmProvider",
    );
    consoleError.mockRestore();
  });
});

describe("ConfirmProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not show the dialog initially", () => {
    renderWithProvider();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("opens the dialog when confirm() is called", async () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
  });

  it("renders default i18n title and description when none provided", async () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => {
      // The mock t() returns the translation key as-is
      expect(
        screen.getByText("common.confirmDialog.title"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("common.confirmDialog.description"),
      ).toBeInTheDocument();
    });
  });

  it("renders custom title, description, and button labels", async () => {
    renderWithProvider({
      onConfirm: vi.fn(),
      title: "Delete this item?",
      description: "It will be gone forever.",
      confirmLabel: "Yes, delete",
      cancelLabel: "Never mind",
    });
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => {
      expect(screen.getByText("Delete this item?")).toBeInTheDocument();
      expect(screen.getByText("It will be gone forever.")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Yes, delete" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Never mind" }),
      ).toBeInTheDocument();
    });
  });

  it("calls onConfirm and closes the dialog when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    renderWithProvider({ onConfirm, confirmLabel: "Delete" });
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByRole("alertdialog"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("does NOT call onCancel when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithProvider({ onConfirm, onCancel, confirmLabel: "Yes" });
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByRole("alertdialog"));

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel and closes the dialog when the cancel button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithProvider({ onConfirm, onCancel, cancelLabel: "No" });
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByRole("alertdialog"));

    fireEvent.click(screen.getByRole("button", { name: "No" }));

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledOnce();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not call onCancel if it is not provided when cancel is clicked", async () => {
    const onConfirm = vi.fn();
    renderWithProvider({ onConfirm, cancelLabel: "No" });
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByRole("alertdialog"));

    // Should not throw
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps the dialog open if onConfirm throws", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("API error"));
    renderWithProvider({ onConfirm, confirmLabel: "Delete" });
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByRole("alertdialog"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    // Dialog should still be present
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("prevents double-submit while onConfirm is in flight", async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    renderWithProvider({ onConfirm, confirmLabel: "Delete" });
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByRole("alertdialog"));

    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn); // second click while in-flight
    fireEvent.click(confirmBtn); // third

    resolve(); // let the promise settle
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("ignores a second confirm() call while a dialog is already open (single-flight)", async () => {
    const onConfirm1 = vi.fn();
    const onConfirm2 = vi.fn();
    const { rerender } = render(
      <ConfirmProvider>
        <TestButton onConfirm={onConfirm1} title="First" confirmLabel="OK1" />
      </ConfirmProvider>,
    );

    fireEvent.click(screen.getByText("open"));
    await waitFor(() => screen.getByRole("alertdialog"));

    // Mount a second trigger and fire it
    rerender(
      <ConfirmProvider>
        <TestButton onConfirm={onConfirm1} title="First" confirmLabel="OK1" />
        <TestButton onConfirm={onConfirm2} title="Second" confirmLabel="OK2" />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getAllByText("open")[1]);

    // Still showing the first dialog
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.queryByText("Second")).not.toBeInTheDocument();
  });
});
