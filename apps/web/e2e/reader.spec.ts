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

const stubApi = async (
  page: Page,
  epub: Buffer,
  options: { delayMs?: number } = {},
): Promise<Stubs> => {
  let contentRequests = 0;
  let progressWrites = 0;

  await page.route("**/api/books/files/1/content", async (route) => {
    contentRequests++;
    // Stands in for a slow connection, so the loading state is observable.
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/epub+zip",
        "accept-ranges": "bytes",
        // Honest length: the progress bar is driven by this.
        "content-length": String(epub.length),
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

/**
 * On a phone the chrome fades and there is no pointer to move, so a tap has to
 * bring it back — otherwise the reader becomes a dead end: no page turns, no way
 * out. Reported from an iPhone after the chrome hid itself on the first page
 * turn.
 */
test.describe("the reader on a touch screen", () => {
  // Touch-specific by nature: with a mouse the chrome follows the pointer, so
  // there is nothing to bring back.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !testInfo.project.use.hasTouch,
      "describes behaviour that only exists on a touch screen",
    );
  });

  const footerOpacity = (page: Page) =>
    page.evaluate(() => {
      const footer = document.querySelector("footer");
      return footer ? Number(getComputedStyle(footer).opacity) : -1;
    });

  test("a tap in the middle brings the chrome back after it fades", async ({
    page,
  }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    // The chrome hides itself three seconds after the last interaction.
    await expect.poll(() => footerOpacity(page), { timeout: 8_000 }).toBe(0);

    const box = page.viewportSize()!;
    // A real tap where the project has touch: a synthesized mouse click also
    // fires pointermove, which is a different code path entirely.
    if (page.context().browser()) {
      try {
        await page.touchscreen.tap(box.width / 2, box.height / 2);
      } catch {
        await page.mouse.click(box.width / 2, box.height / 2);
      }
    }

    await expect.poll(() => footerOpacity(page), { timeout: 5_000 }).toBe(1);
  });

  test("tapping the right side turns the page", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    const first = await readerText(page);
    const box = page.viewportSize()!;

    // Several taps: a short chapter can need more than one to change section.
    for (let i = 0; i < 4; i++) {
      await page.touchscreen
        .tap(box.width * 0.9, box.height / 2)
        .catch(() => page.mouse.click(box.width * 0.9, box.height / 2));
      await page.waitForTimeout(600);
      if ((await readerText(page)) !== first) break;
    }

    expect(await readerText(page)).not.toBe(first);
  });
});

/**
 * Installed to the home screen the app runs edge to edge (viewport-fit=cover),
 * so a full-screen surface has to inset itself past the status bar and the home
 * indicator. It did not: the first line of text sat under the clock and the last
 * line was cut off. Reported from an installed PWA on iOS.
 *
 * Headless browsers report zero insets, so the test drives the variables the
 * layout reads.
 */
test.describe("the reader inside an installed app", () => {
  const SAFE_TOP = 47;
  const SAFE_BOTTOM = 34;

  test("keeps its chrome and its text clear of the system insets", async ({
    page,
  }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await page.addStyleTag({
      content: `:root { --safe-top: ${SAFE_TOP}px; --safe-bottom: ${SAFE_BOTTOM}px; }`,
    });
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    const viewport = page.viewportSize()!;
    const boxes = await page.evaluate(() => {
      const rect = (el: Element | null) =>
        el ? el.getBoundingClientRect() : null;
      const header = rect(document.querySelector("header"));
      const footer = rect(document.querySelector("footer"));
      const frame = rect(document.querySelector("#root iframe"));
      return {
        headerTop: header?.top ?? -1,
        footerBottom: footer?.bottom ?? -1,
        frameTop: frame?.top ?? -1,
        frameBottom: frame?.bottom ?? -1,
      };
    });

    // Nothing may sit under the status bar or the home indicator.
    expect(boxes.headerTop).toBeGreaterThanOrEqual(SAFE_TOP);
    expect(boxes.frameTop).toBeGreaterThanOrEqual(SAFE_TOP);
    expect(boxes.footerBottom).toBeLessThanOrEqual(
      viewport.height - SAFE_BOTTOM,
    );
    // The cut last line: the page area has to end above the indicator.
    expect(boxes.frameBottom).toBeLessThanOrEqual(
      viewport.height - SAFE_BOTTOM,
    );
  });
});

/**
 * `locations.generate()` parses every section — measured at 10.8s for a
 * 97-section novel on a desktop, worse on a phone — and exists only to turn a
 * CFI into a percentage. It used to run before the reader reported itself ready,
 * which is what made every book feel broken for its first ten seconds.
 */
test.describe("the reader's location index", () => {
  const cacheKeys = (page: Page) =>
    page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("rawkoon:reader:locations"),
      ),
    );

  test("shows the book before building the index, then caches it", async ({
    page,
  }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);

    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    // Readable first: the index cannot be a precondition for text on screen.
    expect(await cacheKeys(page)).toEqual([]);

    // Then it is built off the critical path and kept.
    await expect
      .poll(() => cacheKeys(page).then((keys) => keys.length), {
        timeout: 20_000,
      })
      .toBe(1);
  });

  test("reuses a cached index on the next open", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => cacheKeys(page).then((k) => k.length), { timeout: 20_000 })
      .toBe(1);
    const stored = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.startsWith("rawkoon:reader:locations"),
      )!;
      return localStorage.getItem(key)!.length;
    });

    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    // Same entry, not regenerated: a rebuilt index would replace it.
    const after = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.startsWith("rawkoon:reader:locations"),
      )!;
      return localStorage.getItem(key)!.length;
    });
    expect(after).toBe(stored);
  });
});

/**
 * Three things reported from the phone: the first load gave no feedback at all,
 * there was no obvious way out of a book, and the text sat too close to the top.
 */
test.describe("the reader's shell", () => {
  test("shows the title and a progress bar while the book downloads", async ({
    page,
  }) => {
    // A slow response, which is what makes the loading state observable.
    await stubApi(page, await buildEpub(), { delayMs: 2_500 });
    await page.goto(HARNESS);

    // Something to look at immediately, naming the book being opened. The
    // title is also in the header, hence first().
    await expect(page.getByText("A Quiet Harbour").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByText(/Downloading|Téléchargement|Opening|Ouverture/),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("can always be closed, even with the chrome hidden", async ({
    page,
  }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    // Wait past the idle fade: the close control must not depend on the chrome.
    await page.waitForTimeout(4_000);

    const close = page.getByRole("button", {
      name: /Close the reader|Fermer la lecture/,
    });
    await expect(close).toBeVisible();
    await close.click();
  });

  test("leaves room above the text", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    const gap = await page.evaluate(() => {
      const frame = document.querySelector("#root iframe");
      const shell = document.querySelector("#root > div");
      if (!frame || !shell) return -1;
      return (
        frame.getBoundingClientRect().top - shell.getBoundingClientRect().top
      );
    });

    // Reading comfort, on top of whatever the system inset is.
    expect(gap).toBeGreaterThanOrEqual(20);
  });
});
