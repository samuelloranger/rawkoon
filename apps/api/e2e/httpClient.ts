// The single seam every sweep request goes through: real HTTP against BASE_URL.
// No framework import, no app.handle — this is what makes the suite run
// identically against Elysia and Hono.

// Validation-failure status pinned here so both frameworks are held to the same
// code for the negative (bad-body) check. Elysia returns 400 for a failed
// validator; if Hono's standard-validator differs, change it here (one place).
export const VALIDATION_STATUS = 400;

export interface HttpResult {
  status: number;
  json: unknown;
  text: string;
  headers: Headers;
}

// In-process by default (dispatch through the framework seam — no socket, which
// this sandbox forbids); real HTTP when BASE_URL is set (CI / Playwright).
let dispatchFn: ((req: Request) => Promise<Response>) | null = null;
async function getDispatch(): Promise<(req: Request) => Promise<Response>> {
  if (!dispatchFn) dispatchFn = (await import("./server")).dispatch;
  return dispatchFn;
}

export interface RequestOpts {
  cookie?: string;
  query?: Record<string, string>;
  body?: unknown;
}

export function baseUrl(): string {
  return process.env.BASE_URL || "http://localhost:3111";
}

export async function request(
  method: string,
  path: string,
  opts: RequestOpts = {},
): Promise<HttpResult> {
  const url = new URL(path, baseUrl());
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  const hasBody = opts.body !== undefined && method !== "GET";
  if (hasBody) headers["content-type"] = "application/json";

  const init: RequestInit = {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  };
  const res = process.env.BASE_URL
    ? await fetch(url, init)
    : await (await getDispatch())(new Request(url, init));
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}
