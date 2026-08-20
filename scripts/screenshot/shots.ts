// Captures README screenshots against a running, seeded Rawkoon instance.
// Assumes the API is serving the built SPA on one origin (auto-detected
// ./public). Usage: SCREENSHOT_URL=http://localhost:3000 bun scripts/screenshot/shots.ts
//
// Driven by Bun.WebView (Bun >= 1.4) rather than Playwright, so CI does not
// need `playwright install --with-deps chromium` — WebView drives the Chrome
// already present on the runner. Three things Playwright gave us for free are
// rebuilt here: the 2x device scale factor and the hidden scrollbar (raw CDP
// calls, WebView has no options for either) and waiting for a selector (a
// polled evaluate).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DEMO_USER } from "./demoUser";

const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:3000";
const OUT = process.env.SCREENSHOT_OUT ?? join(import.meta.dir, "../../docs/screenshots");

const VIEWPORT = { width: 1440, height: 900 };
const DEVICE_SCALE_FACTOR = 2;
/**
 * Route-agnostic readiness: at least one image has finished loading. Two
 * stricter signals were tried and rejected — requiring a TMDB poster fails on
 * the dashboard, which legitimately renders with none, and requiring *every*
 * image to be complete hangs on a single never-settling one. SETTLE_MS covers
 * the rest of the decode.
 */
const IMAGES_SETTLED = "[...document.images].some((i) => i.complete)";
const WAIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;
/** Let posters decode and the layout settle before the shutter. */
const SETTLE_MS = 2000;
const CAPTURE_ATTEMPTS = 3;

await mkdir(OUT, { recursive: true });

// Ephemeral: a persisted data store carries the service worker across runs,
// and a stale worker serves a shell that never mounts React.
const view = new Bun.WebView({
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  headless: true,
  dataStore: "ephemeral",
});

/**
 * The page's visible text, trimmed — used to explain a timeout. The API answers
 * its own rate limit with a bare text body, so without this a throttled run
 * looks indistinguishable from a hung one.
 */
async function pageText(): Promise<string> {
  const text = await view
    .evaluate<string>("document.body.innerText.trim().slice(0, 200)")
    .catch(() => "");
  return text ? ` Page said: ${JSON.stringify(text)}` : "";
}

/** Poll a JS expression in the page until it is truthy, or throw on timeout. */
async function waitFor(expression: string, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    // A navigation mid-poll makes evaluate throw; that is not a failure yet.
    const ok = await view.evaluate<boolean>(`!!(${expression})`).catch(() => false);
    if (ok) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${WAIT_TIMEOUT_MS}ms waiting for ${what}.${await pageText()}`,
      );
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Re-assert the capture emulation. WebView exposes no deviceScaleFactor option
 * and always paints its scrollbar, and neither override reliably survives a
 * navigation, so both run again before every capture. Hiding the scrollbar
 * keeps these shots pixel-comparable with the Playwright-era baselines.
 */
async function applyCaptureEmulation(): Promise<void> {
  await view.cdp("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    mobile: false,
  });
  await view.cdp("Emulation.setScrollbarsHidden", { hidden: true });
}

/** Click an input and type into it — WebView types into whatever has focus. */
async function fill(selector: string, value: string): Promise<void> {
  await view.click(selector, { timeout: WAIT_TIMEOUT_MS });
  await view.type(value);
}

/**
 * Retried: the service worker's version-reload can wipe or bounce the first
 * load, and re-navigating clears it.
 */
async function capture(path: string, name: string): Promise<boolean> {
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
    try {
      await view.navigate(`${BASE}${path}`);
      // A version-reload can land us somewhere else; confirm where we are
      // before waiting on content that only exists on the target route.
      await waitFor(
        `document.readyState === 'complete' && location.pathname === ${JSON.stringify(path)}`,
        `${path} to finish loading`,
      );
      await waitFor(IMAGES_SETTLED, "the page images to finish loading");
      await applyCaptureEmulation();
      // Hiding the scrollbar reflows the grid, so settle after emulation.
      await Bun.sleep(SETTLE_MS);

      const png = await view.screenshot({ encoding: "buffer", format: "png" });
      await Bun.write(join(OUT, `${name}.png`), png);
      console.log(`[shots] ${name}.png (${png.length} bytes)`);
      return true;
    } catch (err) {
      console.warn(`[shots] ${name} attempt ${attempt} failed: ${String(err).slice(0, 240)}`);
    }
  }
  return false;
}

let okLibrary = false;
let okDashboard = false;

try {
  // ── Login ──────────────────────────────────────────────────────────────────
  // Public sign-up is disabled; seed.ts created this credential account.
  await view.navigate(`${BASE}/login`);
  await waitFor("document.querySelector('#email')", "the login form");
  await fill("#email", DEMO_USER.email);
  await fill("#password", DEMO_USER.password);
  await view.click('button[type="submit"]', { timeout: WAIT_TIMEOUT_MS });

  // The session cookie is set even if the redirected page flakes (service
  // worker + version-reload + SSE all land at once), so a timeout is not fatal.
  await waitFor(
    "!location.pathname.startsWith('/login')",
    "the post-login redirect",
  ).catch((err: Error) => console.warn(`[shots] login redirect: ${err.message}`));

  okLibrary = await capture("/library", "library");
  okDashboard = await capture("/", "dashboard");
} finally {
  // Always close, or a failed run leaves a headless Chrome behind.
  view.close();
}

if (!okLibrary) throw new Error("library screenshot failed"); // README hero — hard-fail
if (!okDashboard) console.warn("[shots] dashboard skipped after retries");
