import type { LibraryHealthIgnore, LibraryHealthIssue } from "@rawkoon/shared";
import { prisma } from "@rawkoon/api/db";
import { libraryHealthIssueKey } from "@rawkoon/api/services/libraryIntegrity/libraryHealthIgnoreFilter";
import { formatIso } from "@rawkoon/api/utils";

type IgnoreRow = {
  id: number;
  issueKey: string;
  kind: string;
  title: string | null;
  detail: string;
  createdAt: Date;
};

function toIgnore(row: IgnoreRow): LibraryHealthIgnore {
  return {
    id: row.id,
    issue_key: row.issueKey,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    created_at: formatIso(row.createdAt) ?? row.createdAt.toISOString(),
  };
}

export async function listIgnoredIssueKeys(): Promise<Set<string>> {
  const rows = await prisma.libraryHealthIgnore.findMany({
    select: { issueKey: true },
  });
  return new Set(rows.map((row) => row.issueKey));
}

export async function listLibraryHealthIgnores(): Promise<
  LibraryHealthIgnore[]
> {
  const rows = await prisma.libraryHealthIgnore.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toIgnore);
}

/** Ignores an issue from the latest run; the key must name one of its issues. */
export async function ignoreLibraryHealthIssue(
  issueKey: string,
): Promise<
  { kind: "ok"; ignore: LibraryHealthIgnore } | { kind: "not_found" }
> {
  const latest = await prisma.libraryHealthLog.findFirst({
    orderBy: { startedAt: "desc" },
    select: { issues: true },
  });
  const issues = Array.isArray(latest?.issues)
    ? (latest.issues as unknown as LibraryHealthIssue[])
    : [];
  const issue = issues.find(
    (candidate) => libraryHealthIssueKey(candidate) === issueKey,
  );
  if (!issue) return { kind: "not_found" };

  const row = await prisma.libraryHealthIgnore.upsert({
    where: { issueKey },
    create: {
      issueKey,
      kind: issue.kind,
      title: issue.title ?? null,
      detail: issue.detail,
    },
    update: {},
  });
  return { kind: "ok", ignore: toIgnore(row) };
}

/** Counts the issue again; false when there was no such ignore. */
export async function restoreLibraryHealthIssue(id: number): Promise<boolean> {
  const { count } = await prisma.libraryHealthIgnore.deleteMany({
    where: { id },
  });
  return count > 0;
}
