import { createFetcher } from "@/lib/api/httpClient";
import type { Fetcher } from "@/lib/api/context";
import { fetchApi } from "@/lib/api/client";

export const webFetcher: Fetcher = createFetcher(
  (endpoint, options) =>
    fetchApi(endpoint, {
      method: options.method,
      headers: options.headers,
      body: options.body as BodyInit | null | undefined,
    }),
  { serializeJsonBody: true },
);
