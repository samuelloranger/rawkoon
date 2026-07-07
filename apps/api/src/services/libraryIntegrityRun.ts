import type { Prisma } from "@prisma/client";
import type { LibraryHealthIssue, LibraryHealthSummary } from "@rawkoon/shared";
import { prisma } from "@rawkoon/api/db";
import { collectLibraryIntegrityIssues } from "@rawkoon/api/services/libraryIntegrityCollectors";
import {
  libraryHealthEmptySummary,
  summarizeLibraryHealthIssues,
  type LibraryIntegrityResult,
  type LibraryIntegrityStatus,
} from "@rawkoon/api/services/libraryIntegritySummary";

/** Maximum persisted library health runs before deleting oldest */
const MAX_LIBRARY_HEALTH_LOG_ROWS = 200;

let integrityCheckRunning = false;

async function pruneOldLibraryHealthLogs(): Promise<void> {
  const total = await prisma.libraryHealthLog.count();
  if (total <= MAX_LIBRARY_HEALTH_LOG_ROWS) return;
  const deleteCount = total - MAX_LIBRARY_HEALTH_LOG_ROWS;
  const stale = await prisma.libraryHealthLog.findMany({
    orderBy: { startedAt: "asc" },
    take: deleteCount,
    select: { id: true },
  });
  const ids = stale.map((s) => s.id);
  if (ids.length === 0) return;
  await prisma.libraryHealthLog.deleteMany({ where: { id: { in: ids } } });
}

async function persistLibraryRun(data: {
  status: LibraryIntegrityStatus;
  trigger: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  summary: LibraryHealthSummary;
  issues: LibraryHealthIssue[];
  warnings: string[];
  error: string | null;
}): Promise<void> {
  await prisma.libraryHealthLog.create({
    data: {
      status: data.status,
      trigger: data.trigger,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      durationMs: data.durationMs,
      summary: data.summary as unknown as Prisma.InputJsonValue,
      issues: data.issues as unknown as Prisma.InputJsonValue,
      warnings: data.warnings,
      error: data.error,
    },
  });
  await pruneOldLibraryHealthLogs();
}

export async function checkLibraryIntegrity(): Promise<{
  issues: LibraryHealthIssue[];
  warnings: string[];
}> {
  return collectLibraryIntegrityIssues();
}

export async function runLibraryIntegrityCheck(options?: {
  trigger?: string;
  persist?: boolean;
}): Promise<LibraryIntegrityResult> {
  const trigger = options?.trigger ?? "manual";
  const persist = options?.persist ?? true;

  if (integrityCheckRunning) {
    console.warn(
      "[libraryIntegrity] check already running — skipping duplicate run",
    );
    const now = new Date();
    const skipped: LibraryIntegrityResult = {
      status: "skipped",
      trigger,
      started_at: now.toISOString(),
      completed_at: now.toISOString(),
      duration_ms: 0,
      summary: libraryHealthEmptySummary(),
      issues: [],
      warnings: [
        "Library integrity check already running — this run was skipped.",
      ],
      error: null,
    };

    if (persist) {
      await persistLibraryRun({
        status: skipped.status,
        trigger,
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        summary: skipped.summary,
        issues: [],
        warnings: skipped.warnings,
        error: null,
      });
    }

    return skipped;
  }

  const startedAt = new Date();
  const started = Date.now();

  integrityCheckRunning = true;
  try {
    const { issues, warnings } = await checkLibraryIntegrity();
    const completedAt = new Date();
    const result: LibraryIntegrityResult = {
      status: "success",
      trigger,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: Date.now() - started,
      summary: summarizeLibraryHealthIssues(issues),
      issues,
      warnings,
      error: null,
    };

    if (persist) {
      await persistLibraryRun({
        status: result.status,
        trigger,
        startedAt,
        completedAt,
        durationMs: result.duration_ms,
        summary: result.summary,
        issues: result.issues,
        warnings,
        error: null,
      });
    }

    return result;
  } catch (error) {
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    const result: LibraryIntegrityResult = {
      status: "failed",
      trigger,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: Date.now() - started,
      summary: libraryHealthEmptySummary(),
      issues: [],
      warnings: [],
      error: message,
    };

    if (persist) {
      await persistLibraryRun({
        status: result.status,
        trigger,
        startedAt,
        completedAt,
        durationMs: result.duration_ms,
        summary: result.summary,
        issues: [],
        warnings: [],
        error: message,
      });
    }

    return result;
  } finally {
    integrityCheckRunning = false;
  }
}
