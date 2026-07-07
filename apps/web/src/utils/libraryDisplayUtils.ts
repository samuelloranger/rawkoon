import type { LibraryFileInfo } from "@rawkoon/shared/types";

export function formatDuration(secs: number | null): string | null {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatResolution(
  res: number | null,
  w: number | null,
  h: number | null,
): string | null {
  if (w && h) return `${w} × ${h}`;
  if (res) return `${res}p`;
  return null;
}

export function frenchLabel(lang: string): string | null {
  const map: Record<string, string> = {
    VFF: "VFF (France)",
    VFQ: "VFQ (Québec)",
    VFI: "VFI (International)",
    VF2: "VF2",
    TRUEFRENCH: "TRUEFRENCH",
  };
  return map[lang.toUpperCase()] ?? null;
}

export function qualityBadges(
  file: Pick<
    LibraryFileInfo,
    "resolution" | "source" | "video_codec" | "hdr_format" | "bit_depth"
  >,
) {
  return [
    file.resolution
      ? {
          label: `${file.resolution}p`,
          cls: "bg-neutral-800 text-neutral-300",
        }
      : null,
    file.source
      ? {
          label: file.source,
          cls: "bg-neutral-800 text-neutral-300",
        }
      : null,
    file.video_codec
      ? {
          label: file.video_codec,
          cls: "bg-neutral-800 text-neutral-300",
        }
      : null,
    file.hdr_format
      ? {
          label: file.hdr_format,
          cls: file.hdr_format.toLowerCase().includes("dolby")
            ? "bg-blue-500/15 text-blue-300"
            : "bg-amber-500/15 text-amber-300",
        }
      : null,
    file.bit_depth === 10
      ? {
          label: "10-bit",
          cls: "bg-violet-500/15 text-violet-300",
        }
      : null,
  ].filter(Boolean) as { label: string; cls: string }[];
}

export function isUniform<T>(vals: (T | null | undefined)[]): T | null {
  const filled = vals.filter((v) => v != null) as T[];
  if (!filled.length) return null;
  return filled.every((v) => v === filled[0]) ? filled[0] : null;
}

export function getMappedFolder(
  files: LibraryFileInfo[],
  isShow: boolean,
): string | null {
  const firstPath = files[0]?.file_path;
  if (!firstPath) return null;
  const parts = firstPath.split("/").filter(Boolean);
  const idx = isShow ? parts.length - 3 : parts.length - 2;
  return parts[idx] ?? parts[parts.length - 2] ?? null;
}
