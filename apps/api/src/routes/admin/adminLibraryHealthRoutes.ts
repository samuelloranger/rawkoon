import { Elysia } from "elysia";
import { prisma } from "@rawkoon/api/db";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { formatIso } from "@rawkoon/api/utils";
import { serverError } from "@rawkoon/api/errors";

export const adminLibraryHealthRoutes = new Elysia()
  .use(requireAdmin)
  // GET /api/admin/library-health - Latest persisted library integrity checks
  .get("/library-health", async ({ query, set }) => {
    try {
      const limit = Math.min(
        25,
        Math.max(1, parseInt((query.limit as string) || "5", 10) || 5),
      );
      const logs = await prisma.libraryHealthLog.findMany({
        orderBy: { startedAt: "desc" },
        take: limit,
      });

      const getIssueCount = (summary: unknown) => {
        if (typeof summary !== "object" || summary === null) return 0;
        const total = (summary as { total_issues?: unknown }).total_issues;
        return typeof total === "number" ? total : 0;
      };

      const latest = logs[0]
        ? {
            id: logs[0].id,
            status: logs[0].status,
            trigger: logs[0].trigger,
            started_at: formatIso(logs[0].startedAt),
            completed_at: formatIso(logs[0].completedAt),
            duration_ms: logs[0].durationMs,
            summary: logs[0].summary,
            issues: logs[0].issues,
            warnings: logs[0].warnings,
            error: logs[0].error,
          }
        : null;

      return {
        latest,
        history: logs.slice(1).map((log) => ({
          id: log.id,
          status: log.status,
          trigger: log.trigger,
          started_at: formatIso(log.startedAt),
          completed_at: formatIso(log.completedAt),
          duration_ms: log.durationMs,
          summary: log.summary,
          issue_count: getIssueCount(log.summary),
          warnings: log.warnings,
          error: log.error,
        })),
      };
    } catch (error) {
      console.error("Error fetching library health:", error);
      return serverError(set, "Failed to fetch library health");
    }
  });
