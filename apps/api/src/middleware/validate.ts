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

// Standard Schema reports failures as a flat `readonly Issue[]`.
const firstIssueMessage = (
  issues: ReadonlyArray<{ message?: string }>,
): string => issues[0]?.message ?? "Invalid request";

export const jsonV = <T extends z.ZodType>(schema: T) =>
  sValidator("json", schema, (result, _c) => {
    if (!result.success) return badRequest(firstIssueMessage(result.error));
  });

export const queryV = <T extends z.ZodType>(schema: T) =>
  sValidator("query", schema, (result, _c) => {
    if (!result.success) return badRequest(firstIssueMessage(result.error));
  });

export const paramV = <T extends z.ZodType>(schema: T) =>
  sValidator("param", schema, (result, _c) => {
    if (!result.success) return badRequest(firstIssueMessage(result.error));
  });
