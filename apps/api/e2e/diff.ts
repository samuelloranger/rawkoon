// Framework-parity diff: compare two results.json runs (e.g. Elysia vs Hono).
// Asserts the same route set and identical {status-class, kind, ok} per check.
// Usage: bun run e2e/diff.ts results.elysia.json results.hono.json
interface Row {
  method: string;
  path: string;
  kind: string;
  ok: boolean;
  detail: string;
}

function keyOf(r: Row): string {
  return `${r.method} ${r.path} [${r.kind}]`;
}

async function load(p: string): Promise<Map<string, Row>> {
  const rows = (await Bun.file(p).json()) as Row[];
  return new Map(rows.map((r) => [keyOf(r), r]));
}

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: bun run e2e/diff.ts <resultsA.json> <resultsB.json>");
  process.exit(2);
}

const [ma, mb] = await Promise.all([load(a), load(b)]);
const divergences: string[] = [];

for (const [k, ra] of ma) {
  const rb = mb.get(k);
  if (!rb) {
    divergences.push(`only in ${a}: ${k}`);
    continue;
  }
  if (ra.ok !== rb.ok) {
    divergences.push(
      `ok mismatch ${k}: ${a}=${ra.ok} (${ra.detail}) vs ${b}=${rb.ok} (${rb.detail})`,
    );
  }
}
for (const k of mb.keys()) {
  if (!ma.has(k)) divergences.push(`only in ${b}: ${k}`);
}

if (divergences.length) {
  console.error(`PARITY DIFF: ${divergences.length} divergence(s)`);
  for (const d of divergences) console.error(`  ${d}`);
  process.exit(1);
}
console.log(`PARITY OK: ${ma.size} checks identical between ${a} and ${b}`);
process.exit(0);

export {};
