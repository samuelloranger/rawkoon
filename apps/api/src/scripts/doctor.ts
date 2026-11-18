/**
 * Rawkoon doctor: probe every dependency (database, migrations, Valkey,
 * scheduled jobs, library paths, free space, hardlink support, indexer
 * manager, download client, Jellyfin, TMDB) and print one line per check.
 * Exit code is 1 when any check fails.
 *
 * Usage (from apps/api):
 *   bun run doctor:dev   (dev: loads the repo .env)
 *   bun run doctor       (container: env comes from the container itself)
 */

import type { DoctorReport } from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import { valkey } from "@rawkoon/api/db/valkey";
import { closeAllQueues } from "@rawkoon/api/services/queueService";
import { runDoctor } from "@rawkoon/api/services/doctor/runDoctor";

const LABELS: Record<DoctorReport["status"], string> = {
  ok: "OK  ",
  warn: "WARN",
  fail: "FAIL",
};

function printReport(report: DoctorReport): void {
  const width = Math.max(...report.checks.map((check) => check.title.length));
  console.log(`rawkoon doctor — ${report.version} — ${report.checked_at}`);
  for (const check of report.checks) {
    console.log(
      `${LABELS[check.status]}  ${check.title.padEnd(width)}  ${check.summary}`,
    );
    if (check.fix) {
      // Indent to align with the summary column.
      console.log(`${" ".repeat(width + 8)}fix: ${check.fix}`);
    }
  }
  const failed = report.checks.filter((c) => c.status === "fail").length;
  const warned = report.checks.filter((c) => c.status === "warn").length;
  console.log(
    `\n${failed} failed, ${warned} warned — overall ${report.status}.`,
  );
}

async function main(): Promise<number> {
  const report = await runDoctor();
  printReport(report);
  return report.status === "fail" ? 1 : 0;
}

// quit() can stall on a client that never connected; force-close after a beat.
async function closeValkey(): Promise<void> {
  await Promise.race([
    valkey.quit(),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  valkey.disconnect();
}

// The doctor borrows the API's process-wide clients (prisma, valkey, BullMQ
// queues); close each so the CLI exits by itself — workers are never started.
async function shutdown(exitCode: number): Promise<never> {
  await Promise.allSettled([
    prisma.$disconnect(),
    closeValkey(),
    closeAllQueues(),
  ]);
  process.exit(exitCode);
}

main()
  .then((exitCode) => shutdown(exitCode))
  .catch((error) => {
    console.error(error);
    return shutdown(1);
  });
