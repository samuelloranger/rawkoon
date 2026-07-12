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
});
