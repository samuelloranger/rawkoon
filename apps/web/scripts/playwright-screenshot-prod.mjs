/**
 * Debug: load prod URL, wait, screenshot, dump client errors + body snippet.
 * Usage: bun scripts/playwright-screenshot-prod.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const baseURL = process.env.BASE_URL ?? "https://rawkoon.example.com";
const outDir = dirname(fileURLToPath(import.meta.url));
const pngPath = join(outDir, "..", "screenshot-prod.png");

const errors = [];
const warnings = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on("pageerror", (err) => {
  errors.push(`pageerror: ${err.message}`);
});
page.on("console", (msg) => {
  const t = msg.type();
  const text = msg.text();
  if (t === "error") errors.push(`console.error: ${text}`);
  if (t === "warning") warnings.push(text);
});

try {
  await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 90_000 });
} catch (e) {
  console.error("goto failed:", e.message);
}

await new Promise((r) => setTimeout(r, 4000));

const title = await page.title();
const bodySnippet = await page.evaluate(() => {
  const root = document.getElementById("root");
  const t = document.body?.innerText?.trim()?.slice(0, 800) ?? "";
  return {
    bodyLen: document.body?.innerText?.length ?? 0,
    rootChildCount: root?.childElementCount ?? -1,
    snippet: t,
  };
});

await page.screenshot({ path: pngPath, fullPage: true });

const report = {
  url: page.url(),
  title,
  bodySnippet,
  errors,
  warnings: warnings.slice(0, 20),
};
writeFileSync(
  join(outDir, "..", "screenshot-prod-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
console.error("screenshot:", pngPath);

await browser.close();
process.exit(errors.length ? 1 : 0);
