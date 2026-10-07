import { createHash } from "node:crypto";

import bencode from "bencode";

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
 * Decodes the bencode, then re-encodes the top-level "info" dict and hashes it.
 * Returns null if parsing fails — never throws.
 */
export function infoHashFromTorrentBuffer(buf: ArrayBuffer): string | null {
  try {
    // No encoding arg: byte strings stay Uint8Array so `pieces` re-encodes byte-for-byte.
    const bytes = new Uint8Array(buf);
    const torrent = bencode.decode(bytes);
    if (!isPlainDict(torrent) || !isPlainDict(torrent.info)) return null;
    const info = bencode.encode(torrent.info as Record<string, never>);
    // Clients hash the raw bytes; a non-canonical file (unsorted keys) would re-encode differently.
    const marked = Buffer.concat([Buffer.from("4:info"), info]);
    if (Buffer.from(bytes).indexOf(marked) === -1) return null;
    return createHash("sha1").update(info).digest("hex");
  } catch (e) {
    console.warn("[mediaGrabber] torrent buffer parse failed:", e);
    return null;
  }
}

function isPlainDict(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !ArrayBuffer.isView(v)
  );
}
