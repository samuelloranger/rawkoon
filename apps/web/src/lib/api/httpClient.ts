import type { Fetcher, FetcherOptions } from "@/lib/api/context";

type LowLevelRequest = <T>(
  endpoint: string,
  options: {
    method?: FetcherOptions["method"];
    headers?: FetcherOptions["headers"];
    body?: unknown;
  },
) => Promise<T>;

type CreateFetcherOptions = {
  serializeJsonBody?: boolean;
};

export class HttpError extends Error {
  status: number;
  response?: Response;
  data?: unknown;

  constructor(
    message: string,
    status: number,
    response?: Response,
    data?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.response = response;
    this.data = data;
  }

  /** Returns the API-level `error` string from the response body, if present. */
  apiError(): string | undefined {
    const d = this.data as { error?: unknown } | null | undefined;
    return typeof d?.error === "string" ? d.error : undefined;
  }
}

type AuthMode = "cookie" | "bearer";

type TokenProvider = () => Promise<string | null> | string | null;

export type HttpClientOptions = {
  baseUrl?: string;
  authMode: AuthMode;
  getAccessToken?: TokenProvider;
  refreshAccessToken?: () => Promise<string | null>;
  onAuthFailure?: () => Promise<void> | void;
  prod?: boolean;
  networkErrorMessage?: {
    prod: string;
    dev: string;
  };
};

type HttpRequestOptions = {
  method?: FetcherOptions["method"];
  headers?: Record<string, string> | Headers | [string, string][];
  body?: unknown;
};

export type HttpClient = {
  request: <T>(endpoint: string, options?: HttpRequestOptions) => Promise<T>;
  get: <T>(
    endpoint: string,
    options?: Omit<HttpRequestOptions, "method" | "body">,
  ) => Promise<T>;
  post: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, "method" | "body">,
  ) => Promise<T>;
  put: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, "method" | "body">,
  ) => Promise<T>;
  patch: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<HttpRequestOptions, "method" | "body">,
  ) => Promise<T>;
  delete: <T>(
    endpoint: string,
    options?: Omit<HttpRequestOptions, "method" | "body">,
  ) => Promise<T>;
};

function normalizeHeaders(
  input?: Record<string, string> | Headers | [string, string][],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(input)) {
    input.forEach(([key, value]) => {
      out[key] = value;
    });
    return out;
  }
  Object.assign(out, input);
  return out;
}

function buildUrl(baseUrl: string | undefined, endpoint: string): string {
  if (!baseUrl) return endpoint;
  if (/^https?:\/\//.test(endpoint)) return endpoint;
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${trimmed}${path}`;
}

async function parseResponseData(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => undefined);
  }
  return response.text().catch(() => undefined);
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const request = async <T>(
    endpoint: string,
    requestOptions: HttpRequestOptions = {},
    retryingAfterRefresh: boolean = false,
  ): Promise<T> => {
    const method = requestOptions.method || "GET";
    const headers = normalizeHeaders(requestOptions.headers);
    const hasBody = requestOptions.body !== undefined;
    const isFormData =
      typeof FormData !== "undefined" &&
      requestOptions.body instanceof FormData;

    if (
      options.authMode === "bearer" &&
      options.getAccessToken &&
      !headers.Authorization
    ) {
      const token = await options.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let body:
      | string
      | FormData
      | Blob
      | ArrayBuffer
      | ReadableStream
      | undefined;
    if (hasBody) {
      if (!isFormData && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }

      if (!isFormData && typeof requestOptions.body !== "string") {
        body = JSON.stringify(requestOptions.body);
      } else {
        body = requestOptions.body as typeof body;
      }
    }

    const url = buildUrl(options.baseUrl, endpoint);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        credentials: options.authMode === "cookie" ? "include" : "same-origin",
      });

      if (
        response.status === 401 &&
        options.authMode === "bearer" &&
        options.refreshAccessToken &&
        !retryingAfterRefresh
      ) {
        const nextToken = await options.refreshAccessToken();
        if (nextToken) {
          const retryHeaders = {
            ...headers,
            Authorization: `Bearer ${nextToken}`,
          };
          return request<T>(
            endpoint,
            {
              ...requestOptions,
              headers: retryHeaders,
            },
            true,
          );
        }
        if (options.onAuthFailure) {
          await options.onAuthFailure();
        }
      }

      if (!response.ok) {
        const errorData = await parseResponseData(response);
        const apiErrorField =
          errorData &&
          typeof errorData === "object" &&
          "error" in errorData &&
          typeof (errorData as { error?: unknown }).error === "string"
            ? (errorData as { error: string }).error
            : undefined;
        let errorMessage: string =
          apiErrorField || `HTTP error! status: ${response.status}`;

        if (options.prod && response.status >= 500 && !errorMessage) {
          errorMessage =
            "An internal server error occurred. Please try again later.";
        }

        throw new HttpError(errorMessage, response.status, response, errorData);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const data = await parseResponseData(response);
      return data as T;
    } catch (error) {
      if (error instanceof HttpError) throw error;

      if (
        error instanceof TypeError &&
        error.message.toLowerCase().includes("fetch")
      ) {
        const defaultNetworkMessage = options.prod
          ? "Unable to connect to server. Please check your internet connection and try again."
          : "Unable to connect to server. Please ensure the backend is running.";
        const message = options.networkErrorMessage
          ? options.prod
            ? options.networkErrorMessage.prod
            : options.networkErrorMessage.dev
          : defaultNetworkMessage;
        throw new HttpError(message, 500, undefined);
      }

      throw error;
    }
  };

  return {
    request,
    get: (endpoint, reqOptions) =>
      request(endpoint, {
        ...reqOptions,
        method: "GET",
      }),
    post: (endpoint, body, reqOptions) =>
      request(endpoint, {
        ...reqOptions,
        method: "POST",
        body,
      }),
    put: (endpoint, body, reqOptions) =>
      request(endpoint, {
        ...reqOptions,
        method: "PUT",
        body,
      }),
    patch: (endpoint, body, reqOptions) =>
      request(endpoint, {
        ...reqOptions,
        method: "PATCH",
        body,
      }),
    delete: (endpoint, reqOptions) =>
      request(endpoint, {
        ...reqOptions,
        method: "DELETE",
      }),
  };
}

export function createFetcher(
  request: LowLevelRequest,
  options: CreateFetcherOptions = {},
): Fetcher {
  const { serializeJsonBody = false } = options;

  return async <T>(
    endpoint: string,
    fetcherOptions?: FetcherOptions,
  ): Promise<T> => {
    const params = fetcherOptions?.params;
    const url = params
      ? `${endpoint}?${new URLSearchParams(
          Object.entries(params)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)]) as Array<
            [string, string]
          >,
        ).toString()}`
      : endpoint;

    const rawBody = fetcherOptions?.body;
    const body =
      serializeJsonBody &&
      rawBody !== undefined &&
      typeof rawBody !== "string" &&
      !(rawBody instanceof FormData)
        ? JSON.stringify(rawBody)
        : rawBody;

    return request<T>(url, {
      method: fetcherOptions?.method,
      headers: fetcherOptions?.headers,
      body,
    });
  };
}
