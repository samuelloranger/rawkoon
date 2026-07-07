/**
 * Headless smoke: load the app and surface console/page errors.
 * Usage: BASE_URL=http://127.0.0.1:3000 bun scripts/playwright-load.mjs
 */
import { chromium } from "playwright";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";

const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("pageerror", (err) => {
  errors.push(`pageerror: ${err.message}`);
});
page.on("console", (msg) => {
  if (msg.type() === "error") {
    errors.push(`console: ${msg.text()}`);
  }
});

let response;
try {
  response = await page.goto(baseURL, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
} catch (e) {
  console.error("goto failed:", e.message);
  await browser.close();
  process.exit(1);
}

const status = response?.status() ?? 0;
const title = await page.title();
const url = page.url();

console.log(
  JSON.stringify(
    { ok: status >= 200 && status < 400, status, url, title },
    null,
    2,
  ),
);

if (errors.length) {
  console.error("Client-side errors:", errors);
}

await browser.close();
process.exit(errors.length ? 1 : 0);
