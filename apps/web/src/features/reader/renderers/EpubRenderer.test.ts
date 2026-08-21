import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ePub from "epubjs";

/**
 * Regression: the renderer used to hand epub.js the content URL as a string.
 * epub.js picks how to open a url from its file extension, and
 * `/api/books/files/1/content` has none, so it classified the endpoint as an
 * unpacked epub *directory* and requested
 * `/api/books/files/1/META-INF/container.xml`. Production answered that with the
 * SPA shell and a 200, so the reader rendered nothing and reported no error.
 *
 * This pins the behaviour that made the endpoint look like a directory, so the
 * url form cannot be reintroduced unnoticed. The other half — that bytes open
 * and render correctly — cannot run here: epub.js's archive path needs browser
 * APIs happy-dom does not provide. It was verified in headless Chromium, where
 * the byte path yields the table of contents, a CFI, and the chapter text
 * inside the iframe, while the url form times out on the container probe.
 */

describe("the bug this replaced", () => {
  let requested: string[] = [];

  beforeEach(() => {
    requested = [];
    // epubjs uses XMLHttpRequest for url input; recording the attempt is enough
    // to show which path it takes.
    class RecordingXhr {
      open(_method: string, url: string) {
        requested.push(url);
      }
      setRequestHeader() {}
      addEventListener() {}
      send() {}
      abort() {}
      readonly onreadystatechange = null;
      readonly readyState = 0;
    }
    vi.stubGlobal("XMLHttpRequest", RecordingXhr);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("probes for META-INF/container.xml when given an extensionless url", () => {
    // Not awaited: the stubbed transport never completes. The point is which
    // url epub.js reaches for, which is what made the endpoint look like a
    // directory of unpacked epub content.
    void ePub("/api/books/files/1/content");

    expect(
      requested.some((url) => url.includes("META-INF/container.xml")),
    ).toBe(true);
  });
});
