import { sValidator } from "@hono/standard-validator";
import type { z } from "zod";
import { badRequest } from "@rawkoon/api/errors";

/**
 * Validator wrappers that preserve the API's error contract.
 *
 * Hono's `sValidator` returns the raw StandardSchema result as `400 { ... }` on
 * failure — a different body than the rest of the API. These wrappers supply a
 * failure hook that returns the neutral `badRequest` helper instead, so an
 * invalid request still answers `400 { error: <message> }`, the same shape as
 * every other error.
 */

// Standard Schema reports failures as a flat `readonly Issue[]`; a path segment
// is a key or `{ key }`.
type Issue = {
  message?: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
};

const issuePath = (issue: Issue): string =>
  (issue.path ?? [])
    .map((seg) => String(typeof seg === "object" ? seg.key : seg))
    .join(".");

// `error` stays a string (clients read it); `issues` lists every failure.
export const validationFailure = (issues: ReadonlyArray<Issue>) => {
  const list = issues.map((i) => ({
    path: issuePath(i),
    message: i.message ?? "Invalid request",
  }));
  const first = list[0];
  if (!first) return badRequest("Invalid request", { issues: list });
  const message = first.path
    ? `${first.path}: ${first.message}`
    : first.message;
  return badRequest(message, { issues: list });
};

export const jsonV = <T extends z.ZodType>(schema: T) =>
  sValidator("json", schema, (result, _c) => {
    if (!result.success) return validationFailure(result.error);
  });

export const queryV = <T extends z.ZodType>(schema: T) =>
  sValidator("query", schema, (result, _c) => {
    if (!result.success) return validationFailure(result.error);
  });

export const paramV = <T extends z.ZodType>(schema: T) =>
  sValidator("param", schema, (result, _c) => {
    if (!result.success) return validationFailure(result.error);
  });
