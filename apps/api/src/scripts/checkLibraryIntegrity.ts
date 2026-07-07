/**
 * Report library integrity drift without mutating library records.
 *
 * Usage (from monorepo root):
 *   cd apps/api && bun --env-file=../../.env src/scripts/checkLibraryIntegrity.ts
 *   cd apps/api && bun --env-file=../../.env src/scripts/checkLibraryIntegrity.ts --persist
 *   cd apps/api && bun --env-file=../../.env src/scripts/checkLibraryIntegrity.ts --json
 */

import { runLibraryIntegrityCheck } from "@rawkoon/api/services/libraryIntegrityRun";
import { prisma } from "@rawkoon/api/db";

async function main() {
  const persist = process.argv.includes("--persist");
  const json = process.argv.includes("--json");
  const result = await runLibraryIntegrityCheck({
    trigger: persist ? "script" : "script-dry-run",
    persist,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Library integrity check ${result.status} in ${result.duration_ms}ms`,
  );
  if (result.status === "skipped") {
    console.log("(Concurrent run in progress — see warnings.)");
  }
  console.log(`Started:   ${result.started_at}`);
  console.log(`Completed: ${result.completed_at}`);
  console.log(`Persisted: ${persist ? "yes" : "no"}`);
  if (result.error) console.log(`Error: ${result.error}`);

  console.log("\nSummary");
  console.table(result.summary);

  if (result.warnings.length > 0) {
    console.log("\nWarnings");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }

  if (result.issues.length > 0) {
    console.log("\nIssues");
    for (const issue of result.issues) {
      console.log(`- [${issue.kind}] ${issue.detail}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
