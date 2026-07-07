import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@rawkoon/api/db";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import {
  parseReleaseTitle,
  type ParsedRelease,
} from "@rawkoon/api/utils/medias/filenameParser";
import { type QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";
import { normalizeProwlarrConfig } from "@rawkoon/api/utils/integrations/normalizers";
import {
  QBIT_CATEGORY_RAWKOON_MOVIES,
  QBIT_CATEGORY_RAWKOON_SHOWS,
} from "@rawkoon/api/constants/libraryGrab";
import type { AssignedCustomFormat } from "@rawkoon/api/utils/medias/customFormatTypes";

/** Prisma include that pulls a profile's assigned custom formats. */
export const qualityProfileFormatsInclude = {
  customFormats: { include: { customFormat: true } },
} as const;

type QualityProfileWithFormats = Prisma.QualityProfileGetPayload<{
  include: typeof qualityProfileFormatsInclude;
}>;

export function mapAssignedFormats(
  p: QualityProfileWithFormats,
): AssignedCustomFormat[] {
  return (p.customFormats ?? []).map((link) => ({
    name: link.customFormat.name,
    // `conditions` is stored as JSON and validated on write; the cast is a
    // deliberate deferral of runtime parsing (a Zod parse may be added later).
    conditions:
      (link.customFormat
        .conditions as unknown as AssignedCustomFormat["conditions"]) ?? [],
    score: link.score,
    required: link.required,
    forbidden: link.forbidden,
  }));
}

/** Load a quality profile with its custom formats, or null. */
export async function loadProfileWithFormats(
  id: number,
): Promise<QualityProfileWithFormats | null> {
  return prisma.qualityProfile.findUnique({
    where: { id },
    include: qualityProfileFormatsInclude,
  });
}

export function profileToScoreInput(
  p: QualityProfileWithFormats,
): QualityProfileScoreInput {
  return {
    minResolution: p.minResolution,
    cutoffResolution: p.cutoffResolution ?? null,
    preferredSources: p.preferredSources,
    preferredCodecs: p.preferredCodecs,
    preferredLanguages: p.preferredLanguages ?? [],
    prioritizedTrackers: p.prioritizedTrackers ?? [],
    preferTrackerOverQuality: p.preferTrackerOverQuality ?? false,
    maxSizeGb: p.maxSizeGb,
    requireHdr: p.requireHdr,
    preferHdr: p.preferHdr,
    // null/unset minSeeders means "no minimum" — the gate is skipped at 0.
    minSeeders: p.minSeeders ?? 0,
    customFormats: mapAssignedFormats(p),
  };
}

export type CandidateRow = {
  raw: { _downloadUrl: string; _isMagnet: boolean };
  parsed: ParsedRelease;
  score: number;
  title: string;
  size: number | null;
};

export async function checkBlocklist(
  releaseTitle: string,
  torrentHash?: string | null,
): Promise<string | null> {
  const conditions: { releaseTitle?: string; torrentHash?: string }[] = [
    { releaseTitle },
  ];
  if (torrentHash) conditions.push({ torrentHash });
  const entry = await prisma.grabBlocklist.findFirst({
    where: { OR: conditions },
    select: { reason: true },
  });
  if (!entry) return null;
  return entry.reason ?? "Release is blocklisted";
}

export function qbCategoryForLibraryType(type: string): string {
  return type === "show"
    ? QBIT_CATEGORY_RAWKOON_SHOWS
    : QBIT_CATEGORY_RAWKOON_MOVIES;
}

export function qualityJsonValue(
  releaseTitle: string,
  qualityParsed: unknown | undefined,
): Prisma.InputJsonValue {
  if (qualityParsed != null && typeof qualityParsed === "object") {
    return JSON.parse(JSON.stringify(qualityParsed)) as Prisma.InputJsonValue;
  }
  const parsed = parseReleaseTitle(releaseTitle);
  return JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue;
}

export async function prowlarrHeadersForTorrentUrl(
  downloadUrl: string,
): Promise<Record<string, string>> {
  const prowIntegration = await getIntegrationConfigRecord("prowlarr");
  if (!prowIntegration?.enabled) return {};
  const prowCfg = normalizeProwlarrConfig(prowIntegration.config);
  if (!prowCfg) return {};
  try {
    const pu = new URL(prowCfg.website_url);
    const du = new URL(downloadUrl);
    if (du.hostname === pu.hostname) {
      return { "X-Api-Key": prowCfg.api_key };
    }
  } catch (e) {
    console.warn("[mediaGrabber] URL compare failed:", e);
  }
  return {};
}

/**
 * Extract the SHA-1 info hash from a raw .torrent file buffer.
 * Parses just enough bencode to locate and hash the "info" dictionary.
 * Returns null if parsing fails — never throws.
 */
export function infoHashFromTorrentBuffer(buf: ArrayBuffer): string | null {
  try {
    const bytes = new Uint8Array(buf);

    // Walk a bencoded value starting at pos, return the index after it ends.
    function skipValue(pos: number): number {
      const ch = bytes[pos];
      if (ch === 0x64 /* d */ || ch === 0x6c /* l */) {
        pos++;
        while (bytes[pos] !== 0x65 /* e */) pos = skipValue(pos);
        return pos + 1;
      }
      if (ch === 0x69 /* i */) {
        while (pos < bytes.length && bytes[pos] !== 0x65 /* e */) pos++;
        if (pos >= bytes.length)
          throw new Error("malformed integer in bencode");
        return pos + 1;
      }
      // String: <digits>:<bytes>
      let colon = pos;
      while (bytes[colon] !== 0x3a /* : */) colon++;
      const len = parseInt(
        new TextDecoder().decode(bytes.slice(pos, colon)),
        10,
      );
      return colon + 1 + len;
    }

    // The info key is encoded as "4:info" (0x34 0x3a 0x69 0x6e 0x66 0x6f)
    const marker = [0x34, 0x3a, 0x69, 0x6e, 0x66, 0x6f]; // "4:info"
    outer: for (let i = 0; i < bytes.length - marker.length; i++) {
      for (let j = 0; j < marker.length; j++) {
        if (bytes[i + j] !== marker[j]) continue outer;
      }
      const infoStart = i + marker.length;
      const infoEnd = skipValue(infoStart);
      return createHash("sha1")
        .update(bytes.slice(infoStart, infoEnd))
        .digest("hex");
    }
    return null;
  } catch (e) {
    console.warn("[mediaGrabber] torrent buffer parse failed:", e);
    return null;
  }
}
