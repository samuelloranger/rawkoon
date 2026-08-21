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

/** The manifest the shell reads before it can render anything. */
const stubManifest = async (page: Page): Promise<void> => {
  await page.route("**/api/books/editions/*/manifest", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        manifest: {
          edition_id: 11,
          book_id: 1,
          kind: "ebook",
          title: "A Quiet Harbour",
          authors: ["Camille Rousseau"],
          narrators: [],
          cover_url: null,
          total_duration_secs: null,
          primary_file_id: 1,
          progress: null,
          files: [
            {
              id: 1,
              file_name: "A Quiet Harbour.epub",
              format: "epub",
              size_bytes: "4096",
              duration_secs: null,
              offset_secs: 0,
              readable: true,
              chapters: [],
              content_url: "/api/books/files/1/content",
            },
          ],
        },
      }),
    });
  });
};

interface Stubs {
  contentRequests: () => number;
  progressWrites: () => number;
}

const stubApi = async (
  page: Page,
  epub: Buffer,
  options: {
    delayMs?: number;
    /** Mirrors the server rejecting a write and returning the stored row. */
    rejectSavesWithLocator?: string;
  } = {},
): Promise<Stubs> => {
  let contentRequests = 0;
  let progressWrites = 0;

  await stubManifest(page);

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
          locator: options.rejectSavesWithLocator ?? null,
          percent: 0,
          position_secs: null,
          file_id: null,
          finished_at: null,
          client_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        accepted: options.rejectSavesWithLocator == null,
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
    await stubManifest(page);
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
 * The chrome used to fade after three seconds of idling. On a phone that left no
 * way to turn a page or leave the book — a tap produces no pointermove, so
 * nothing brought it back. It is now part of the layout, and the book takes the
 * space between the bars.
 */
test.describe("the reader on a touch screen", () => {
  test("keeps its controls on screen", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    // Well past the old idle timeout.
    await page.waitForTimeout(5_000);

    const opacity = await page.evaluate(() => ({
      header: Number(
        getComputedStyle(document.querySelector("header")!).opacity,
      ),
      footer: Number(
        getComputedStyle(document.querySelector("footer")!).opacity,
      ),
    }));
    expect(opacity).toEqual({ header: 1, footer: 1 });

    // And they are still operable, not just visible.
    await page.getByRole("button", { name: /Next|Suivant/ }).click();
  });

  test("the book does not run under the chrome", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    const boxes = await page.evaluate(() => {
      const rect = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const header = rect("header");
      const footer = rect("footer");
      const frame = rect("#root iframe");
      return {
        headerBottom: header?.bottom ?? -1,
        footerTop: footer?.top ?? -1,
        frameTop: frame?.top ?? -1,
        frameBottom: frame?.bottom ?? -1,
      };
    });

    // The page area lives strictly between the two bars — this is what kept
    // cutting the last line of text.
    expect(boxes.frameTop).toBeGreaterThanOrEqual(boxes.headerBottom);
    expect(boxes.frameBottom).toBeLessThanOrEqual(boxes.footerTop + 1);
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

  test("can always be closed", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

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

/**
 * Reported from a phone: "I click next and it goes back to the last page after
 * 1-2 seconds". That is the save debounce. Turning a page reports a position,
 * the debounced write lands, its response is written into the manifest cache,
 * the shell re-renders with a new manifest, and the renderer — which took the
 * saved locator as an effect dependency — reloaded the book and displayed that
 * position again.
 */
test.describe("the reader's page position", () => {
  test("stays where you turned to, after the save lands", async ({ page }) => {
    // The server rejects the write and answers with the stored position — what
    // happens when another device is ahead, or the phone's clock is behind.
    // Feeding that back into the reader is what dragged the page backwards.
    const stubs = await stubApi(page, await buildEpub(), {
      rejectSavesWithLocator: "epubcfi(/6/4!/4/2/1:0)",
    });
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    const first = await readerText(page);

    // Turn until the text actually changes, so this is a real page move.
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: /Next|Suivant/ }).click();
      await page.waitForTimeout(500);
      if ((await readerText(page)) !== first) break;
    }
    const turned = await readerText(page);
    expect(turned).not.toBe(first);

    // Past the debounce, the write, and the cache update it triggers.
    await expect
      .poll(() => stubs.progressWrites(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(2_500);

    // Still on the page you turned to, and the book was not reloaded.
    expect(await readerText(page)).toBe(turned);
    expect(stubs.contentRequests()).toBeLessThanOrEqual(2);
  });
});

/**
 * "It's blank until I click." epub.js measures the container and lays out its
 * columns once; anything that changes the metrics afterwards — a webfont
 * arriving inside the iframe is the usual culprit — leaves the columns wrong
 * with nothing to repaint them until an interaction does.
 *
 * Text in the DOM was never enough to catch this, which is why the earlier tests
 * missed it: these assert the page is actually painted, and that it is still
 * painted without anyone touching it.
 */
test.describe("the reader's first paint", () => {
  /** Lit pixels in the rendered page. Absolute, because the ratio depends on
   *  how much of a large viewport a short fixture fills. */
  const inkPixels = async (page: Page): Promise<number> => {
    const shot = await page.locator("#root iframe").screenshot();
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

      // The page is dark; ink is anything appreciably lighter than the ground.
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 90 || data[i + 1] > 90 || data[i + 2] > 90) ink++;
      }
      return ink;
    }, shot.toString("base64"));
  };

  test("paints the page without an interaction", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    // Never touched: no clicks, no taps, no keys.
    await expect
      .poll(() => inkPixels(page), { timeout: 10_000 })
      .toBeGreaterThan(1_500);
  });

  test("stays painted while it sits there", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");
    await expect
      .poll(() => inkPixels(page), { timeout: 10_000 })
      .toBeGreaterThan(1_500);

    // Through the font settling, the deferred index and a save landing.
    await page.waitForTimeout(6_000);
    expect(await inkPixels(page)).toBeGreaterThan(1_500);
  });
});

