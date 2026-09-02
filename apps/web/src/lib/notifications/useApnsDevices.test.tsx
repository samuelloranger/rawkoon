import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetcher = vi.fn().mockResolvedValue({
  devices: [
    {
      id: 1,
      device_name: "iPhone",
      os_version: "18.2",
      app_version: "1.12.8",
      created_at: "2026-09-01T00:00:00Z",
    },
  ],
});
vi.mock("@/lib/api/context", () => ({ useFetcher: () => fetcher }));

import { useApnsDevices } from "./useApnsDevices";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useApnsDevices", () => {
  it("fetches APNS devices from the apns/devices endpoint", async () => {
    const { result } = renderHook(() => useApnsDevices(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.devices[0].device_name).toBe("iPhone");
    expect(fetcher).toHaveBeenCalledWith("/api/notifications/apns/devices");
  });
});
