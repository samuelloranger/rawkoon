import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("ResetPasswordDialog", () => {
  it("masks the input and only submits a password the server will accept", () => {
    const onSubmit = vi.fn();
    render(
      <ResetPasswordDialog
        email="a@b.c"
        isPending={false}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("settings.users.passwordResetPrompt");
    expect(input.getAttribute("type")).toBe("password");
    const submit = screen.getByRole("button", {
      name: "settings.users.passwordResetTitle",
    }) as HTMLButtonElement;
    fireEvent.change(input, { target: { value: "short" } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByRole("alert")).toBeTruthy();
    // Long enough but missing the server's complexity rules: still blocked.
    fireEvent.change(input, { target: { value: "abcdefgh" } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(
      "login.passwordNeedsUppercase",
    );
    fireEvent.change(input, { target: { value: "Longenough1!" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("Longenough1!");
  });
});
