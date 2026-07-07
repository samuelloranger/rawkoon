/**
 * Simple error response helpers for Elysia route handlers.
 * Each function sets the HTTP status code and returns a consistent { error } shape.
 */

type ElysiaSet = { status?: number | string };

export const badRequest = (set: ElysiaSet, message: string) => {
  set.status = 400;
  return { error: message };
};

export const unauthorized = (set: ElysiaSet, message = "Unauthorized") => {
  set.status = 401;
  return { error: message };
};

export const forbidden = (set: ElysiaSet, message = "Forbidden") => {
  set.status = 403;
  return { error: message };
};

export const notFound = (set: ElysiaSet, message: string) => {
  set.status = 404;
  return { error: message };
};

export const conflict = (set: ElysiaSet, message: string) => {
  set.status = 409;
  return { error: message };
};

export const unprocessable = (set: ElysiaSet, message: string) => {
  set.status = 422;
  return { error: message };
};

export const serverError = (set: ElysiaSet, message: string) => {
  set.status = 500;
  return { error: message };
};

export const badGateway = (set: ElysiaSet, message: string) => {
  set.status = 502;
  return { error: message };
};

export const serviceUnavailable = (set: ElysiaSet, message: string) => {
  set.status = 503;
  return { error: message };
};
