import { basename, dirname, extname, join } from "node:path";

const RES_TOKEN =
  /(^|[\s.[(_-])(2160p|4K|UHD|1080p|720p|576p|480p)(?=$|[\s.\])_-])/i;

export function tmpPathFor(sourcePath: string): string {
  const base = basename(sourcePath, extname(sourcePath));
  return join(dirname(sourcePath), `.${base}.rawkoon-tmp.mkv`);
}

export function origPathFor(sourcePath: string): string {
  return join(dirname(sourcePath), `.${basename(sourcePath)}.rawkoon-orig`);
}

export function finalPathFor(
  sourcePath: string,
  newHeight: number | null,
): string {
  let name = basename(sourcePath, extname(sourcePath));
  if (newHeight) name = name.replace(RES_TOKEN, `$1${newHeight}p`);
  return join(dirname(sourcePath), `${name}.mkv`);
}
