// Adds entries to Localizable.xcstrings without re-serialising the file
// (a JSON round-trip reorders integer-like keys such as "0").
// usage: bun scripts/add-l10n.ts entries.json
type Plural = { one: string; other: string };
type Entry = string | { en: Plural; fr: Plural };

const catalogPath = new URL("../Rawkoon/Localizable.xcstrings", import.meta.url).pathname;
const entries = JSON.parse(await Bun.file(process.argv[2]).text()) as Record<string, Entry>;
const text = await Bun.file(catalogPath).text();
const existing = new Set(Object.keys(JSON.parse(text).strings));

const unit = (value: string) => ({ stringUnit: { state: "translated", value } });
const plural = (p: Plural) => ({ variations: { plural: { one: unit(p.one), other: unit(p.other) } } });

const blocks: string[] = [];
for (const [key, entry] of Object.entries(entries)) {
  if (existing.has(key)) continue;
  const localizations =
    typeof entry === "string" ? { fr: unit(entry) } : { en: plural(entry.en), fr: plural(entry.fr) };
  const body = JSON.stringify({ localizations }, null, 2).split("\n").join("\n    ");
  blocks.push(`    ${JSON.stringify(key)}: ${body}`);
}
if (!blocks.length) {
  console.log("nothing to add");
  process.exit(0);
}
const anchor = '  "strings": {\n';
const at = text.indexOf(anchor);
if (at < 0) throw new Error("catalog anchor not found");
const insertAt = at + anchor.length;
const out = `${text.slice(0, insertAt)}${blocks.join(",\n")},\n${text.slice(insertAt)}`;
JSON.parse(out); // refuse to write an invalid catalog
await Bun.write(catalogPath, out);
console.log(`added ${blocks.length} entr${blocks.length === 1 ? "y" : "ies"}`);
