import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";

/**
 * The reader, in a browser, through our own component.
 *
 * Two shipped bugs motivate this file. First, epub.js was handed the content
 * url as a string and probed `META-INF/container.xml`, rendering nothing.
 * Second, the renderer's effect depended on callback identities that changed on
 * every parent render, so it tore down mid-load and epub.js threw from
 * `destroy()` — "undefined is not an object (evaluating
 * '(this.settings.fullsize ? window : this.container).removeEventListener')" —
 * which took the whole page down.
 *
 * Neither was visible to a unit test: both were in how the component drives the
 * library. This drives the component.
 */

// No app session: the harness renders the shell directly.
test.use({ storageState: { cookies: [], origins: [] } });

const HARNESS = "/e2e/harness/reader.html";

const buildEpub = async (): Promise<Buffer> => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Quiet Harbour</dc:title><dc:identifier id="id">urn:uuid:t</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Arrival</a></li><li><a href="chapter2.xhtml">The Harbour Wall</a></li></ol></nav></body></html>`,
  );
  zip.file(
    "OEBPS/chapter1.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Arrival</h1><p>The tide came in the way it always had.</p></body></html>`,
  );
  zip.file(
    "OEBPS/chapter2.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>The Harbour Wall</h1><p>Marguerite counted the boats out of habit.</p></body></html>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
};

interface Stubs {
  contentRequests: () => number;
  progressWrites: () => number;
}

const stubApi = async (page: Page, epub: Buffer): Promise<Stubs> => {
  let contentRequests = 0;
  let progressWrites = 0;

  await page.route("**/api/books/files/1/content", async (route) => {
    contentRequests++;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/epub+zip",
        "accept-ranges": "bytes",
      },
      body: epub,
    });
  });

  await page.route("**/api/books/editions/*/progress", async (route) => {
    progressWrites++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        progress: {
          edition_id: 11,
          locator: null,
          percent: 0,
          position_secs: null,
          file_id: null,
          finished_at: null,
          client_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        accepted: true,
      }),
    });
  });

  return {
    contentRequests: () => contentRequests,
    progressWrites: () => progressWrites,
  };
};

/** The chapter text lives inside epub.js's iframe. */
const readerText = async (page: Page): Promise<string> => {
  const frame = page.frameLocator("#root iframe");
  return (await frame.locator("body").textContent()) ?? "";
};

test.describe("the reader", () => {
  test("paints the book and never crashes the page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);

    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    // The specific crash this test was written for.
    expect(errors.join("\n")).not.toContain("removeEventListener");
    expect(errors).toEqual([]);
  });

  test("fetches the file once, however often the shell re-renders", async ({
    page,
  }) => {
    const stubs = await stubApi(page, await buildEpub());
    await page.goto(HARNESS);

    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    // StrictMode mounts effects twice on purpose, so the count after loading is
    // the baseline. What matters is that it stops growing.
    const afterLoad = stubs.contentRequests();

    // Turning pages and letting the chrome fade re-render the shell repeatedly.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: /Suivant|Next/ }).click();
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(3500);
    await page.mouse.move(200, 200);
    await page.waitForTimeout(500);

    // No further downloads. Growth here means the renderer is remounting, which
    // is what left epub.js destroying a rendition it had never rendered.
    expect(stubs.contentRequests()).toBe(afterLoad);
    expect(await readerText(page)).not.toBe("");
    expect(
      await page.evaluate(() => window.__READER_RENDERS__),
    ).toBeGreaterThan(1);
  });

  test("moves through the book and records a position", async ({ page }) => {
    const stubs = await stubApi(page, await buildEpub());
    await page.goto(HARNESS);

    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    await page.getByRole("button", { name: /Suivant|Next/ }).click();

    // A page turn reports a position, which the shell debounces into a write.
    await expect
      .poll(() => stubs.progressWrites(), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test("reports a failure instead of showing an empty page", async ({
    page,
  }) => {
    await page.route("**/api/books/files/1/content", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"error":"Not found"}',
      }),
    );
    await page.goto(HARNESS);

    // The state that stayed invisible while epub.js probed for a container.
    await expect(
      page.getByText(/couldn't be opened|pas pu être ouvert/i),
    ).toBeVisible({ timeout: 15_000 });
  });
});
