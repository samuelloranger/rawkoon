import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildStoredZip } from "./handoff/testSupport";

mock.module("@rawkoon/api/db", () => ({ prisma: {} }));

const { alignTocToDurations, chapterLabel, parseTocLinks, readEpubToc } =
  await import("./ebookChapterNames");

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const words = (n: number) => Array.from({ length: n }, () => "mot").join(" ");

async function writeEpub(opts: {
  docs: { href: string; words: number }[];
  toc: { title: string; href: string }[];
  format: "ncx" | "nav";
}): Promise<string> {
  const manifest = opts.docs
    .map(
      (d, i) =>
        `<item id="d${i}" href="${d.href}" media-type="application/xhtml+xml"/>`,
    )
    .join("");
  const tocItem =
    opts.format === "nav"
      ? `<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>`
      : `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;
  const spine = opts.docs.map((_, i) => `<itemref idref="d${i}"/>`).join("");
  const files: Record<string, string> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
    "OEBPS/content.opf": `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:language>fr</dc:language></metadata><manifest>${manifest}${tocItem}</manifest><spine>${spine}</spine></package>`,
  };
  if (opts.format === "nav") {
    const items = opts.toc
      .map((t) => `<li><a href="${t.href}">${t.title}</a></li>`)
      .join("");
    files["OEBPS/nav.xhtml"] =
      `<html><body><nav epub:type="toc"><ol>${items}</ol></nav></body></html>`;
  } else {
    const points = opts.toc
      .map(
        (t, i) =>
          `<navPoint id="p${i}"><navLabel><text>${t.title}</text></navLabel><content src="${t.href}"/></navPoint>`,
      )
      .join("");
    files["OEBPS/toc.ncx"] = `<ncx><navMap>${points}</navMap></ncx>`;
  }
  for (const d of opts.docs) {
    files[`OEBPS/${d.href}`] =
      `<html><body><p>${words(d.words)}</p></body></html>`;
  }
  const dir = await mkdtemp(join(tmpdir(), "toc-fixture-"));
  dirs.push(dir);
  const path = join(dir, "book.epub");
  await writeFile(path, buildStoredZip(files));
  return path;
}

describe("alignTocToDurations", () => {
  const toc = [
    { title: "Author’s note", words: 100 },
    { title: "1", words: 500 },
    { title: "2", words: 2000 },
    { title: "3", words: 800 },
    { title: "4", words: 1500 },
    { title: "Epilogue", words: 3000 },
    { title: "Acknowledgements", words: 400 },
  ];

  test("finds the window whose word counts track the durations", () => {
    // 2.5 words per second, with the unnarrated note and acknowledgements left out.
    expect(alignTocToDurations([200, 800, 320, 600, 1200], toc)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "Epilogue",
    ]);
  });

  test("returns null when no window correlates", () => {
    expect(alignTocToDurations([900, 100, 900, 100, 900], toc)).toBeNull();
  });

  test("returns null when two windows fit about equally well", () => {
    const flat = [10, 20, 10, 20, 10, 20].map((w, i) => ({
      title: `${i}`,
      words: w,
    }));
    expect(alignTocToDurations([10, 20, 10, 20], flat)).toBeNull();
  });

  test("returns null with more files than entries, or too few files", () => {
    expect(alignTocToDurations([1, 2, 3, 4, 5, 6, 7, 8], toc)).toBeNull();
    expect(alignTocToDurations([200, 800], toc)).toBeNull();
  });
});

describe("chapterLabel", () => {
  test("turns a bare number into a chapter label in the ebook's language", () => {
    expect(chapterLabel("12", "fr")).toBe("Chapitre 12");
    expect(chapterLabel("12", "en")).toBe("Chapter 12");
    expect(chapterLabel("12", null)).toBe("Chapter 12");
  });

  test("keeps a real title", () => {
    expect(chapterLabel("Épilogue", "fr")).toBe("Épilogue");
  });
});

describe("parseTocLinks", () => {
  test("reads an EPUB 2 NCX in order", () => {
    const ncx = `<ncx><navMap><navPoint><navLabel><text>Prologue</text></navLabel><content src="a.xhtml#top"/><navPoint><navLabel><text>Un &amp; deux</text></navLabel><content src="b.xhtml"/></navPoint></navPoint></navMap></ncx>`;
    expect(parseTocLinks(ncx, false)).toEqual([
      { title: "Prologue", href: "a.xhtml#top" },
      { title: "Un & deux", href: "b.xhtml" },
    ]);
  });

  test("reads only the toc nav of an EPUB 3 nav document", () => {
    const nav = `<nav epub:type="landmarks"><a href="cover.xhtml">Cover</a></nav><nav epub:type="toc"><ol><li><a href="a.xhtml"><span>1</span></a></li></ol></nav>`;
    expect(parseTocLinks(nav, true)).toEqual([{ title: "1", href: "a.xhtml" }]);
  });
});

describe("readEpubToc", () => {
  const docs = [
    { href: "note.xhtml", words: 50 },
    { href: "c1.xhtml", words: 300 },
    { href: "c1b.xhtml", words: 100 },
    { href: "c2.xhtml", words: 500 },
  ];

  test("counts the words of every spine document an entry spans", async () => {
    const path = await writeEpub({
      docs,
      format: "ncx",
      toc: [
        { title: "Note", href: "note.xhtml" },
        { title: "1", href: "c1.xhtml" },
        { title: "2", href: "c2.xhtml" },
      ],
    });
    expect(await readEpubToc(path)).toEqual({
      language: "fr",
      entries: [
        { title: "Note", words: 50 },
        { title: "1", words: 400 },
        { title: "2", words: 500 },
      ],
    });
  });

  test("reads an EPUB 3 nav", async () => {
    const path = await writeEpub({
      docs,
      format: "nav",
      toc: [
        { title: "1", href: "c1.xhtml" },
        { title: "2", href: "c2.xhtml" },
      ],
    });
    expect((await readEpubToc(path))?.entries).toEqual([
      { title: "1", words: 400 },
      { title: "2", words: 500 },
    ]);
  });

  test("gives up when two entries point into the same document", async () => {
    const path = await writeEpub({
      docs,
      format: "ncx",
      toc: [
        { title: "1", href: "c1.xhtml#a" },
        { title: "2", href: "c1.xhtml#b" },
      ],
    });
    expect(await readEpubToc(path)).toBeNull();
  });
});
