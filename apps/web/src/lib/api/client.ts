import { createHttpClient, HttpError } from "@/lib/api/httpClient";

const API_BASE = import.meta.env.PROD ? "" : "";

const webHttpClient = createHttpClient({
  baseUrl: API_BASE,
  authMode: "cookie",
  prod: import.meta.env.PROD,
  networkErrorMessage: {
    prod: "Unable to connect to server. Please check your internet connection and try again.",
    dev: "Unable to connect to server. Please ensure the backend is running.\n\nTo start the backend:\n  make dev-api    (backend only)",
  },
});

export async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  return webHttpClient.request<T>(endpoint, {
    method: options?.method as
      | "GET"
      | "POST"
      | "PUT"
      | "DELETE"
      | "PATCH"
      | undefined,
    headers: options?.headers,
    body: options?.body,
  });
}

export { HttpError as ApiError };
