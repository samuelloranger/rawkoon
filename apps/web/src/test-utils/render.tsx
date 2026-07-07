/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FetcherProvider } from "@/lib/api/context";
import { ConfirmProvider } from "@/components/confirm/ConfirmContext";
import { vi } from "vitest";

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
  fetcher?: any;
}

const defaultFetcher = vi.fn().mockImplementation(() => Promise.resolve({}));

export function renderWithProviders(
  ui: ReactElement,
  {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    }),
    fetcher = defaultFetcher,
    ...renderOptions
  }: CustomRenderOptions = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetcherProvider fetcher={fetcher}>
        <QueryClientProvider client={queryClient}>
          <ConfirmProvider>{children}</ConfirmProvider>
        </QueryClientProvider>
      </FetcherProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
    fetcher,
  };
}

export * from "@testing-library/react";
