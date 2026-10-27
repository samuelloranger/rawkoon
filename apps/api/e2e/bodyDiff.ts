// Behaviour-parity diff: compare two E2E_RECORD captures call by call, including
// response bodies, so a refactor that keeps the status but changes the payload fails.
// Usage: bun run e2e/bodyDiff.ts <before.json> <after.json> [--ignore key1,key2]
import type { RecordedCall } from "./httpClient";

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Session tokens, invitation tokens and hook secrets are random per run.
const RANDOM_TOKEN = /[A-Za-z0-9_-]{32,}/g;
const DEV_VERSION = /0\.0\.0-dev\+\d+/g;

function scrub(text: string): string {
  return text
    .replace(UUID, "<uuid>")
    .replace(RANDOM_TOKEN, "<token>")
    .replace(DEV_VERSION, "<dev-version>");
}

function normalize(value: unknown, ignore: Set<string>): unknown {
  if (typeof value === "string") {
    return ISO_DATE.test(value) ? "<date>" : scrub(value);
  }
  if (Array.isArray(value)) return value.map((v) => normalize(v, ignore));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = ignore.has(key)
        ? "<ignored>"
        : normalize((value as Record<string, unknown>)[key], ignore);
    }
    return out;
  }
  return value;
}

function firstDifference(a: unknown, b: unknown, at = "$"): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const diff = firstDifference(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${at}.${key}`,
      );
      if (diff) return diff;
    }
  }
  const show = (v: unknown) => JSON.stringify(v)?.slice(0, 160);
  return `${at}: ${show(a)} -> ${show(b)}`;
}

const args = process.argv.slice(2);
const ignoreAt = args.indexOf("--ignore");
const ignore = new Set(
  ignoreAt >= 0 ? (args[ignoreAt + 1] ?? "").split(",").filter(Boolean) : [],
);
const [beforePath, afterPath] =
  ignoreAt >= 0
    ? args.filter((_, i) => i !== ignoreAt && i !== ignoreAt + 1)
    : args;
if (!beforePath || !afterPath) {
  console.error(
    "usage: bun run e2e/bodyDiff.ts <before.json> <after.json> [--ignore k1,k2]",
  );
  process.exit(2);
}

const before = (await Bun.file(beforePath).json()) as RecordedCall[];
const after = (await Bun.file(afterPath).json()) as RecordedCall[];
const divergences: string[] = [];
const total = Math.max(before.length, after.length);

for (let i = 0; i < total; i++) {
  const a = before[i];
  const b = after[i];
  if (!a || !b) {
    divergences.push(`#${i}: call only in ${a ? beforePath : afterPath}`);
    continue;
  }
  const label = `#${i} ${a.method} ${a.path}${a.authed ? "" : " (anon)"}`;
  if (a.method !== b.method || scrub(a.path) !== scrub(b.path)) {
    divergences.push(
      `${label}: sequence drift, after made ${b.method} ${b.path}`,
    );
    continue;
  }
  if (a.status !== b.status) {
    divergences.push(`${label}: status ${a.status} -> ${b.status}`);
  }
  const diff = firstDifference(
    normalize(a.body, ignore),
    normalize(b.body, ignore),
  );
  if (diff) divergences.push(`${label}: body ${diff}`);
}

console.log(`${total} calls compared, ${divergences.length} divergence(s)`);
for (const d of divergences) console.log(`  ${d}`);
process.exit(divergences.length ? 1 : 0);
