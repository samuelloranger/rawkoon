import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("ResetPasswordDialog", () => {
  it("masks the input and only submits a long-enough password", () => {
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
    fireEvent.change(input, { target: { value: "longenough1" } });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("longenough1");
  });
});
