// Captures README screenshots against a running, seeded Rawkoon instance.
// Assumes the API is serving the built SPA on one origin (auto-detected
// ./public). Usage: SCREENSHOT_URL=http://localhost:3000 bun scripts/screenshot/shots.ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { DEMO_USER } from "./demoUser";

const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:3000";
const OUT = join(import.meta.dir, "../../docs/screenshots");

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

// ── Login ────────────────────────────────────────────────────────────────────
// Sign in on a throwaway tab, then capture from fresh tabs: the tab that
// performed the login reliably crashes the renderer right after redirect
// (post-login bootstrap + SSE reconnect loop), a fresh tab with the session
// cookie renders fine.
const loginPage = await ctx.newPage();
await loginPage.goto(`${BASE}/login`, { waitUntil: "load" });
await loginPage.locator("#email").fill(DEMO_USER.email);
await loginPage.locator("#password").fill(DEMO_USER.password);
await loginPage.locator('button[type="submit"]').click();
await loginPage
  .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 })
  .catch(() => {}); // session cookie is set even if the redirected page crashes
await loginPage.close();

// One fresh tab per capture, one retry: the SPA occasionally crashes the
// renderer on this headless chromium; a clean tab almost always succeeds.
async function capture(path: string, name: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.locator('img[src*="image.tmdb.org"]').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(2000); // posters + layout settle
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      await page.close();
      console.log(`[shots] ${name}.png`);
      return true;
    } catch (err) {
      console.warn(`[shots] ${name} attempt ${attempt} failed: ${String(err).slice(0, 120)}`);
      await page.close().catch(() => {});
    }
  }
  return false;
}

const okLibrary = await capture("/library", "library");
const okDashboard = await capture("/", "dashboard");

await browser.close();
if (!okLibrary) throw new Error("library screenshot failed"); // README hero — hard-fail
if (!okDashboard) console.warn("[shots] dashboard skipped after retries");
