// The single seam every sweep request goes through: real HTTP against BASE_URL.
// No framework import, no app.handle — this is what makes the suite run
// identically against Elysia and Hono.

// Validation-failure status pinned here so both frameworks are held to the same
// code for the negative (bad-body) check, rather than each framework's default.
export const VALIDATION_STATUS = 422;

export interface HttpResult {
  status: number;
  json: unknown;
  text: string;
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

  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}
