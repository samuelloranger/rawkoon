import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

vi.mock("@/lib/notifications/useApnsDevices", () => ({
  useApnsDevices: () => ({
    data: {
      devices: [
        {
          id: 9,
          device_name: "Sam's iPhone",
          os_version: "18.2",
          app_version: "1.12.8",
          created_at: "2026-09-01T00:00:00Z",
        },
      ],
    },
    isLoading: false,
  }),
}));
vi.mock("@/lib/notifications/useDeleteApnsDevice", () => ({
  useDeleteApnsDevice: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/notifications/useNotifications", () => ({
  useNotifications: () => ({
    permission: "default",
    subscription: null,
    requestPermission: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isSupported: true,
  }),
}));
vi.mock("@/lib/notifications/useNotificationDevices", () => ({
  useNotificationDevices: () => ({ data: { devices: [] }, isLoading: false }),
}));
vi.mock("@/lib/notifications/useDeleteNotificationDevice", () => ({
  useDeleteNotificationDevice: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/notifications/useSubscribeToPushNotifications", () => ({
  useSubscribeToPushNotifications: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/notifications/useTestPushNotification", () => ({
  useTestPushNotification: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ user: { is_admin: false } }),
}));
vi.mock("@/components/confirm/ConfirmContext", () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));
vi.mock("@/pages/settings/_component/NotificationChannelsSection", () => ({
  NotificationChannelsSection: () => null,
}));
vi.mock("@/pages/settings/_component/NotificationPreferencesSection", () => ({
  NotificationPreferencesSection: () => null,
}));
vi.mock("@/pages/settings/_component/SettingsPageHeader", () => ({
  SettingsPageHeader: () => null,
}));

import { NotificationsTab } from "./NotificationsTab";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("NotificationsTab device roster", () => {
  it("renders an iOS app group with the registered device", () => {
    render(<NotificationsTab />, { wrapper });
    expect(
      screen.getByText("settings.notifications.iosGroup"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sam's iPhone")).toBeInTheDocument();
  });

  it("renders the web push group with its empty state", () => {
    render(<NotificationsTab />, { wrapper });
    expect(
      screen.getByText("settings.notifications.webPushGroup"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.notifications.webPushEmpty"),
    ).toBeInTheDocument();
  });
});
