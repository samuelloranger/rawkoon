import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { openPublication } from "./openEpub";

function minimalEpub(): Blob {
  const enc = new TextEncoder();
  const packed = zipSync({
    mimetype: enc.encode("application/epub+zip"),
    "META-INF/container.xml": enc.encode(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    "OEBPS/content.opf": enc.encode(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">test</dc:identifier>
    <dc:title>Test Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch"/>
  </spine>
</package>`),
    "OEBPS/ch.xhtml": enc.encode(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch</title></head>
<body><p>Hello.</p></body></html>`),
  });
  return new Blob([packed], { type: "application/epub+zip" });
}

describe("openPublication", () => {
  it("opens a one-chapter EPUB", async () => {
    const publication = await openPublication(minimalEpub());
    expect(publication.readingOrder.items).toHaveLength(1);
  });
});
