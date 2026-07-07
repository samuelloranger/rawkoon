import { createContext, useContext } from "react";

export type FetcherOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string | number | undefined>;
};

export type Fetcher = <T>(
  endpoint: string,
  options?: FetcherOptions,
) => Promise<T>;

const FetcherContext = createContext<Fetcher | null>(null);

export function useFetcher(): Fetcher {
  const fetcher = useContext(FetcherContext);
  if (!fetcher) {
    throw new Error("useFetcher must be used within a FetcherProvider");
  }
  return fetcher;
}

export type FetcherProviderProps = {
  fetcher: Fetcher;
  children: React.ReactNode;
};

export function FetcherProvider({
  fetcher,
  children,
}: FetcherProviderProps): React.ReactElement {
  return (
    <FetcherContext.Provider value={fetcher}>
      {children}
    </FetcherContext.Provider>
  );
}
