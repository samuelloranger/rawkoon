import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_ENDPOINTS } from "@/lib/endpoints/notifications";
import { useCloseReadNotifications } from "./useCloseReadNotifications";

function setVisibilityState(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setVisibilityState("visible");
});

describe("useCloseReadNotifications", () => {
  it("closes already-read notifications on initial visible mount", async () => {
    const unreadNotification = {
      close: vi.fn(),
      data: { notification_id: 1 },
    };
    const readNotification = {
      close: vi.fn(),
      data: { notification_id: 2 },
    };
    const getRegistration = vi.fn().mockResolvedValue({
      getNotifications: vi
        .fn()
        .mockResolvedValue([unreadNotification, readNotification]),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ids: [1] }),
    });

    setVisibilityState("visible");
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useCloseReadNotifications());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        NOTIFICATION_ENDPOINTS.UNREAD_IDS,
        { credentials: "include" },
      );
    });
    expect(unreadNotification.close).not.toHaveBeenCalled();
    expect(readNotification.close).toHaveBeenCalledTimes(1);
  });

  it("waits for a visible tab before checking notifications", async () => {
    const getRegistration = vi.fn();
    const fetchMock = vi.fn();

    setVisibilityState("hidden");
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration },
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useCloseReadNotifications());

    expect(getRegistration).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
