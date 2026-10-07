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
 * Walks the top-level bencoded dict and hashes the raw bytes of its "info"
 * value, the same span BitTorrent clients hash.
 * Returns null if parsing fails — never throws.
 */
export function infoHashFromTorrentBuffer(buf: ArrayBuffer): string | null {
  try {
    const bytes = new Uint8Array(buf);
    const span = topLevelInfoSpan(bytes);
    if (!span) return null;
    return createHash("sha1")
      .update(bytes.subarray(span[0], span[1]))
      .digest("hex");
  } catch (e) {
    console.warn("[mediaGrabber] torrent buffer parse failed:", e);
    return null;
  }
}

const B_D = 0x64; // d
const B_L = 0x6c; // l
const B_I = 0x69; // i
const B_E = 0x65; // e
const B_COLON = 0x3a;
const MAX_BENCODE_DEPTH = 64;

const isDigit = (b: number | undefined) =>
  b !== undefined && b >= 0x30 && b <= 0x39;

// Every branch either advances past `pos` or throws, so malformed input can't loop.
function skipBencode(bytes: Uint8Array, pos: number, depth: number): number {
  if (depth > MAX_BENCODE_DEPTH) throw new Error("bencode nested too deep");
  const ch = bytes[pos];
  if (ch === B_I) {
    let p = pos + 1;
    if (bytes[p] === 0x2d) p++;
    const digitsStart = p;
    while (isDigit(bytes[p])) p++;
    if (p === digitsStart || bytes[p] !== B_E) {
      throw new Error("malformed bencode integer");
    }
    return p + 1;
  }
  if (ch === B_L || ch === B_D) {
    let p = pos + 1;
    while (bytes[p] !== B_E) {
      if (p >= bytes.length) throw new Error("unterminated bencode container");
      if (ch === B_D) p = skipBencodeString(bytes, p);
      p = skipBencode(bytes, p, depth + 1);
    }
    return p + 1;
  }
  return skipBencodeString(bytes, pos);
}

function skipBencodeString(bytes: Uint8Array, pos: number): number {
  let p = pos;
  while (isDigit(bytes[p]) && p - pos < 12) p++;
  if (p === pos || bytes[p] !== B_COLON) {
    throw new Error("malformed bencode string length");
  }
  const len = Number(new TextDecoder().decode(bytes.subarray(pos, p)));
  const end = p + 1 + len;
  if (end > bytes.length) throw new Error("bencode string past end of buffer");
  return end;
}

function topLevelInfoSpan(bytes: Uint8Array): [number, number] | null {
  if (bytes[0] !== B_D) return null;
  let info: [number, number] | null = null;
  let p = 1;
  while (bytes[p] !== B_E) {
    if (p >= bytes.length) throw new Error("unterminated top-level dict");
    const keyEnd = skipBencodeString(bytes, p);
    const key = new TextDecoder().decode(
      bytes.subarray(bytes.indexOf(B_COLON, p) + 1, keyEnd),
    );
    const valueEnd = skipBencode(bytes, keyEnd, 1);
    if (key === "info" && !info && bytes[keyEnd] === B_D) {
      info = [keyEnd, valueEnd];
    }
    p = valueEnd;
  }
  return info;
}
