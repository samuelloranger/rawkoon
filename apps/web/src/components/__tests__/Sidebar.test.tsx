import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";
import type { NavPosition } from "@rawkoon/shared/types";

// Mock all heavy dependencies
vi.mock("@tanstack/react-router", () => ({
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
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: "/" } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));
vi.mock("motion/react", () => ({
  motion: {
    span: ({
      children,
      ...p
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => <span {...p}>{children}</span>,
  },
}));
vi.mock("@/lib/auth", () => ({ clearUser: vi.fn() }));
vi.mock("@/lib/auth/useAuth", () => ({
  useLogout: () => ({ mutateAsync: vi.fn() }),
  useAuth: () => ({
    user: {
      email: "a@b.com",
      first_name: "A",
      is_admin: false,
      avatar_url: null,
    },
  }),
}));
vi.mock("@/pages/settings/useUsers", () => ({
  useUpdateProfile: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/pages/settings/useNavPosition", () => ({
  useNavPosition: () => ({ position: "left", setPosition: vi.fn() }),
}));
vi.mock("@/lib/utils/format", () => ({ formatDisplayName: () => "A" }));
vi.mock("@/components/NotificationsBell", () => ({
  NotificationsMenu: () => <div data-testid="notifications" />,
}));
vi.mock("@/components/UserMenu", () => ({
  UserMenu: () => <div data-testid="usermenu" />,
}));
vi.mock("@/lib/routing/usePrefetchRoute", () => ({
  usePrefetchRoute: () => vi.fn(),
}));
vi.mock("@/lib/app/useTheme", () => ({
  useTheme: () => ({}),
}));
vi.mock("@/lib/routing/navigation", () => ({
  navSections: [
    {
      labelKey: "nav.section_life",
      items: [
        { path: "/", icon: () => <svg />, translationKey: "nav.dashboard" },
      ],
    },
    {
      labelKey: "nav.section_homelab",
      items: [
        {
          path: "/library",
          icon: () => <svg />,
          translationKey: "nav.library",
        },
      ],
    },
  ],
}));
vi.mock("@/components/NavPositionPicker", () => ({
  NavPositionPicker: ({
    value,
    onChange: _onChange,
  }: {
    value: string;
    onChange: (p: string) => void;
  }) => <div data-testid="nav-position-picker" data-value={value} />,
}));

function renderSidebar(position: NavPosition) {
  return render(<Sidebar position={position} />);
}

describe("Sidebar section labels", () => {
  it("shows section labels for left position", () => {
    renderSidebar("left");
    expect(screen.queryByText("nav.section_life")).toBeTruthy();
    expect(screen.queryByText("nav.section_homelab")).toBeTruthy();
  });

  it("hides section labels for top position", () => {
    renderSidebar("top");
    expect(screen.queryByText("nav.section_life")).toBeNull();
    expect(screen.queryByText("nav.section_homelab")).toBeNull();
  });

  it("hides section labels for bottom position", () => {
    renderSidebar("bottom");
    expect(screen.queryByText("nav.section_life")).toBeNull();
    expect(screen.queryByText("nav.section_homelab")).toBeNull();
  });

  it("shows section labels for right position", () => {
    renderSidebar("right");
    expect(screen.queryByText("nav.section_life")).toBeTruthy();
    expect(screen.queryByText("nav.section_homelab")).toBeTruthy();
  });
});
