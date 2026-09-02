import { unzipSync } from "fflate";
import {
  Link,
  Manifest,
  Publication,
  Resource,
  NumberRange,
  type Fetcher,
} from "@readium/shared";

export type OpenPublicationOptions = {
  /** Rawkoon book language; wins over EPUB dc:language. */
  language?: string;
};

function localName(el: Element): string {
  return el.localName;
}

function child(el: Element, name: string): Element | undefined {
  return [...el.children].find((c) => localName(c) === name);
}

function descendants(el: Element, name: string): Element[] {
  const all = [el, ...el.querySelectorAll("*")];
  return all.filter((c) => c.localName === name);
}

function decodeBytes(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function resolveHref(baseDir: string, href: string): string {
  const path = href.split("#")[0] ?? href;
  const joined = (baseDir ? `${baseDir}/${path}` : path).replace(/\\/g, "/");
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function lookup(
  files: Map<string, Uint8Array>,
  path: string,
): Uint8Array | undefined {
  const candidates = [path, decodeURIComponent(path)];
  for (const c of candidates) {
    const hit = files.get(c) ?? files.get(c.replace(/^\//, ""));
    if (hit) return hit;
  }
  return undefined;
}

class BytesResource extends Resource {
  constructor(
    private readonly _link: Link,
    private readonly bytes: Uint8Array | undefined,
  ) {
    super();
  }

  async link(): Promise<Link> {
    return this._link;
  }

  async length(): Promise<number | undefined> {
    return this.bytes?.byteLength;
  }

  async read(range?: NumberRange): Promise<Uint8Array | undefined> {
    if (!this.bytes) return undefined;
    if (!range) return this.bytes;
    return this.bytes.slice(range.start, range.endInclusive + 1);
  }

  close(): void {}
}

class ZipFetcher implements Fetcher {
  constructor(private readonly files: Map<string, Uint8Array>) {}

  links(): Link[] {
    return [...this.files.keys()].map((href) => new Link({ href }));
  }

  get(link: Link): Resource {
    const href = link.href.split("#")[0] ?? link.href;
    return new BytesResource(link, lookup(this.files, href));
  }

  close(): void {}
}

function parseXml(bytes: Uint8Array): Document {
  return new DOMParser().parseFromString(decodeBytes(bytes), "application/xml");
}

function mediaTypeFor(path: string, declared?: string): string {
  if (declared) return declared;
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "xhtml":
    case "html":
      return "application/xhtml+xml";
    case "css":
      return "text/css";
    case "js":
      return "application/javascript";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "ttf":
      return "font/ttf";
    case "otf":
      return "font/otf";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    case "ncx":
      return "application/x-dtbncx+xml";
    default:
      return "application/octet-stream";
  }
}

export async function openPublication(
  blob: Blob,
  options: OpenPublicationOptions = {},
): Promise<Publication> {
  const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(unzipped)) {
    if (name.endsWith("/")) continue;
    files.set(name.replace(/\\/g, "/"), data);
  }

  const containerBytes = lookup(files, "META-INF/container.xml");
  if (!containerBytes)
    throw new Error("EPUB is missing META-INF/container.xml");
  const container = parseXml(containerBytes);
  const rootfile = descendants(container.documentElement, "rootfile")[0];
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB container has no rootfile");

  const opfBytes = lookup(files, opfPath);
  if (!opfBytes) throw new Error(`EPUB is missing ${opfPath}`);
  const opf = parseXml(opfBytes);
  const pkg = opf.documentElement;
  const opfDir = dirname(opfPath);

  const metadataEl = child(pkg, "metadata");
  const title =
    (metadataEl && descendants(metadataEl, "title")[0]?.textContent?.trim()) ||
    "Untitled";
  const opfLanguage =
    metadataEl && descendants(metadataEl, "language")[0]?.textContent?.trim();
  const language = options.language || opfLanguage || "en";

  const manifestEl = child(pkg, "manifest");
  const items = new Map<
    string,
    { href: string; mediaType: string; properties: string }
  >();
  if (manifestEl) {
    for (const item of descendants(manifestEl, "item")) {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      if (!id || !href) continue;
      items.set(id, {
        href: resolveHref(opfDir, href),
        mediaType: mediaTypeFor(
          href,
          item.getAttribute("media-type") ?? undefined,
        ),
        properties: item.getAttribute("properties") ?? "",
      });
    }
  }

  const spineEl = child(pkg, "spine");
  const readingOrder: Array<{ href: string; type: string; title?: string }> =
    [];
  if (spineEl) {
    for (const ref of descendants(spineEl, "itemref")) {
      if (ref.getAttribute("linear") === "no") continue;
      const idref = ref.getAttribute("idref");
      if (!idref) continue;
      const item = items.get(idref);
      if (!item) continue;
      readingOrder.push({ href: item.href, type: item.mediaType });
    }
  }

  const resources = [...items.values()]
    .filter((item) => !readingOrder.some((r) => r.href === item.href))
    .map((item) => ({ href: item.href, type: item.mediaType }));

  const nav = [...items.values()].find((i) =>
    i.properties.split(/\s+/).includes("nav"),
  );

  const json = {
    metadata: {
      title,
      language,
      conformsTo: ["https://readium.org/webpub-manifest/profiles/epub"],
    },
    readingOrder,
    resources,
    toc: nav ? [{ href: nav.href, type: nav.mediaType }] : undefined,
  };

  const manifest = Manifest.deserialize(json);
  if (!manifest) throw new Error("Could not build a Readium manifest");
  return new Publication({
    manifest,
    fetcher: new ZipFetcher(files),
  });
}