/**
 * The text drawer used range inputs. On a phone a slider is a poor fit: it wants
 * a precise drag inside a narrow drawer, and it never says what value it will
 * land on. Minus and plus do both.
 */
test.describe("the reader's text settings", () => {
  const openDrawer = async (page: Page) => {
    await page
      .getByRole("button", { name: /Text settings|Réglages du texte/ })
      .click();
  };

  const storedTypography = (page: Page) =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("rawkoon:reader:typography") ?? "{}"),
    );

  test("steps the text size up and down", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    await openDrawer(page);
    const before = (await storedTypography(page)).fontSizePx as number;

    await page
      .getByRole("button", { name: /Increase Text size|Augmenter Taille/i })
      .click();
    await expect
      .poll(() => storedTypography(page).then((t) => t.fontSizePx))
      .toBeGreaterThan(before);

    await page
      .getByRole("button", { name: /Decrease Text size|Diminuer Taille/i })
      .click();
    await expect
      .poll(() => storedTypography(page).then((t) => t.fontSizePx))
      .toBe(before);
  });

  test("stops at the ends instead of doing nothing silently", async ({
    page,
  }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");
    await openDrawer(page);

    const decrease = page.getByRole("button", {
      name: /Decrease Text size|Diminuer Taille/i,
    });
    // Down to the smallest, then the control disables itself.
    for (let i = 0; i < 6; i++) {
      if (await decrease.isDisabled()) break;
      await decrease.click();
    }
    await expect(decrease).toBeDisabled();
  });

  test("applies the new size to the page", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");
    await openDrawer(page);

    await page
      .getByRole("button", { name: /Increase Text size|Augmenter Taille/i })
      .click();

    // The setting has to reach the book, not just the drawer.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const doc = document.querySelector("#root iframe")?.contentDocument;
            const body = doc?.body;
            return body ? getComputedStyle(body).fontSize : "";
          }),
        { timeout: 10_000 },
      )
      .not.toBe("");
  });
});

