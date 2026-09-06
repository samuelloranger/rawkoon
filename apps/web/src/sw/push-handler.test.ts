import { describe, expect, it, vi } from "vitest";

const { showNotification } = vi.hoisted(() => ({
  showNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./sw", () => ({
  sw: { registration: { showNotification } },
}));
vi.mock("./badge", () => ({
  syncBadgeCount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./app-update", () => ({
  handleAppUpdate: vi.fn().mockResolvedValue(undefined),
}));

import { handlePush } from "./push-handler";
import { setSwStrings } from "./strings";

describe("handlePush", () => {
  it("keeps URL-less pushes pointed at the notification center", async () => {
    let pushWork: Promise<unknown> | undefined;

    handlePush({
      data: { json: () => ({ title: "Rawkoon", data: {} }) },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    } as unknown as PushEvent);

    await pushWork;

    expect(showNotification).toHaveBeenCalledWith(
      "Rawkoon",
      expect.objectContaining({
        data: expect.objectContaining({ url: "/notifications" }),
      }),
    );
  });

  it("uses posted locale strings for fallback body and actions", async () => {
    showNotification.mockClear();
    setSwStrings({
      open: "Ouvrir",
      close: "Fermer",
      fallbackBody: "Vous avez une nouvelle notification",
    });

    let pushWork: Promise<unknown> | undefined;
    handlePush({
      data: { json: () => ({ title: "Rawkoon" }) },
      waitUntil: (work: Promise<unknown>) => {
        pushWork = work;
      },
    } as unknown as PushEvent);
    await pushWork;

    expect(showNotification).toHaveBeenCalledWith(
      "Rawkoon",
      expect.objectContaining({
        body: "Vous avez une nouvelle notification",
        actions: [
          { action: "open", title: "Ouvrir" },
          { action: "close", title: "Fermer" },
        ],
      }),
    );

    setSwStrings({
      open: "Open",
      close: "Close",
      fallbackBody: "You have a new notification",
    });
  });
});
