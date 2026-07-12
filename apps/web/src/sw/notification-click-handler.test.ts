import { beforeEach, describe, expect, it, vi } from "vitest";

const { matchAll, openWindow } = vi.hoisted(() => ({
  matchAll: vi.fn(),
  openWindow: vi.fn(),
}));

vi.mock("./sw", () => ({
  sw: {
    clients: { matchAll, openWindow },
    registration: { update: vi.fn() },
  },
}));

import { handleNotificationClick } from "./notification-click-handler";

describe("handleNotificationClick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("self", { location: { origin: "https://rawkoon.test" } });
    matchAll.mockResolvedValue([]);
  });

  it("opens the notification center when a notification has no URL", async () => {
    let clickWork: Promise<unknown> | undefined;

    handleNotificationClick({
      action: "",
      notification: { close: vi.fn(), data: {} },
      waitUntil: (work: Promise<unknown>) => {
        clickWork = work;
      },
    } as unknown as NotificationEvent);

    await clickWork;

    expect(openWindow).toHaveBeenCalledWith(
      "https://rawkoon.test/notifications",
    );
  });
});
