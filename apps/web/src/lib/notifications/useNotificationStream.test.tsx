import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useNotificationStream } from "./useNotificationStream";

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(
    public url: string,
    public init?: { withCredentials?: boolean },
  ) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource as never);
});
afterEach(() => vi.unstubAllGlobals());

describe("useNotificationStream", () => {
  it("opens the notifications stream with credentials", () => {
    const client = new QueryClient();
    renderHook(() => useNotificationStream({ onNotification: vi.fn() }), {
      wrapper: wrapper(client),
    });
    expect(FakeEventSource.last?.url).toBe("/api/notifications/stream");
    expect(FakeEventSource.last?.init?.withCredentials).toBe(true);
  });

  it("reconnects (closes old, opens new) when reconnectKey changes, e.g. on login", () => {
    const client = new QueryClient();
    const { rerender } = renderHook(
      ({ key }: { key: string | null }) =>
        useNotificationStream({ onNotification: vi.fn(), reconnectKey: key }),
      {
        wrapper: wrapper(client),
        initialProps: { key: null } as { key: string | null },
      },
    );
    const first = FakeEventSource.last!;
    expect(first.url).toBe("/api/notifications/stream");
    expect(first.closed).toBe(false);

    rerender({ key: "user-1" });

    expect(first.closed).toBe(true); // old connection torn down
    expect(FakeEventSource.last).not.toBe(first); // a fresh connection opened
    expect(FakeEventSource.last?.closed).toBe(false);
  });

  it("calls onNotification and invalidates notification queries on an event", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const onNotification = vi.fn();
    renderHook(() => useNotificationStream({ onNotification }), {
      wrapper: wrapper(client),
    });

    FakeEventSource.last!.emit({
      userId: "u1",
      id: 99,
      title: "Hi",
      body: "There",
      type: "test",
      url: "/settings",
    });

    expect(onNotification).toHaveBeenCalledTimes(1);
    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99, title: "Hi", body: "There" }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications"] });
  });

  it("ignores the connected handshake", () => {
    const client = new QueryClient();
    const onNotification = vi.fn();
    renderHook(() => useNotificationStream({ onNotification }), {
      wrapper: wrapper(client),
    });
    FakeEventSource.last!.emit({ connected: true });
    expect(onNotification).not.toHaveBeenCalled();
  });

  it("closes the stream on unmount", () => {
    const client = new QueryClient();
    const { unmount } = renderHook(
      () => useNotificationStream({ onNotification: vi.fn() }),
      { wrapper: wrapper(client) },
    );
    const es = FakeEventSource.last!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
