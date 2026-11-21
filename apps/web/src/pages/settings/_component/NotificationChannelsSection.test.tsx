import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationChannelsSection } from "./NotificationChannelsSection";

const confirm = vi.fn();
const mutate = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/confirm/ConfirmContext", () => ({
  useConfirm: () => ({ confirm }),
}));
vi.mock("@/lib/notifications/useNotificationChannels", () => ({
  useNotificationChannels: () => ({
    isLoading: false,
    data: {
      channels: [{ id: 5, label: "Ops", type: "ntfy", enabled: true }],
    },
  }),
  useUpdateNotificationChannel: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteNotificationChannel: () => ({ isPending: false, mutate }),
  useTestNotificationChannel: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("./AddNotificationChannelModal", () => ({
  AddNotificationChannelModal: () => null,
}));
vi.mock("./EditNotificationChannelModal", () => ({
  EditNotificationChannelModal: () => null,
}));

describe("NotificationChannelsSection", () => {
  it("asks for confirmation before deleting a channel", () => {
    render(<NotificationChannelsSection />);
    fireEvent.click(
      screen.getByTitle("settings.notifications.channels.deleteChannel"),
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mock.calls[0][0].onConfirm();
    expect(mutate).toHaveBeenCalledWith(5, expect.any(Object));
  });
});
