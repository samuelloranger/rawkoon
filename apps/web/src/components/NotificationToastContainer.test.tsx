import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

// Control what useAuth() reports, to model the app-root mount timing.
const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: mockUseAuth }));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(
    public url: string,
    public init?: { withCredentials?: boolean },
  ) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

import { NotificationToastContainer } from "./NotificationToastContainer";

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

const streamOpened = () =>
  FakeEventSource.instances.some(
    (es) => es.url === "/api/notifications/stream",
  );

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
  mockUseAuth.mockReset();
});

describe("NotificationToastContainer silent notifications", () => {
  function emit(payload: unknown) {
    const stream = FakeEventSource.instances.find(
      (es) => es.url === "/api/notifications/stream",
    );
    act(() => {
      stream?.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
    });
  }

  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1" },
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it("shows a toast for an ordinary notification", () => {
    render(createElement(NotificationToastContainer), {
      wrapper: wrap(new QueryClient()),
    });

    emit({
      id: 1,
      title: "Downloaded",
      body: "Jungle",
      type: "library_media_downloaded",
      url: "/library/2542",
      metadata: { media_id: 2542 },
    });

    expect(screen.queryByText("Downloaded")).not.toBeNull();
  });

  it("stays quiet for a notification the server marked silent", () => {
    render(createElement(NotificationToastContainer), {
      wrapper: wrap(new QueryClient()),
    });

    emit({
      id: 2,
      title: "Application mise a jour",
      body: "v1.28.0",
      type: "app-update",
      url: "/",
      metadata: { silent: true, version: "v1.28.0" },
    });

    expect(screen.queryByText("Application mise a jour")).toBeNull();
  });
});

describe("NotificationToastContainer SSE connection", () => {
  it("opens the notification stream when the user is authenticated", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1" },
      isAuthenticated: true,
      isLoading: false,
    });
    const client = new QueryClient();
    render(createElement(NotificationToastContainer), {
      wrapper: wrap(client),
    });
    expect(streamOpened()).toBe(true);
  });

  it("opens the notification stream for an authenticated user even before React auth state resolves", () => {
    // Prod repro: NotificationToastContainer is mounted at the app root, where
    // useCurrentUser has not resolved yet, so useAuth() reports isAuthenticated=false
    // on the initial render even though the browser holds a valid session cookie.
    // The cookie-bearing EventSource would authenticate fine — so the stream MUST
    // still open. The old `enabled: isAuthenticated` gate left it closed forever
    // (it only reconnected after a route navigation re-rendered the container).
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });
    const client = new QueryClient();
    render(createElement(NotificationToastContainer), {
      wrapper: wrap(client),
    });
    expect(streamOpened()).toBe(true);
  });
});