/**
 * The margin control did nothing: it set padding on the epub document's body,
 * and in paginated mode epub.js owns that element's width and columns, so the
 * padding was absorbed. The margin belongs to the container outside the iframe.
 */
test.describe("the reader's margins", () => {
  const frameWidth = (page: Page) =>
    page.evaluate(
      () =>
        document.querySelector("#root iframe")?.getBoundingClientRect().width ??
        -1,
    );

  test("narrow the page when increased", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    const before = await frameWidth(page);
    expect(before).toBeGreaterThan(0);

    await page
      .getByRole("button", { name: /Text settings|Réglages du texte/ })
      .click();
    await page
      .getByRole("button", { name: /Increase Margins|Augmenter Marges/i })
      .click();

    // The rendered page has to get narrower, not just the stored setting.
    await expect
      .poll(() => frameWidth(page), { timeout: 10_000 })
      .toBeLessThan(before);
  });

  test("widen the page when decreased", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    await page
      .getByRole("button", { name: /Text settings|Réglages du texte/ })
      .click();
    await page
      .getByRole("button", { name: /Increase Margins|Augmenter Marges/i })
      .click();
    const narrowed = await frameWidth(page);

    await page
      .getByRole("button", { name: /Decrease Margins|Diminuer Marges/i })
      .click();

    await expect
      .poll(() => frameWidth(page), { timeout: 10_000 })
      .toBeGreaterThan(narrowed);
  });

  test("keeps the text painted after a margin change", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    await page
      .getByRole("button", { name: /Text settings|Réglages du texte/ })
      .click();
    for (let i = 0; i < 3; i++) {
      await page
        .getByRole("button", { name: /Increase Margins|Augmenter Marges/i })
        .click();
      await page.waitForTimeout(300);
    }

    // Re-measuring must not leave the columns blank — the failure mode this
    // whole class of bug keeps taking.
    expect((await readerText(page)).trim().length).toBeGreaterThan(0);
  });
});

/**
 * The X is the only way out of a book, so it also has to be the way out of a
 * panel opened on top of it: closing the book from under an open drawer threw
 * away the page the reader was on.
 */
test.describe("the reader's close button", () => {
  const closes = (page: Page) =>
    page.evaluate(() => window.__readerCloses ?? 0);

  const openSettings = async (page: Page) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");
    await page
      .getByRole("button", { name: /Text settings|Réglages du texte/ })
      .click();
    await expect(page.getByText(/^(Text size|Taille du texte)$/)).toBeVisible();
  };

  test("closes the settings drawer instead of the book", async ({ page }) => {
    await openSettings(page);

    await page
      .getByRole("button", { name: /Close this panel|Fermer ce panneau/ })
      .click();

    await expect(page.getByText(/^(Text size|Taille du texte)$/)).toBeHidden();
    expect(await closes(page)).toBe(0);
    // Still reading, in the same place.
    expect((await readerText(page)).trim().length).toBeGreaterThan(0);
  });

  test("closes the book once no panel is open", async ({ page }) => {
    await openSettings(page);

    await page
      .getByRole("button", { name: /Close this panel|Fermer ce panneau/ })
      .click();
    await page
      .getByRole("button", { name: /Close the reader|Fermer la lecture/ })
      .click();

    await expect.poll(() => closes(page), { timeout: 5_000 }).toBe(1);
  });

  test("closes the contents panel the same way", async ({ page }) => {
    await stubApi(page, await buildEpub());
    await page.goto(HARNESS);
    await expect
      .poll(() => readerText(page), { timeout: 15_000 })
      .toContain("The tide came in");

    await page
      .getByRole("button", { name: /Contents|Table des matières/ })
      .click();
    await page
      .getByRole("button", { name: /Close this panel|Fermer ce panneau/ })
      .click();

    expect(await closes(page)).toBe(0);
  });
});
