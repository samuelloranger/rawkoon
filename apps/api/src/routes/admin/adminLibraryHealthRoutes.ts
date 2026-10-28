import { Hono } from "hono";
import { z } from "zod";
import type { LibraryHealthIssue } from "@rawkoon/shared";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  ignoreLibraryHealthIssue,
  listIgnoredIssueKeys,
  listLibraryHealthIgnores,
  restoreLibraryHealthIssue,
} from "@rawkoon/api/services/admin/libraryHealthIgnores";
import { listRecentLibraryHealthLogs } from "@rawkoon/api/services/admin/libraryHealthLogs";
import { withoutIgnoredIssues } from "@rawkoon/api/services/libraryIntegrity/libraryHealthIgnoreFilter";
import { formatIso } from "@rawkoon/api/utils";

const asIssues = (value: unknown): LibraryHealthIssue[] =>
  Array.isArray(value) ? (value as LibraryHealthIssue[]) : [];

// Mounted under /api/admin; requireAdmin is applied at the admin parent.
export const adminLibraryHealthRoutes = new Hono<Env>()
  .get("/library-health", async (c) => {
    try {
      const limit = Math.min(
        25,
        Math.max(1, parseInt(c.req.query("limit") || "5", 10) || 5),
      );
      const [logs, ignoredKeys] = await Promise.all([
        listRecentLibraryHealthLogs(limit),
        listIgnoredIssueKeys(),
      ]);
      // A run that never got as far as its issues keeps its stored summary.
      const visible = (log: (typeof logs)[number]) =>
        log.status === "success"
          ? withoutIgnoredIssues(asIssues(log.issues), ignoredKeys)
          : null;

      const first = logs[0];
      const firstVisible = first ? visible(first) : null;
      const latest = first
        ? {
            id: first.id,
            status: first.status,
            trigger: first.trigger,
            started_at: formatIso(first.startedAt),
            completed_at: formatIso(first.completedAt),
            duration_ms: first.durationMs,
            summary: firstVisible?.summary ?? first.summary,
            issues: firstVisible?.issues ?? asIssues(first.issues),
            warnings: first.warnings,
            error: first.error,
            ignored_count: firstVisible?.ignoredCount ?? 0,
          }
        : null;

      return ok({
        latest,
        history: logs.slice(1).map((log) => {
          const kept = visible(log);
          return {
            id: log.id,
            status: log.status,
            trigger: log.trigger,
            started_at: formatIso(log.startedAt),
            completed_at: formatIso(log.completedAt),
            duration_ms: log.durationMs,
            summary: kept?.summary ?? log.summary,
            issue_count: kept?.summary.total_issues ?? 0,
            warnings: log.warnings,
            error: log.error,
          };
        }),
      });
    } catch (error) {
      console.error("Error fetching library health:", error);
      return serverError("Failed to fetch library health");
    }
  })
  .get("/library-health/ignores", async () => {
    try {
      return ok({ ignores: await listLibraryHealthIgnores() });
    } catch (error) {
      console.error("Error listing ignored library health issues:", error);
      return serverError("Failed to list ignored issues");
    }
  })
  .post(
    "/library-health/ignores",
    jsonV(z.object({ issue_key: z.string().min(1).max(200) })),
    async (c) => {
      try {
        const result = await ignoreLibraryHealthIssue(
          c.req.valid("json").issue_key,
        );
        if (result.kind === "not_found") {
          return notFound("The latest library health run has no such issue");
        }
        return ok({ ignore: result.ignore });
      } catch (error) {
        console.error("Error ignoring library health issue:", error);
        return serverError("Failed to ignore the issue");
      }
    },
  )
  .delete("/library-health/ignores/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return badRequest("Invalid id");
    try {
      if (!(await restoreLibraryHealthIssue(id))) {
        return notFound("No such ignored issue");
      }
      return ok({ restored: true });
    } catch (error) {
      console.error("Error restoring library health issue:", error);
      return serverError("Failed to restore the issue");
    }
  });
