import type { Result } from "./assert";
import type { Route } from "./fixtures/types";

export interface Coverage {
  uncovered: Route[];
  extra: string[];
}

// Prints a per-endpoint table + summary and returns a process exit code:
// non-zero if any check failed or the coverage gate found uncovered/extra routes.
export function printReport(results: Result[], coverage: Coverage): number {
  const fails = results.filter((r) => !r.ok);
  for (const r of results) {
    const tag = r.ok ? "PASS" : "FAIL";
    const line = `${tag} ${r.kind.padEnd(8)} ${r.route.method.padEnd(6)} ${r.route.path} — ${r.detail} (${r.ms.toFixed(0)}ms)`;
    if (!r.ok) console.error(line);
    else if (process.env.E2E_VERBOSE) console.log(line);
  }

  if (coverage.uncovered.length) {
    console.error(`\nUNCOVERED (${coverage.uncovered.length}):`);
    for (const r of coverage.uncovered) {
      console.error(`  ${r.method} ${r.path}`);
    }
  }
  if (coverage.extra.length) {
    console.error(
      `\nEXTRA fixtures matching no route (${coverage.extra.length}):`,
    );
    for (const k of coverage.extra) console.error(`  ${k}`);
  }

  const byKind = (k: Result["kind"]) => results.filter((r) => r.kind === k);
  const passed = results.filter((r) => r.ok).length;
  console.log(
    `\nSUMMARY: ${passed}/${results.length} checks passed ` +
      `(positive ${byKind("positive").filter((r) => r.ok).length}/${byKind("positive").length}, ` +
      `negative ${byKind("negative").filter((r) => r.ok).length}/${byKind("negative").length}, ` +
      `auth ${byKind("auth").filter((r) => r.ok).length}/${byKind("auth").length}), ` +
      `uncovered ${coverage.uncovered.length}, extra ${coverage.extra.length}`,
  );

  return fails.length > 0 ||
    coverage.uncovered.length > 0 ||
    coverage.extra.length > 0
    ? 1
    : 0;
}

export async function writeResults(
  path: string,
  results: Result[],
): Promise<void> {
  const rows = results.map((r) => ({
    method: r.route.method,
    path: r.route.path,
    kind: r.kind,
    ok: r.ok,
    detail: r.detail,
  }));
  await Bun.write(path, `${JSON.stringify(rows, null, 2)}\n`);
}
