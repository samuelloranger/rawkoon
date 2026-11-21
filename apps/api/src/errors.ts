/**
 * Error response helpers. Each returns a standard Web `Response` with the
 * `{ error }` shape and correct status, so a handler just does
 * `return errorHelper(msg)`.
 */

const errorResponse = (
  status: number,
  message: string,
  extra?: Record<string, unknown>,
) => Response.json({ error: message, ...extra }, { status });

/**
 * Success counterpart to the error helpers. Hono does not auto-serialize a
 * returned POJO, so success handlers return `ok(body)` instead of a bare object
 * — keeping every return path a Web `Response` and `c.json` out of the handlers.
 */
export const ok = (body: unknown, status = 200) =>
  Response.json(body, { status });

export const badRequest = (message: string, extra?: Record<string, unknown>) =>
  errorResponse(400, message, extra);

export const unauthorized = (message = "Unauthorized") =>
  errorResponse(401, message);

export const forbidden = (message = "Forbidden") => errorResponse(403, message);

export const notFound = (message: string) => errorResponse(404, message);

export const conflict = (message: string) => errorResponse(409, message);

export const tooManyRequests = (message: string) => errorResponse(429, message);

/**
 * better-auth's own limiter replies `{ message }` with a non-standard
 * `X-Retry-After`; give it the app's `{ error }` shape and `Retry-After`.
 * `message` stays because the better-auth client reads it.
 */
export async function normalizeAuthRateLimit(res: Response): Promise<Response> {
  if (res.status !== 429) return res;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { message?: unknown } | null;
  const message =
    typeof body?.message === "string"
      ? body.message
      : "Too many requests. Please try again later.";
  const out = errorResponse(429, message, { message });
  const retryAfter = res.headers.get("x-retry-after");
  if (retryAfter) out.headers.set("Retry-After", retryAfter);
  return out;
}

export const unprocessable = (message: string) => errorResponse(422, message);

export const errorForStatus = (status: number, message: string) =>
  errorResponse(status, message);

/** Stable `code` lets the web tell "TMDB not set up" from a failed request. */
export const tmdbNotConfigured = () =>
  Response.json(
    { error: "TMDB is not configured", code: "tmdb_not_configured" },
    { status: 400 },
  );

export const serverError = (message: string) => errorResponse(500, message);

export const badGateway = (message: string) => errorResponse(502, message);

export const serviceUnavailable = (message: string) =>
  errorResponse(503, message);
