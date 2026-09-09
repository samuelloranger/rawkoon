/**
 * Framework-neutral error response helpers.
 * Each returns a standard Web `Response` with the `{ error }` shape and correct
 * status — a plain handler `return errorHelper(msg)` works identically under
 * Elysia and Hono (both pass through `Response`), with no framework `set`.
 */

const errorResponse = (status: number, message: string) =>
  Response.json({ error: message }, { status });

export const badRequest = (message: string) => errorResponse(400, message);

export const unauthorized = (message = "Unauthorized") =>
  errorResponse(401, message);

export const forbidden = (message = "Forbidden") => errorResponse(403, message);

export const notFound = (message: string) => errorResponse(404, message);

export const conflict = (message: string) => errorResponse(409, message);

export const unprocessable = (message: string) => errorResponse(422, message);

export const serverError = (message: string) => errorResponse(500, message);

export const badGateway = (message: string) => errorResponse(502, message);

export const serviceUnavailable = (message: string) =>
  errorResponse(503, message);
