import { test as setup, expect, request } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, ".auth/state.json");

/**
 * Logs in once before the test suite and saves browser storage state
 * so authenticated tests don't need to re-login.
 *
 * Required env vars (fall back to dev defaults):
 *   TEST_EMAIL    — registered Rawkoon user email
 *   TEST_PASSWORD — that user's password
 */
setup("authenticate", async ({ page, baseURL }) => {
  const email = process.env.TEST_EMAIL ?? "test@example.com";
  const password = process.env.TEST_PASSWORD ?? "Password123!";

  // Pre-populate the version key so the app doesn't trigger a
  // window.location.reload() on first visit (version mismatch check).
  const apiContext = await request.newContext({ baseURL });
  const versionRes = await apiContext
    .get("/api/system/version")
    .catch(() => null);
  const serverVersion = versionRes?.ok()
    ? ((await versionRes.json().catch(() => ({}))).version ?? null)
    : null;

  if (serverVersion) {
    await page.addInitScript((v) => {
      localStorage.setItem("rawkoon_app_version", v);
    }, serverVersion);
  }

  await page.goto("/login");

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.locator('button[type="submit"]').click();

  // Wait until we land on an authenticated page
  await expect(page).toHaveURL(/\/(dashboard|board|$)/, { timeout: 15_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
