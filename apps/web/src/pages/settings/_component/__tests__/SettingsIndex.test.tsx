import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsIndex } from "../SettingsIndex";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const hrefs = () =>
  screen.getAllByRole("link").map((a) => a.getAttribute("href"));

describe("SettingsIndex", () => {
  it("shows only the You pages to a non-admin", () => {
    render(<SettingsIndex isAdmin={false} currentPath="/settings/profile" />);
    expect(hrefs()).toEqual([
      "/settings/profile",
      "/settings/security",
      "/settings/alerts",
      "/settings/app",
    ]);
  });

  it("groups the admin pages under You, Server and System", () => {
    render(<SettingsIndex isAdmin currentPath="/settings/health" />);
    expect(screen.getByText("settings.groups.server")).toBeTruthy();
    expect(screen.getByText("settings.groups.system")).toBeTruthy();
    expect(hrefs()).toHaveLength(20);
    expect(
      screen.getByText("settings.pages.health.title").closest("a"),
    ).toHaveAttribute("aria-current", "page");
  });

  it("filters by title and by keyword when searchable", () => {
    render(
      <SettingsIndex isAdmin currentPath="/settings/profile" searchable />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "qbittorrent" },
    });
    expect(hrefs()).toEqual(["/settings/connections"]);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "zzzz" },
    });
    expect(screen.getByText("settings.search.empty")).toBeTruthy();
  });

  it("opens the first match on Enter and closes the sheet", () => {
    const onNavigate = vi.fn();
    render(
      <SettingsIndex
        isAdmin
        currentPath="/settings/profile"
        searchable
        autoFocusSearch
        onNavigate={onNavigate}
      />,
    );
    const field = screen.getByRole("searchbox");
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "hevc" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith({ to: "/settings/reencode" });
    expect(onNavigate).toHaveBeenCalled();
  });
});
