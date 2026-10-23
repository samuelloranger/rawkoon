import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpError } from "@/lib/api/httpClient";
import { jellyfinErrorKey } from "@/lib/auth/useJellyfinSignIn";
import { JellyfinSignInForm } from "./JellyfinSignInForm";

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("login.jellyfin.username"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText("login.password"), {
    target: { value: password },
  });
}

describe("jellyfinErrorKey", () => {
  it.each([
    [401, "login.jellyfin.invalidCredentials"],
    [403, "login.jellyfin.noAccess"],
    [404, "login.jellyfin.disabled"],
    [409, "login.jellyfin.alreadyLinked"],
    [429, "login.jellyfin.tooManyAttempts"],
    [502, "login.jellyfin.unreachable"],
    [500, "login.authFailed"],
  ])("maps %i", (status, key) => {
    expect(jellyfinErrorKey(new HttpError("x", status))).toBe(key);
  });
  it("reads a link-flow 404 as sign-in turned off", () => {
    expect(jellyfinErrorKey(new HttpError("x", 404), "link")).toBe(
      "settings.jellyfinLink.turnedOff",
    );
  });
  it("falls back for non-HTTP errors", () => {
    expect(jellyfinErrorKey(new Error("boom"))).toBe("login.authFailed");
  });
});

describe("JellyfinSignInForm", () => {
  it("submits trimmed credentials", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <JellyfinSignInForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        submitLabel="Go"
        pending={false}
      />,
    );
    fill("  alice ", "pw");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        username: "alice",
        password: "pw",
      }),
    );
  });

  it("keeps submit disabled until both fields are filled", () => {
    render(
      <JellyfinSignInForm
        onSubmit={vi.fn()}
        onBack={vi.fn()}
        submitLabel="Go"
        pending={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
    fill("alice", "pw");
    expect(screen.getByRole("button", { name: "Go" })).toBeEnabled();
  });

  it("shows the no-access message on a 403", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new HttpError("x", 403));
    render(
      <JellyfinSignInForm
        onSubmit={onSubmit}
        onBack={vi.fn()}
        submitLabel="Go"
        pending={false}
      />,
    );
    fill("alice", "pw");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "login.jellyfin.noAccess",
    );
  });

  it("calls onBack", () => {
    const onBack = vi.fn();
    render(
      <JellyfinSignInForm
        onSubmit={vi.fn()}
        onBack={onBack}
        submitLabel="Go"
        pending={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "login.jellyfin.back" }),
    );
    expect(onBack).toHaveBeenCalled();
  });
});
